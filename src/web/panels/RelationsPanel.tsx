import { ArrowRightSmallIcon, DeleteIcon, PlusIcon } from '@blocksuite/icons/rc';
import type { Claim, ClaimStatus, Relation } from '@research';
import { Button, SegmentedControl } from '@ui';
import { useEffect, useMemo, useState } from 'react';

import {
  app, createRelation, deleteRelation, emptyClaim, hideRelationOnCanvas, openBridge, openDocument, setDialogs, showRelationOnCanvas,
  updateComposer, updateRelation, useApp,
} from '../app/model';
import { useSession } from '../app/useSession';
import { AnchorStatusChip, Chip, EmptyState, KindIcon, SectionTitle } from '../components/common';
import { CLAIM_STATUS_LABEL, excerpt } from '../lib/format';

/** 面板内可直接设置的状态；有支持、已确立、被反驳需在学科桥中附证据人工确认。 */
const STATUSES: { id: ClaimStatus; label: string }[] = [
  { id: 'analogy', label: CLAIM_STATUS_LABEL.analogy },
  { id: 'candidate', label: CLAIM_STATUS_LABEL.candidate },
];

/** 关系在画布中的显示：本画布的连线视图数、隐藏状态与其他已载入画布。 */
function Placement({ relation }: { relation: Relation }) {
  const session = useSession();
  const view = useApp(state => state.view);
  const canvases = useApp(state => state.summary?.canvases ?? []);
  const canvasId = view.type === 'canvas' ? view.id : null;
  const placement = session?.relationPlacement(relation.id) ?? [];
  const here = placement.find(item => item.canvasId === canvasId);
  const elsewhere = placement.filter(item => item.canvasId !== canvasId);
  return (
    <div className="space-y-1 rounded-lg bg-[var(--cds-alpha-1)] px-2.5 py-2 text-[11px] text-ink-secondary" data-testid="relation-placement">
      <span className="font-medium text-ink-muted">画布显示</span>
      {canvasId ? (
        <p className="flex flex-wrap items-center gap-1.5">
          {here?.hidden ? <Chip tone="warn">本画布已隐藏</Chip> : here?.views ? <Chip tone="ok">本画布 {here.views} 条连线</Chip> : <Chip>本画布未放置</Chip>}
          {here?.hidden || !here?.views
            ? <Button size="xs" variant="ghost" onClick={() => showRelationOnCanvas(relation.id)}>在本画布显示</Button>
            : <Button size="xs" variant="ghost" onClick={() => hideRelationOnCanvas(relation.id)}>在本画布隐藏</Button>}
        </p>
      ) : <p>打开画布后可调整显示。</p>}
      {elsewhere.map(item => (
        <p key={item.canvasId}>{canvases.find(canvas => canvas.id === item.canvasId)?.name ?? '画布'}：{item.hidden ? '已隐藏' : `${item.views} 条连线`}</p>
      ))}
      <p className="text-ink-muted">删除画布连线只影响该画布的显示；删除研究关系使用下方的显式操作。</p>
    </div>
  );
}

const KIND_SUGGESTIONS = ['关联', '类比', '结构同构', '推导', '支持', '反驳', '应用', '对照'];

type Draft = {
  source_id: string;
  target_id: string;
  kind: string;
  label: string;
  include_in_context: boolean;
  context_order: number;
  claimEnabled: boolean;
  claim: Claim;
};

function toDraft(relation: Relation): Draft {
  return {
    source_id: relation.source_id,
    target_id: relation.target_id,
    kind: relation.kind,
    label: relation.label,
    include_in_context: relation.include_in_context,
    context_order: relation.context_order,
    claimEnabled: relation.claim !== null,
    claim: relation.claim ?? emptyClaim,
  };
}

