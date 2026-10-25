// 学科桥卡：用户选择“研究这个联系”后，对一条研究关系做结构化编辑与状态确认。
//
// 研究内容（映射、保持的运算、条件、反例、出处）通过 PATCH /relations/{id} 保存，附 expected_claim_revision；
// 状态变更通过 POST /relations/{id}/review 提交带版本的证据、判断依据与人工确认。
import { ArrowRightSmallIcon, CloseIcon, DeleteIcon, PlusIcon } from '@blocksuite/icons/rc';
import { api, type Anchor, type Claim, type ClaimStatus, type EvidenceRef, type EvidenceRole, type Relation, type ReviewRequest } from '@research';
import { Button } from '@ui';
import { useEffect, useMemo, useState } from 'react';

import { closeBridge, emptyClaim, errorText, openDocument, setDialogs, toast, updateRelation, upsertRelationFromServer, useApp } from '../app/model';
import { AnchorStatusChip, Chip, KindIcon } from '../components/common';
import { CLAIM_STATUS_LABEL, excerpt, formatTime } from '../lib/format';

type ReviewStatus = ReviewRequest['status'];

export const BRIDGE_STATUS: Array<{ id: ReviewStatus; label: string }> = [
  { id: 'analogy', label: '启发' },
  { id: 'candidate', label: '候选' },
  { id: 'supported', label: '有支持' },
  { id: 'established', label: '已确立' },
  { id: 'refuted', label: '被反驳' },
];

const ROLE_LABEL: Record<EvidenceRole, string> = { support: '支持', derivation: '论证', counterexample: '反例' };

export function bridgeStatusOf(claim: Claim | null): ReviewStatus {
  if (!claim) return 'analogy';
  return claim.status === 'verified' ? 'established' : claim.status;
}

const PENDING = '后端 Claim 尚未提供该字段，已列入交接';

function Endpoint({ id }: { id: string }) {
  const doc = useApp(state => state.summary?.documents.find(item => item.id === id));
  return (
    <button type="button" onClick={() => doc && openDocument(doc.id)} className="rc-focus-ring flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-[var(--cds-alpha-1)] px-2 py-1.5 text-left text-xs text-ink hover:bg-[var(--cds-fill-ghost-hover)]">
      {doc && <KindIcon kind={doc.kind} className="shrink-0 text-ink-muted" />}
      <span className="min-w-0 flex-1 truncate">{doc?.title || '已删除文稿'}</span>
      {doc && <Chip className="shrink-0">v{doc.current_version}</Chip>}
    </button>
  );
}

function PendingField({ label }: { label: string }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] font-medium text-ink-muted">{label}</span>
      <p className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[11px] text-ink-muted">{PENDING}</p>
    </div>
  );
}

type Candidate = { key: string; label: string; ref: Omit<EvidenceRef, 'role' | 'note'> };

