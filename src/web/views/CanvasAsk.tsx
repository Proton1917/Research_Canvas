// 画布就近提问：选择对象 → 材料与写入范围预览 → 发送 → 讨论框放在所选对象附近。
import { CloseIcon, ImageIcon, PlusIcon, SendIcon, ViewIcon } from '@blocksuite/icons/rc';
import { Button, SegmentedControl } from '@ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  addNeighborsToAsk, type AskProblem, type CanvasAsk, captureAskRegion, closeAsk, documentById, previewAsk, removeAskVisual,
  sendAsk, setModel, staleSummary, toggleAskMaterial, updateAsk, useApp,
} from '../app/model';
import type { Material, MaterialGroup } from '../app/materials';
import { Chip } from '../components/common';
import { RunOutput } from '../panels/DiscussionPanel';
import { parseProposalDraft } from './CanvasProposal';

const GROUP_LABEL: Record<MaterialGroup, string> = {
  body: '将提交的正文',
  history: '历史来源（父讨论冻结材料）',
  visual: '图像（由视觉模型读取）',
  locate: '仅供定位：位置、分组与连线',
};

const GROUP_ORDER: MaterialGroup[] = ['body', 'visual', 'history', 'locate'];

const formatBytes = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function MaterialRow({ material }: { material: Material }) {
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
      </span>
      {material.version != null && <Chip className="shrink-0">v{material.version}</Chip>}
    </li>
  );
}