function SourceItem({ value, onRemove }: { value: string; onRemove: () => void }) {
  const anchorId = value.startsWith('anchor:') ? value.slice(7) : null;
  const anchor = useApp(state => (anchorId ? state.summary?.anchors.find(item => item.id === anchorId) : undefined));
  const resolution = useApp(state => (anchorId ? state.resolutions[anchorId] : undefined));
  const doc = useApp(state => (anchor ? state.summary?.documents.find(item => item.id === anchor.document_id) : undefined));
  return (
    <li className="flex items-start gap-2 rounded-lg bg-[var(--cds-alpha-1)] px-2 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        {anchor ? (
          <>
            <p className="text-ink">「{excerpt(anchor.quote, 90)}」</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
              {doc?.title} · 版本 {anchor.version}{anchor.page != null ? ` · 第 ${anchor.page} 页` : ''}
              <AnchorStatusChip status={resolution?.status} />
              <button type="button" className="rc-focus-ring rounded text-clay hover:underline" onClick={() => setDialogs({ version: { documentId: anchor.document_id, version: anchor.version, anchorId: anchor.id } })}>查看出处</button>
            </p>
          </>
        ) : (
          <p className="break-words text-ink">{value}</p>
        )}
      </div>
      <button type="button" aria-label="移除出处" onClick={onRemove} className="rc-focus-ring shrink-0 rounded p-0.5 text-ink-muted hover:text-ink"><DeleteIcon width={14} height={14} /></button>
    </li>
  );
}

