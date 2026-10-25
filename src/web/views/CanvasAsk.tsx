// 画布就近提问：选择对象 → 材料与写入范围预览 → 发送 → 讨论框放在所选对象附近。
import { CloseIcon, SendIcon, ViewIcon } from '@blocksuite/icons/rc';
import { Button, SegmentedControl } from '@ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  capabilityOn, type CanvasAsk, closeAsk, previewAsk, sendAsk, toggleAskMaterial, updateAsk, useApp,
} from '../app/model';
import type { Material, MaterialGroup } from '../app/materials';
import { Chip } from '../components/common';
import { RunOutput } from '../panels/DiscussionPanel';
import { parseProposalDraft } from './CanvasProposal';

const GROUP_LABEL: Record<MaterialGroup, string> = {
  body: '将提交的正文',
  history: '历史来源（父讨论冻结材料）',
  locate: '仅供定位：位置、分组与连线',
};

/** legacyOnly：服务只接收片段与文稿时显示各项的提交限制。 */
function MaterialRow({ material, legacyOnly }: { material: Material; legacyOnly: boolean }) {
  const blocked = !material.legacy;
  return (
    <li className="flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--cds-fill-ghost-hover)]">
      <input
        type="checkbox"
        className="mt-1 accent-[var(--cds-clay)]"
        checked={material.include}
        onChange={() => toggleAskMaterial(material.key)}
        aria-label={`选入：${material.label}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-ink" title={material.label}>{material.label}</span>
        <span className="block truncate text-[11px] text-ink-muted" title={material.detail}>{material.detail}</span>
        {material.include && legacyOnly && material.caveat && <span className="block text-[11px] text-[var(--rc-warn)]">{material.caveat}</span>}
        {material.include && legacyOnly && blocked && material.needsScene && <span className="block text-[11px] text-ink-muted">{material.needsScene}</span>}
      </span>
      {material.version != null && <Chip className="shrink-0">v{material.version}</Chip>}
    </li>
  );
}

/** 画布操作生成中：JSON 草稿按接收进度显示分析正文与候选标题。 */
function DraftProgress({ answer }: { answer: string }) {
  const draft = parseProposalDraft(answer);
  return (
    <div className="rounded-lg border border-[#8e6cdf]/40 bg-[#8e6cdf]/5 px-2.5 py-2 text-xs text-ink" aria-live="polite" data-testid="proposal-stream">
      <p className="font-medium">正在生成画布操作 · 已接收 {answer.length.toLocaleString()} 字符</p>
      {draft.titles.length > 0 && <ul className="mt-1 list-disc pl-4">{draft.titles.map(title => <li key={title}>候选框：{title}</li>)}</ul>}
      {draft.labels.length > 0 && <ul className="mt-1 list-disc pl-4">{draft.labels.map(label => <li key={label}>候选联系：{label}</li>)}</ul>}
      {draft.analysis && <p className="mt-1 line-clamp-4 text-ink-secondary">{draft.analysis}</p>}
    </div>
  );
}

/** 写入区域在画布上的虚线框；拖动调整位置（世界坐标）。 */
export function WriteRegion({ ask, toView, zoom }: { ask: CanvasAsk; toView: (x: number, y: number) => [number, number]; zoom: number }) {
  const drag = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);
  if (!ask.region) return null;
  const [left, top] = toView(ask.region.x, ask.region.y);
  return (
    <div
      className="pointer-events-auto absolute z-10 cursor-move rounded-xl border-2 border-dashed border-clay/70 bg-clay/5"
      style={{ left, top, width: ask.region.width * zoom, height: ask.region.height * zoom }}
      onPointerDown={event => {
        event.stopPropagation();
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, rx: ask.region!.x, ry: ask.region!.y };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || !ask.region) return;
        updateAsk({ region: { ...ask.region, x: Math.round(start.rx + (event.clientX - start.x) / zoom), y: Math.round(start.ry + (event.clientY - start.y) / zoom) } });
      }}
      onPointerUp={() => { drag.current = null; }}
      data-testid="write-region"
    >
      <span className="absolute left-2 top-1.5 rounded bg-surface-popover/90 px-1.5 py-0.5 text-[11px] text-clay shadow-sm">AI 写入区域 · 拖动调整</span>
    </div>
  );
}

export function CanvasAskPanel({ ask, left, top }: { ask: CanvasAsk; left: number; top: number }) {
  const run = useApp(state => (ask.runId ? state.runs.find(item => item.id === ask.runId) : undefined));
  const connection = useApp(state => state.connection);
  const checked = useApp(state => state.capabilitiesChecked);
  const capabilities = useApp(state => state.capabilities);
  const sceneReady = capabilityOn(capabilities, 'scene_context');
  const proposalsReady = capabilityOn(capabilities, 'canvas_proposals');
  const [showAll, setShowAll] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textarea.current?.focus(); }, [ask.ids.join(',')]);

  const groups = useMemo(() => {
    const map = new Map<MaterialGroup, Material[]>();
    for (const material of ask.materials) map.set(material.group, [...(map.get(material.group) ?? []), material]);
    return (['body', 'history', 'locate'] as MaterialGroup[]).filter(group => map.has(group)).map(group => ({ group, items: map.get(group)! }));
  }, [ask.materials]);
  const included = ask.materials.filter(item => item.include);
  const transferable = included.filter(item => item.legacy).length;
  const sceneOnly = included.filter(item => !item.legacy).length;
  const live = run && (run.status === 'queued' || run.status === 'running');

  return (
    <section
      aria-label="向 AI 提问"
      className="rc-pop-in pointer-events-auto absolute z-30 flex max-h-[min(78vh,640px)] w-[min(400px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-popover"
      style={{ left, top }}
      onPointerDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold text-ink">向 AI 提问</span>
        <Chip tone="clay">{ask.projection.objects.length} 个对象</Chip>
        <Chip>{ask.projection.entry === 'canvas' ? '整张画布' : ask.projection.entry === 'group' ? '分组/框' : '所选对象'}</Chip>
        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="关闭提问" icon={<CloseIcon width={16} height={16} />} onClick={closeAsk} />
      </div>
      <div className="rc-scroll min-h-0 flex-1 space-y-2.5 overflow-auto px-3 py-2.5">
        <SegmentedControl
          ariaLabel="回答方式"
          size="sm"
          items={[{ id: 'canvas', label: '在画布上创建' }, { id: 'discussion', label: '讨论框' }]}
          value={ask.mode}
          onChange={mode => {
            if (mode === 'canvas' && !proposalsReady) return;
            updateAsk({ mode: mode as 'canvas' | 'discussion', context: null, contextKey: null });
          }}
        />
        <textarea
          ref={textarea}
          rows={3}
          value={ask.question}
          aria-label="问题"
          placeholder="例如：看看我画的这条联系是否成立，分析两个结构保持了哪些运算"
          className="rc-input block w-full resize-y text-[13px] leading-relaxed"
          onChange={event => updateAsk({ question: event.target.value })}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendAsk(); }
          }}
        />
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-muted">AI 将读取 · 已选 {included.length} 项</span>
            <button type="button" className="rc-focus-ring rounded text-[11px] text-clay hover:underline" onClick={() => setShowAll(value => !value)}>{showAll ? '收起' : '展开全部'}</button>
          </div>
          {groups.map(({ group, items }) => (
            <div key={group} className="mb-1.5">
              <p className="px-1.5 text-[11px] font-medium text-ink-secondary">{GROUP_LABEL[group]}</p>
              <ul>{(showAll ? items : items.slice(0, 5)).map(item => <MaterialRow key={item.key} material={item} legacyOnly={!sceneReady} />)}</ul>
              {!showAll && items.length > 5 && <p className="px-1.5 text-[11px] text-ink-muted">另有 {items.length - 5} 项</p>}
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-[var(--cds-alpha-1)] px-2.5 py-2 text-[11px] text-ink-secondary">
          <p className="font-medium text-ink">本次允许写入</p>
          {ask.region ? (
            <p>画布虚线区域：({ask.region.x}, {ask.region.y})，{ask.region.width}×{ask.region.height}。</p>
          ) : <p>所选对象没有几何范围，按视口中心放置。</p>}
          <p className="mt-1">
            {ask.mode === 'canvas'
              ? '允许新建框、公式与候选联系；生成内容先作为候选显示，确认后才写入，可整组撤销。'
              : proposalsReady ? '生成的讨论框放在此区域，与来源保持连线。' : '画布提案接口未接通；本次只写入讨论框，与来源保持连线。'}
          </p>
        </div>
        <div className="rounded-lg border border-line px-2.5 py-2 text-[11px] text-ink-secondary" data-testid="ask-capability">
          {!checked ? '正在读取服务能力…' : sceneReady
            ? <>场景上下文已接通：提交所选对象的投影与 {included.length} 项勾选材料（正文、片段版本、位置、连线与分组），服务冻结后返回实际消息。</>
            : <>当前服务仅接收片段与文稿：本次提交 <b className="text-ink">{transferable}</b> 项；位置、连线、关系记录与画布内文字等 <b className="text-ink">{sceneOnly}</b> 项需要场景上下文接口，不会发送。</>}
        </div>
        {ask.error && <p role="alert" className="text-xs text-[var(--rc-bad)]">{ask.error}</p>}
        {run && ask.mode === 'canvas' && live ? (
          <DraftProgress answer={run.answer} />
        ) : run && <RunOutput run={run} compact />}
        {run?.status === 'succeeded' && run.canvas_proposal_id && <p className="text-[11px] text-[var(--rc-ok)]">候选内容已在画布上显示，请在提案面板中调整、确认或拒绝。</p>}
        {run?.status === 'succeeded' && ask.placed && <p className="text-[11px] text-[var(--rc-ok)]">讨论框已放在写入区域，可继续编辑、选段讨论或分支。</p>}
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
        <Button size="sm" variant="ghost" icon={<ViewIcon width={16} height={16} />} isLoading={ask.busy === 'preview'} disabled={!ask.question.trim() || !!ask.busy || connection !== 'online'} onClick={() => void previewAsk(true)}>
          {ask.context ? '查看上下文' : '预览上下文'}
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="primary" icon={<SendIcon width={16} height={16} />} isLoading={ask.busy === 'send' || !!live} disabled={!ask.question.trim() || !!ask.busy || !!live || connection !== 'online' || (!sceneReady && transferable === 0)} title={!sceneReady && transferable === 0 ? '没有可由当前服务接收的材料' : undefined} onClick={() => void sendAsk()}>
          发送
        </Button>
      </div>
    </section>
  );
}