/** 状态确认：选择带版本的证据、角色与判断依据，人工确认后提交。 */
function ReviewForm({ relation, status, candidates, onDone }: { relation: Relation; status: ReviewStatus; candidates: Candidate[]; onDone: () => void }) {
  const [picked, setPicked] = useState<Record<string, { role: EvidenceRole; note: string }>>({});
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsSupport = status === 'supported' || status === 'established';
  const evidence: EvidenceRef[] = Object.entries(picked).map(([key, value]) => ({ ...candidates.find(item => item.key === key)!.ref, ...value }));
  const missing = needsSupport && !evidence.some(item => item.role !== 'counterexample')
    ? '该状态需要支持或论证证据'
    : status === 'refuted' && !evidence.some(item => item.role === 'counterexample') ? '被反驳需要反例证据' : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let current = relation;
      // 尚无论证记录时先建立候选记录，再提交确认
      if (!current.claim) {
        const created = await updateRelation(relation.id, { claim: { ...emptyClaim, status: 'candidate' } });
        if (!created) throw new Error('建立论证记录失败');
        current = created;
      }
      const updated = await api.reviewRelation(relation.id, {
        expected_claim_revision: current.claim?.revision ?? 1,
        status, evidence, reason: reason.trim(), confirmed: true,
      });
      upsertRelationFromServer(updated);
      toast(`已确认研究状态「${CLAIM_STATUS_LABEL[status]}」，确认记录与证据版本已保存。`, 'success');
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-clay/40 bg-clay/5 p-2.5 text-xs" data-testid="review-form">
      <p className="font-medium text-ink">确认为「{CLAIM_STATUS_LABEL[status]}」</p>
      {candidates.length === 0 ? <p className="text-ink-muted">两端文稿还没有可引用的片段；可先在文稿中选段记为批注。</p> : (
        <ul className="space-y-1">
          {candidates.map(item => {
            const value = picked[item.key];
            return (
              <li key={item.key} className="flex items-start gap-1.5">
                <input type="checkbox" className="mt-0.5 accent-[var(--cds-clay)]" checked={!!value} aria-label={`证据：${item.label}`}
                  onChange={() => setPicked(current => {
                    const next = { ...current };
                    if (next[item.key]) delete next[item.key]; else next[item.key] = { role: status === 'refuted' ? 'counterexample' : 'support', note: '' };
                    return next;
                  })} />
                <span className="min-w-0 flex-1">
                  <span className="block text-ink">{item.label}</span>
                  {value && (
                    <span className="mt-1 flex gap-1">
                      <select aria-label="证据角色" className="rc-input w-20 py-0.5 text-[11px]" value={value.role} onChange={event => setPicked(current => ({ ...current, [item.key]: { ...value, role: event.target.value as EvidenceRole } }))}>
                        {(Object.keys(ROLE_LABEL) as EvidenceRole[]).map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                      </select>
                      <input aria-label="证据说明" className="rc-input min-w-0 flex-1 py-0.5 text-[11px]" placeholder="说明" value={value.note} onChange={event => setPicked(current => ({ ...current, [item.key]: { ...value, note: event.target.value } }))} />
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <textarea aria-label="判断依据" rows={2} className="rc-input resize-y text-[12.5px]" placeholder="判断依据：哪些论证使这个状态成立" value={reason} onChange={event => setReason(event.target.value)} />
      <label className="flex items-start gap-2 text-ink">
        <input type="checkbox" className="mt-0.5 accent-[var(--cds-clay)]" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        我已审阅上述证据并确认此状态。AI 的建议不会自动改变状态。
      </label>
      {missing && <p className="text-[var(--rc-warn)]">{missing}</p>}
      {error && <p role="alert" className="text-[var(--rc-bad)]">{error}</p>}
      <div className="flex gap-1.5">
        <Button size="xs" variant="ghost" onClick={onDone}>取消</Button>
        <Button size="xs" variant="primary" disabled={!confirmed || !reason.trim() || !!missing} isLoading={busy} onClick={() => void submit()}>确认状态</Button>
      </div>
    </div>
  );
}

export function BridgeCard({ relation }: { relation: Relation }) {
  const anchors = useApp(state => state.summary?.anchors ?? []);
  const documents = useApp(state => state.summary?.documents ?? []);
  const resolutions = useApp(state => state.resolutions);
  const base = relation.claim ?? { ...emptyClaim, status: 'analogy' as ClaimStatus };
  const [label, setLabel] = useState(relation.label);
  const [claim, setClaim] = useState<Claim>(base);
  const [operations, setOperations] = useState((base.preserved_operations ?? []).join('\n'));
  const [reviewing, setReviewing] = useState<ReviewStatus | null>(null);
  const [sourceInput, setSourceInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const next = relation.claim ?? { ...emptyClaim, status: 'analogy' as ClaimStatus };
    setLabel(relation.label);
    setClaim(next);
    setOperations((next.preserved_operations ?? []).join('\n'));
    setReviewing(null);
    setError(null);
  }, [relation]);

  const status = bridgeStatusOf(relation.claim);
  const related = anchors.filter(anchor => anchor.document_id === relation.source_id || anchor.document_id === relation.target_id);
  const reviews = relation.claim?.reviews ?? [];
  const lastReview = reviews[reviews.length - 1];
  const preserved = operations.split('\n').map(item => item.trim()).filter(Boolean);
  const dirty = label !== relation.label || claim.mapping !== base.mapping || JSON.stringify(preserved) !== JSON.stringify(base.preserved_operations ?? [])
    || claim.conditions !== base.conditions || claim.counterexamples !== base.counterexamples || JSON.stringify(claim.sources) !== JSON.stringify(base.sources);

  const candidates = useMemo<Candidate[]>(() => {
    const title = (id: string) => documents.find(doc => doc.id === id)?.title ?? '文稿';
    const list: Candidate[] = related.map((anchor: Anchor) => ({
      key: `anchor:${anchor.id}`, label: `「${excerpt(anchor.quote, 50)}」${title(anchor.document_id)} · 版本 ${anchor.version}`,
      ref: { document_id: anchor.document_id, version: anchor.version, anchor_id: anchor.id },
    }));
    for (const id of [relation.source_id, relation.target_id]) {
      const doc = documents.find(item => item.id === id);
      if (doc) list.push({ key: `doc:${id}`, label: `整篇「${doc.title}」· 版本 ${doc.current_version}`, ref: { document_id: id, version: doc.current_version, anchor_id: null } });
    }
    return list;
  }, [related, documents, relation.source_id, relation.target_id]);

  const addSource = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || claim.sources.includes(trimmed)) return;
    setClaim(current => ({ ...current, sources: [...current.sources, trimmed] }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    // 研究内容保存不改变状态；状态变更走人工确认
    const next: Claim = { ...claim, status: relation.claim?.status ?? 'analogy', preserved_operations: preserved };
    const result = await updateRelation(relation.id, { label, claim: next, expected_claim_revision: relation.claim?.revision });
    setSaving(false);
    if (!result) setError('保存未完成，修改仍保留在卡片中');
    else if (reviews.length > 0) toast('研究内容已更新，原有确认进入待复核。', 'info');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Endpoint id={relation.source_id} />
        <ArrowRightSmallIcon width={18} height={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
        <Endpoint id={relation.target_id} />
      </div>
      {relation.claim?.review_required && (
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-ink" data-testid="review-required">
          <p className="font-medium text-[var(--rc-warn)]">待复核 · 原判断「{CLAIM_STATUS_LABEL[relation.claim.status]}」保留</p>
          {lastReview ? (
            <p className="mt-0.5 text-ink-secondary">上次确认于 {formatTime(lastReview.confirmed_at)}，依据：{lastReview.reason}；证据 {lastReview.evidence.map(item => `${documents.find(doc => doc.id === item.document_id)?.title ?? '文稿'} v${item.version}`).join('、')}。来源或研究内容已变化，请重新确认。</p>
          ) : <p className="mt-0.5 text-ink-secondary">该状态缺少人工确认记录，请补充证据后确认。</p>}
        </div>
      )}
      <div className="space-y-1">
        <span className="text-[11px] font-medium text-ink-muted">研究状态 · 第 {relation.claim?.revision ?? 0} 版</span>
        <div role="radiogroup" aria-label="研究状态" className="flex flex-wrap gap-1">
          {BRIDGE_STATUS.map(item => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={status === item.id}
              onClick={() => setReviewing(item.id === status && !relation.claim?.review_required ? null : item.id)}
              className={`rc-focus-ring rounded-full border px-2.5 py-1 text-xs ${status === item.id ? 'border-clay bg-clay/10 text-ink' : reviewing === item.id ? 'border-clay/60 text-ink' : 'border-line text-ink-secondary hover:border-line-strong'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {reviewing && <ReviewForm relation={relation} status={reviewing} candidates={candidates} onDone={() => setReviewing(null)} />}
        {reviews.length > 0 && (
          <details className="text-[11px] text-ink-secondary">
            <summary className="cursor-pointer">确认记录 · {reviews.length}</summary>
            <ul className="mt-1 space-y-1">
              {reviews.map(review => (
                <li key={`${review.claim_revision}-${review.confirmed_at}`} className="rounded bg-[var(--cds-alpha-1)] px-2 py-1">
                  第 {review.claim_revision} 版 · {CLAIM_STATUS_LABEL[review.status]} · {formatTime(review.confirmed_at)}：{review.reason}
                  <span className="block text-ink-muted">{review.evidence.map(item => `${ROLE_LABEL[item.role]} ${documents.find(doc => doc.id === item.document_id)?.title ?? '文稿'} v${item.version}${item.anchor_id ? ' 片段' : ''}`).join('；')}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor="bridge-label" className="text-[11px] font-medium text-ink-muted">联系标签</label>
        <input id="bridge-label" className="rc-input text-[13px]" value={label} onChange={event => setLabel(event.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor="bridge-mapping" className="text-[11px] font-medium text-ink-muted">对象对应及映射</label>
        <textarea id="bridge-mapping" rows={2} className="rc-input resize-y text-[13px]" placeholder="例如：基本解矩阵 Φ(t,t₀) ↔ 沿曲线的平行移动算子" value={claim.mapping ?? ''} onChange={event => setClaim({ ...claim, mapping: event.target.value })} />
      </div>
      <div className="space-y-1">
        <label htmlFor="bridge-operations" className="text-[11px] font-medium text-ink-muted">需要保持的运算或结构（每行一项）</label>
        <textarea id="bridge-operations" rows={2} className="rc-input resize-y text-[13px]" placeholder="例如：复合 Φ(t,s)Φ(s,r)=Φ(t,r)" value={operations} onChange={event => setOperations(event.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor="bridge-conditions" className="text-[11px] font-medium text-ink-muted">成立条件</label>
        <textarea id="bridge-conditions" rows={2} className="rc-input resize-y text-[13px]" placeholder="在什么假设、范畴或尺度下对应成立" value={claim.conditions} onChange={event => setClaim({ ...claim, conditions: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-ink-muted">出处 · {claim.sources.length}</span>
        {claim.sources.length > 0 && (
          <ul className="space-y-1">
            {claim.sources.map(source => {
              const anchor = source.startsWith('anchor:') ? anchors.find(item => item.id === source.slice(7)) : undefined;
              return (
                <li key={source} className="flex items-start gap-2 rounded-lg bg-[var(--cds-alpha-1)] px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1">
                    {anchor ? (
                      <>
                        <span className="block text-ink">「{excerpt(anchor.quote, 80)}」</span>
                        <span className="flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
                          版本 {anchor.version}{anchor.page != null ? ` · 第 ${anchor.page} 页` : ''}
                          <AnchorStatusChip status={resolutions[anchor.id]?.status} />
                          <button type="button" className="rc-focus-ring rounded text-clay hover:underline" onClick={() => setDialogs({ version: { documentId: anchor.document_id, version: anchor.version, anchorId: anchor.id } })}>查看出处</button>
                        </span>
                      </>
                    ) : <span className="break-words text-ink">{source}</span>}
                  </span>
                  <button type="button" aria-label="移除出处" className="rc-focus-ring shrink-0 rounded p-0.5 text-ink-muted hover:text-ink" onClick={() => setClaim({ ...claim, sources: claim.sources.filter(item => item !== source) })}><DeleteIcon width={14} height={14} /></button>
                </li>
              );
            })}
          </ul>
        )}
        {related.length > 0 && (
          <select aria-label="从两端文稿的片段添加出处" className="rc-input text-xs" value="" onChange={event => { if (event.target.value) addSource(`anchor:${event.target.value}`); }}>
            <option value="">从两端文稿的片段添加出处…</option>
            {related.map(anchor => <option key={anchor.id} value={anchor.id}>v{anchor.version} 「{excerpt(anchor.quote, 40)}」</option>)}
          </select>
        )}
        <div className="flex gap-1.5">
          <input aria-label="添加出处" className="rc-input min-w-0 flex-1 text-xs" placeholder="文献、页码、数据或链接" value={sourceInput} onChange={event => setSourceInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addSource(sourceInput); setSourceInput(''); } }} />
          <Button size="sm" variant="secondary" icon={<PlusIcon width={14} height={14} />} onClick={() => { addSource(sourceInput); setSourceInput(''); }}>添加</Button>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="bridge-counter" className="text-[11px] font-medium text-ink-muted">反例与失效情形</label>
        <textarea id="bridge-counter" rows={2} className="rc-input resize-y text-[13px]" value={claim.counterexamples} onChange={event => setClaim({ ...claim, counterexamples: event.target.value })} />
      </div>
      <PendingField label="尚缺论证" />
      <PendingField label="下一步验证方法" />
      {error && <p role="alert" className="text-xs text-[var(--rc-bad)]">{error}</p>}
      <Button size="sm" variant="primary" disabled={!dirty} isLoading={saving} onClick={() => void save()}>保存研究内容</Button>
    </div>
  );
}

/** 画布中的学科桥浮层。打开时读取关系的当前复核状态。 */
export function BridgePanel({ relationId }: { relationId: string }) {
  const relation = useApp(state => state.summary?.relations.find(item => item.id === relationId));
  useEffect(() => {
    void api.getRelation(relationId).then(upsertRelationFromServer).catch(() => undefined);
  }, [relationId]);
  return (
    <section aria-label="学科桥卡" className="rc-pop-in pointer-events-auto absolute bottom-3 left-3 top-3 z-20 flex w-[min(420px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-popover" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold text-ink">学科桥</span>
        {relation && <Chip tone="clay">{relation.kind}</Chip>}
        {relation?.claim && <Chip tone={relation.claim.review_required ? 'warn' : 'muted'}>{CLAIM_STATUS_LABEL[relation.claim.status]}{relation.claim.review_required ? ' · 待复核' : ''}</Chip>}
        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="关闭学科桥" icon={<CloseIcon width={16} height={16} />} onClick={closeBridge} />
      </div>
      <div className="rc-scroll min-h-0 flex-1 overflow-auto p-3">
        {relation ? <BridgeCard relation={relation} /> : <p className="text-xs text-ink-muted">该研究关系已删除。</p>}
      </div>
    </section>
  );
}