function RelationEditor({ relation }: { relation: Relation }) {
  const documents = useApp(state => state.summary?.documents ?? []);
  const anchors = useApp(state => state.summary?.anchors ?? []);
  const [draft, setDraft] = useState<Draft>(() => toDraft(relation));
  const [sourceInput, setSourceInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setDraft(toDraft(relation)); setError(null); setConfirmDelete(false); }, [relation]);

  const dirty = JSON.stringify(toDraft(relation)) !== JSON.stringify(draft);
  const relatedAnchors = anchors.filter(anchor => anchor.document_id === draft.source_id || anchor.document_id === draft.target_id);
  const patchClaim = (patch: Partial<Claim>) => setDraft(current => ({ ...current, claimEnabled: true, claim: { ...current.claim, ...patch } }));
  const addSource = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || draft.claim.sources.includes(trimmed)) return;
    patchClaim({ sources: [...draft.claim.sources, trimmed] });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await updateRelation(relation.id, {
      source_id: draft.source_id,
      target_id: draft.target_id,
      kind: draft.kind.trim() || '关联',
      label: draft.label,
      include_in_context: draft.include_in_context,
      context_order: draft.context_order,
      claim: draft.claimEnabled ? draft.claim : null,
      expected_claim_revision: relation.claim?.revision,
    });
    setSaving(false);
    if (!result) setError('保存未完成，修改仍保留在表单中');
  };

  const docOption = (id: string) => documents.find(doc => doc.id === id);
  const canvasId = app.get().view.type === 'canvas' ? (app.get().view as { id: string }).id : null;
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
      <Placement relation={relation} />
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-ink-muted">对应对象</label>
        <div className="flex items-center gap-1.5">
          <select aria-label="起点文稿" className="rc-input min-w-0 flex-1 text-xs" value={draft.source_id} onChange={event => setDraft({ ...draft, source_id: event.target.value })}>
            {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title || '未命名'}</option>)}
          </select>
          <ArrowRightSmallIcon width={18} height={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <select aria-label="终点文稿" className="rc-input min-w-0 flex-1 text-xs" value={draft.target_id} onChange={event => setDraft({ ...draft, target_id: event.target.value })}>
            {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title || '未命名'}</option>)}
          </select>
        </div>
        <div className="flex gap-2 text-[11px]">
          {[draft.source_id, draft.target_id].map(id => docOption(id) && (
            <button key={id} type="button" className="rc-focus-ring inline-flex min-w-0 max-w-[50%] items-center gap-1 rounded text-clay hover:underline" onClick={() => openDocument(id)}>
              <KindIcon kind={docOption(id)!.kind} />
              <span className="truncate">打开 {docOption(id)!.title}</span>
            </button>
          ))}
        </div>
        <textarea
          aria-label="具体对应"
          rows={2}
          className="rc-input resize-y text-[13px]"
          placeholder="具体对应关系，例如：热力学熵 S ↔ 香农熵 H，玻尔兹曼常数 ↔ 对数底"
          value={draft.label}
          onChange={event => setDraft({ ...draft, label: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="relation-kind" className="text-[11px] font-medium text-ink-muted">关系类型</label>
        <input id="relation-kind" list="relation-kinds" className="rc-input text-[13px]" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })} />
        <datalist id="relation-kinds">{KIND_SUGGESTIONS.map(kind => <option key={kind} value={kind} />)}</datalist>
      </div>
      <div className="space-y-2 rounded-lg bg-[var(--cds-alpha-1)] p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-ink-muted">论证记录</span>
          {draft.claimEnabled && <Button size="xs" variant="ghost" onClick={() => setDraft({ ...draft, claimEnabled: false, claim: emptyClaim })}>清除论证</Button>}
        </div>
        {draft.claim.status === 'analogy' || draft.claim.status === 'candidate'
          ? <SegmentedControl ariaLabel="关系状态" size="sm" items={STATUSES} value={draft.claim.status} onChange={status => patchClaim({ status })} />
          : <p className="flex items-center gap-1.5 text-xs"><Chip tone="ok">{CLAIM_STATUS_LABEL[draft.claim.status]}</Chip><span className="text-ink-muted">状态变更在学科桥中附证据确认</span></p>}
        {relation.claim?.review_required && <p className="text-[11px] text-[var(--rc-warn)]">待复核：来源或研究内容已变化，原判断保留。</p>}
        <textarea aria-label="成立条件" rows={2} className="rc-input resize-y text-[13px]" placeholder="成立条件：在什么假设、尺度或范围内对应成立" value={draft.claim.conditions} onChange={event => patchClaim({ conditions: event.target.value })} />
        <textarea aria-label="反例" rows={2} className="rc-input resize-y text-[13px]" placeholder="反例或失效情形" value={draft.claim.counterexamples} onChange={event => patchClaim({ counterexamples: event.target.value })} />
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-ink-muted">出处 · {draft.claim.sources.length}</span>
          {draft.claim.sources.length > 0 && (
            <ul className="space-y-1">
              {draft.claim.sources.map(source => <SourceItem key={source} value={source} onRemove={() => patchClaim({ sources: draft.claim.sources.filter(item => item !== source) })} />)}
            </ul>
          )}
          {relatedAnchors.length > 0 && (
            <select aria-label="从两端文稿的批注添加出处" className="rc-input text-xs" value="" onChange={event => { if (event.target.value) addSource(`anchor:${event.target.value}`); }}>
              <option value="">从两端文稿的批注添加出处…</option>
              {relatedAnchors.map(anchor => <option key={anchor.id} value={anchor.id}>v{anchor.version} 「{excerpt(anchor.quote, 40)}」</option>)}
            </select>
          )}
          <div className="flex gap-1.5">
            <input
              aria-label="添加出处"
              className="rc-input min-w-0 flex-1 text-xs"
              placeholder="文献、页码、数据或链接"
              value={sourceInput}
              onChange={event => setSourceInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addSource(sourceInput); setSourceInput(''); }
              }}
            />
            <Button size="sm" variant="secondary" icon={<PlusIcon width={14} height={14} />} onClick={() => { addSource(sourceInput); setSourceInput(''); }}>添加</Button>
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input type="checkbox" className="accent-[var(--cds-clay)]" checked={draft.include_in_context} onChange={event => setDraft({ ...draft, include_in_context: event.target.checked })} />
        讨论终点时带入起点内容
        {draft.include_in_context && (
          <input type="number" aria-label="上下文顺序" className="rc-input ml-auto w-20 py-0.5 text-xs tabular-nums" value={draft.context_order} onChange={event => setDraft({ ...draft, context_order: Number(event.target.value) || 0 })} />
        )}
      </label>
      {error && <p role="alert" className="text-xs text-[var(--rc-bad)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="primary" disabled={!dirty} isLoading={saving} onClick={() => void save()}>保存关系</Button>
        <Button size="sm" variant="ghost" onClick={() => {
          updateComposer({ mode: 'relation', documentIds: [draft.source_id, draft.target_id], anchorIds: draft.claim.sources.filter(item => item.startsWith('anchor:')).map(item => item.slice(7)), preview: null, previewKey: null });
          app.set({ tab: 'discuss', panelOpen: true });
        }}>用 AI 分析此关系</Button>
        <Button size="sm" variant="secondary" onClick={() => openBridge(relation.id, canvasId)}>研究这个联系</Button>
        {confirmDelete ? (
          <span className="ml-auto flex items-center gap-1">
            <span className="text-[11px] text-[var(--rc-bad)]">删除后所有画布中的对应连线一并移除</span>
            <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
            <Button size="xs" variant="primary" onClick={() => void deleteRelation(relation.id)}>确认删除</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto text-[var(--rc-bad)]" icon={<DeleteIcon width={14} height={14} />} onClick={() => setConfirmDelete(true)}>删除研究关系</Button>
        )}
      </div>
    </div>
  );
}