/** 服务拒绝发送的原因：变化的对象、超出预算的来源或图像限制。 */
function ProblemDetail({ problem }: { problem: AskProblem }) {
  switch (problem.type) {
    case 'stale':
      return <p>冻结后有变化：{staleSummary(problem.changes) || '材料版本已更新'}。</p>;
    case 'budget':
      return (
        <>
          <p>文字共 {problem.count.toLocaleString()} 字符，超过上限 {problem.limit.toLocaleString()}。请取消勾选较长的来源：</p>
          <ul className="mt-0.5 list-disc pl-4">
            {[...problem.sources].sort((a, b) => b.character_count - a.character_count).map(source => (
              <li key={source.number}>[{source.number}] {documentById(source.document_id)?.title || source.document_id} · {source.character_count.toLocaleString()} 字符</li>
            ))}
          </ul>
        </>
      );
    default:
      return <p>{problem.message}</p>;
  }
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
  const { visionModels, maxCharacters, maxImageBytes } = useApp(state => ({
    visionModels: (state.capabilities?.vision_models ?? []).join('\n'),
    maxCharacters: state.capabilities?.max_input_characters ?? null,
    maxImageBytes: state.capabilities?.max_input_image_bytes ?? null,
  }));
  const model = useApp(state => state.model);
  const [showAll, setShowAll] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textarea.current?.focus(); }, [ask.ids.join(',')]);

  const groups = useMemo(() => {
    const map = new Map<MaterialGroup, Material[]>();
    for (const material of ask.materials) map.set(material.group, [...(map.get(material.group) ?? []), material]);
    return GROUP_ORDER.filter(group => map.has(group)).map(group => ({ group, items: map.get(group)! }));
  }, [ask.materials]);
  const included = ask.materials.filter(item => item.include);
  const imageCount = included.filter(item => item.group === 'visual').length + ask.visuals.length;
  const vision = visionModels ? visionModels.split('\n') : [];
  const blind = imageCount > 0 && !vision.includes(model);
  const characters = ask.context?.character_count ?? null;
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
          items={[{ id: 'discussion', label: '讨论框' }, { id: 'canvas', label: '在画布上创建' }]}
          value={ask.mode}
          onChange={mode => updateAsk({ mode: mode as 'canvas' | 'discussion', context: null, contextKey: null })}
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
              <ul>{(showAll ? items : items.slice(0, 5)).map(item => <MaterialRow key={item.key} material={item} />)}</ul>
              {!showAll && items.length > 5 && <p className="px-1.5 text-[11px] text-ink-muted">另有 {items.length - 5} 项</p>}
            </div>
          ))}
          {ask.visuals.length > 0 && (
            <div className="mb-1.5" data-testid="ask-visuals">
              <p className="px-1.5 text-[11px] font-medium text-ink-secondary">选区截图（由视觉模型读取）</p>
              {included.length === 0 && <p className="px-1.5 text-[11px] text-[var(--rc-warn)]">截图关联本轮选入的对象：请至少保留一项所选对象的材料（如定位或想法）。</p>}
              <ul>
                {ask.visuals.map(visual => (
                  <li key={visual.asset_id} className="flex items-center gap-2 rounded-lg px-1.5 py-1">
                    <img src={visual.url} alt="" className="size-9 shrink-0 rounded border border-line object-cover" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={visual.label}>{visual.label}</span>
                    <Chip className={maxImageBytes != null && visual.bytes > maxImageBytes ? 'text-[var(--rc-bad)]' : 'shrink-0'}>{formatBytes(visual.bytes)}</Chip>
                    <Button size="icon-sm" variant="ghost" aria-label={`移除截图：${visual.label}`} icon={<CloseIcon width={14} height={14} />} onClick={() => removeAskVisual(visual.asset_id)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 px-1">
            <Button size="xs" variant="outline" icon={<PlusIcon width={14} height={14} />} disabled={!!ask.busy} onClick={addNeighborsToAsk}>加入附近对象</Button>
            <Button size="xs" variant="outline" icon={<ImageIcon width={14} height={14} />} isLoading={ask.busy === 'capture'} disabled={!!ask.busy} onClick={() => void captureAskRegion()}>截取选区图像</Button>
          </div>
        </div>
        {blind && (
          <div className="rounded-lg border border-[var(--rc-warn)]/50 px-2.5 py-2 text-[11px] text-ink-secondary" data-testid="ask-vision">
            <p>本次附带 {imageCount} 张图像，当前模型 <span className="font-mono">{model || '默认模型'}</span> 不读取图像。</p>
            {vision.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">{vision.map(id => <Button key={id} size="xs" variant="secondary" onClick={() => setModel(id)}>改用 {id}</Button>)}</div>
            ) : <p>服务没有配置视觉模型；请取消图像后发送。</p>}
          </div>
        )}
        <div className="rounded-lg bg-[var(--cds-alpha-1)] px-2.5 py-2 text-[11px] text-ink-secondary">
          <p className="font-medium text-ink">本次允许写入</p>
          {ask.region ? (
            <p>画布虚线区域：({ask.region.x}, {ask.region.y})，{ask.region.width}×{ask.region.height}。</p>
          ) : <p>所选对象没有几何范围，按视口中心放置。</p>}
          <p className="mt-1">
            {ask.mode === 'canvas'
              ? '允许新建框、公式与候选联系；生成内容先作为候选显示，确认后才写入，可整组撤销。'
              : '回答作为可编辑的讨论框放在此区域，与来源保持连线。'}
          </p>
        </div>
        <div className="rounded-lg border border-line px-2.5 py-2 text-[11px] text-ink-secondary" data-testid="ask-budget">
          {characters != null ? (
            <p>
              已冻结：文字 <b className={maxCharacters != null && characters > maxCharacters ? 'text-[var(--rc-bad)]' : 'text-ink'}>{characters.toLocaleString()}</b>
              {maxCharacters != null && <> / {maxCharacters.toLocaleString()}</>} 字符{imageCount > 0 && <>，图像 {imageCount} 张</>}。发送前会保存相关文稿与画布并重新冻结。
            </p>
          ) : <p>发送前保存相关文稿与画布，按勾选的 {included.length} 项材料{imageCount > 0 && `与 ${imageCount} 张图像`}冻结本轮阅读{maxCharacters != null && `；文字上限 ${maxCharacters.toLocaleString()} 字符`}。</p>}
        </div>
        {(ask.error || ask.problem) && (
          <div role="alert" className="space-y-0.5 text-xs text-[var(--rc-bad)]" data-testid="ask-problem">
            {ask.error && <p>{ask.error}</p>}
            {ask.problem && <ProblemDetail problem={ask.problem} />}
          </div>
        )}
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
        <Button size="sm" variant="primary" icon={<SendIcon width={16} height={16} />} isLoading={ask.busy === 'send' || !!live} disabled={!ask.question.trim() || !!ask.busy || !!live || connection !== 'online' || included.length === 0} title={included.length === 0 ? '请至少勾选一项材料' : undefined} onClick={() => void sendAsk()}>
          发送
        </Button>
      </div>
    </section>
  );
}