export function RelationsPanel() {
  const relations = useApp(state => state.summary?.relations ?? []);
  const documents = useApp(state => state.summary?.documents ?? []);
  const selectedId = useApp(state => state.selectedRelationId);
  const view = useApp(state => state.view);
  const [showContext, setShowContext] = useState(false);
  const [newSource, setNewSource] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const selected = relations.find(relation => relation.id === selectedId);
  const title = (id: string) => documents.find(doc => doc.id === id)?.title ?? '已删除文稿';
  const list = useMemo(() => relations.filter(relation => showContext || relation.kind !== 'context'), [relations, showContext]);
  const contextCount = relations.length - relations.filter(relation => relation.kind !== 'context').length;

  return (
    <div className="space-y-3 p-3">
      {selected ? <RelationEditor relation={selected} /> : (
        <div className="space-y-2 rounded-xl border border-dashed border-line p-3">
          <p className="text-xs text-ink-secondary">{view.type === 'canvas' ? '在画布上从一张文稿卡片拉出连线到另一张即可建立关系；也可在此选择两端。' : '选择两端文稿建立关系。'}</p>
          <div className="flex items-center gap-1.5">
            <select aria-label="起点" className="rc-input min-w-0 flex-1 text-xs" value={newSource} onChange={event => setNewSource(event.target.value)}>
              <option value="">起点文稿</option>
              {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title || '未命名'}</option>)}
            </select>
            <ArrowRightSmallIcon width={18} height={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
            <select aria-label="终点" className="rc-input min-w-0 flex-1 text-xs" value={newTarget} onChange={event => setNewTarget(event.target.value)}>
              <option value="">终点文稿</option>
              {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title || '未命名'}</option>)}
            </select>
          </div>
          <Button size="sm" variant="secondary" disabled={!newSource || !newTarget || newSource === newTarget} onClick={() => void createRelation(newSource, newTarget).then(() => { setNewSource(''); setNewTarget(''); })}>建立关系</Button>
        </div>
      )}
      <div>
        <SectionTitle action={contextCount > 0 ? <Button size="xs" variant="ghost" onClick={() => setShowContext(value => !value)}>{showContext ? '隐藏讨论来源连线' : `显示讨论来源连线（${contextCount}）`}</Button> : undefined}>
          工作区关系 · {list.length}
        </SectionTitle>
        {list.length === 0 ? <EmptyState title="暂无关系">关系可以先自由连线，再补充对应对象、成立条件、反例与出处。</EmptyState> : (
          <ul className="space-y-1">
            {list.map(relation => (
              <li key={relation.id}>
                <button
                  type="button"
                  onClick={() => app.set({ selectedRelationId: relation.id })}
                  className={`rc-focus-ring w-full rounded-lg px-2.5 py-2 text-left hover:bg-[var(--cds-fill-ghost-hover)] ${relation.id === selectedId ? 'bg-clay/8' : ''}`}
                >
                  <p className="flex items-center gap-1 text-[13px] text-ink">
                    <span className="min-w-0 max-w-[48%] shrink-0 truncate">{title(relation.source_id)}</span>
                    <ArrowRightSmallIcon width={16} height={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{title(relation.target_id)}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
                    <Chip tone={relation.kind === 'context' ? 'muted' : 'clay'}>{relation.kind === 'context' ? '讨论来源' : relation.kind}</Chip>
                    {relation.claim && <Chip tone={['verified', 'established', 'supported'].includes(relation.claim.status) ? 'ok' : relation.claim.status === 'refuted' ? 'bad' : relation.claim.status === 'candidate' ? 'warn' : 'muted'}>{CLAIM_STATUS_LABEL[relation.claim.status]}</Chip>}
                    {relation.claim?.review_required && <Chip tone="warn">待复核</Chip>}
                    {relation.claim && relation.claim.sources.length > 0 && <span>{relation.claim.sources.length} 条出处</span>}
                    {relation.label && <span className="truncate">{excerpt(relation.label, 40)}</span>}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
