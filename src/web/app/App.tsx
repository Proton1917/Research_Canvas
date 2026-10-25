import {
  ChatWithAiIcon, CloseIcon, CommentIcon, DarkModeIcon, DownloadIcon, EdgelessIcon, HistoryIcon, ImportIcon, LightModeIcon,
  LinkIcon, MoreHorizontalIcon, NoteShadowDuotoneIcon, PageIcon, PlusIcon, SearchIcon, SidebarIcon, TimelineIcon,
} from '@blocksuite/icons/rc';
import type { DocumentKind, ResearchDocument } from '@research';
import { Button, ClayBreatheDot, PulseRunningDot, SegmentedControl } from '@ui';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';

import { Dialogs } from '../components/dialogs';
import { KindIcon, MenuItem, Popover, SectionTitle } from '../components/common';
import { AnchorsPanel } from '../panels/AnchorsPanel';
import { DiscussionPanel } from '../panels/DiscussionPanel';
import { RelationsPanel } from '../panels/RelationsPanel';
import { RunsPanel } from '../panels/RunsPanel';
import { VersionsPanel } from '../panels/VersionsPanel';
import { CanvasView, DOC_DRAG_TYPE } from '../views/CanvasView';
import { DocumentView } from '../views/DocumentView';
import {
  addMaterialDocument, app, boot, checkHealth, createCanvas, createDocument, dismissToast, exportWith, getSession,
  importFiles, openCanvas, openDocument, placeOnCanvas, restoreArchive, setDialogs, setTab, setTheme, useApp, type PanelTab,
} from './model';

function ConnectionPill() {
  const connection = useApp(state => state.connection);
  const health = useApp(state => state.health);
  const error = useApp(state => state.connectionError);
  const running = useApp(state => state.runs.filter(run => run.status === 'running' || run.status === 'queued').length);
  if (connection === 'checking') return <ClayBreatheDot label="连接后端" />;
  if (connection === 'offline') {
    return (
      <button type="button" onClick={() => void checkHealth()} title={error ?? undefined} className="rc-focus-ring inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-orange-500/12 px-2.5 py-1 text-[11px] font-medium text-[var(--rc-bad)]">
        <span className="size-2 rounded-full bg-[var(--rc-bad)]" aria-hidden="true" />后端未连接 · 重试
      </button>
    );
  }
  if (running > 0) return <PulseRunningDot label={`${running} 个生成任务`} />;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-500/10 p-1.5 text-[11px] font-medium text-[var(--rc-ok)] sm:px-2.5 sm:py-1" title={`数据库 ${health?.database ?? ''}`}>
      <span className="size-2 rounded-full bg-[var(--rc-ok)]" aria-hidden="true" />
      {/* 窄屏只保留状态点，文字供读屏使用 */}
      <span className="sr-only sm:not-sr-only">{health?.provider_configured ? '服务就绪' : '服务就绪 · 未配置模型凭据'}</span>
    </span>
  );
}

function Header() {
  const workspace = useApp(state => state.summary?.workspace ?? state.workspaces.find(item => item.id === state.workspaceId));
  const dark = useApp(state => state.dark);
  const [menu, setMenu] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const view = useApp(state => state.view);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-2 sm:px-3">
      <Button size="icon-sm" variant="ghost" className="lg:hidden" aria-label="打开导航" icon={<SidebarIcon width={18} height={18} />} onClick={() => app.set(state => ({ sidebarOpen: !state.sidebarOpen }))} />
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-clay text-[13px] font-bold text-white" aria-hidden="true">R</span>
        <span className="hidden text-sm font-semibold text-ink sm:inline">Research Canvas</span>
        <button type="button" onClick={() => setDialogs({ workspace: true })} className="rc-focus-ring min-w-0 max-w-[14rem] truncate rounded-md px-2 py-1 text-[13px] text-ink-secondary hover:bg-[var(--cds-fill-ghost-hover)] hover:text-ink" title="切换或管理工作区">
          {workspace?.name ?? '工作区'}
        </button>
      </div>
      <button type="button" onClick={() => setDialogs({ search: true })} className="rc-focus-ring mx-auto hidden h-8 w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-surface-3 px-3 text-left text-[13px] text-ink-muted hover:border-line-strong md:flex">
        <SearchIcon width={16} height={16} />
        <span className="flex-1">检索文稿与讨论</span>
        <kbd className="rounded border border-line px-1.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5 md:ml-0">
        <Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="检索" icon={<SearchIcon width={18} height={18} />} onClick={() => setDialogs({ search: true })} />
        <ConnectionPill />
        <Button size="sm" variant="ghost" className="hidden sm:inline-flex" icon={<ImportIcon width={16} height={16} />} onClick={() => fileInput.current?.click()}>导入</Button>
        <input ref={fileInput} type="file" multiple hidden accept=".pdf,.md,.markdown,.txt,text/plain,text/markdown,application/pdf,image/*"
          onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void importFiles(files, { place: view.type === 'canvas' }); }} />
        <div className="relative">
          <Button size="icon-sm" variant="ghost" aria-label="导出与归档" aria-expanded={menu} icon={<MoreHorizontalIcon width={18} height={18} />} onClick={() => setMenu(open => !open)} />
          <Popover open={menu} onClose={() => setMenu(false)} className="right-0 w-60">
            <MenuItem icon={<ImportIcon width={16} height={16} />} onClick={() => { setMenu(false); fileInput.current?.click(); }}>导入 PDF、Markdown、文本或图片</MenuItem>
            <MenuItem icon={<DownloadIcon width={16} height={16} />} hint="可恢复" onClick={() => { setMenu(false); void exportWith('json'); }}>导出完整 JSON 归档</MenuItem>
            <MenuItem icon={<DownloadIcon width={16} height={16} />} hint="Markdown · SVG" onClick={() => { setMenu(false); void exportWith('zip'); }}>导出 ZIP（文稿与关系图）</MenuItem>
            <MenuItem icon={<HistoryIcon width={16} height={16} />} onClick={() => { setMenu(false); archiveInput.current?.click(); }}>从 JSON 归档恢复工作区</MenuItem>
          </Popover>
          <input ref={archiveInput} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void restoreArchive(file); }} />
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={dark ? '切换到浅色' : '切换到深色'} icon={dark ? <LightModeIcon width={18} height={18} /> : <DarkModeIcon width={18} height={18} />} onClick={() => setTheme(!dark)} />
        <Button size="icon-sm" variant="ghost" className="xl:hidden" aria-label="打开研究面板" icon={<ChatWithAiIcon width={18} height={18} />} onClick={() => app.set(state => ({ panelOpen: !state.panelOpen }))} />
      </div>
    </header>
  );
}

const GROUPS: { kind: DocumentKind; label: string }[] = [
  { kind: 'document', label: '研究文稿' },
  { kind: 'pdf', label: 'PDF 来源' },
  { kind: 'note', label: '想法' },
  { kind: 'discussion', label: '讨论' },
  { kind: 'image', label: '图片' },
];

function DocumentItem({ doc, active }: { doc: ResearchDocument; active: boolean }) {
  const [menu, setMenu] = useState(false);
  return (
    <li className="group relative">
      <button
        type="button"
        draggable
        onDragStart={event => { event.dataTransfer.setData(DOC_DRAG_TYPE, doc.id); event.dataTransfer.effectAllowed = 'copy'; }}
        onClick={() => openDocument(doc.id)}
        className={`rc-focus-ring flex w-full items-center gap-2 rounded-lg py-1.5 pl-2 pr-8 text-left text-[13px] ${active ? 'bg-[var(--cds-fill-ghost-selected)] font-medium text-ink' : 'text-ink-secondary hover:bg-[var(--cds-fill-ghost-hover)] hover:text-ink'}`}
        title={doc.title}
      >
        <KindIcon kind={doc.kind} className="text-ink-muted" />
        <span className="min-w-0 flex-1 truncate">{doc.kind === 'discussion' ? (doc.metadata.question ?? doc.title) : doc.title || '未命名'}</span>
      </button>
      <button type="button" aria-label={`${doc.title} 的操作`} onClick={() => setMenu(open => !open)} className="rc-focus-ring absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-ink-muted hover:bg-[var(--cds-fill-ghost-hover)] hover:text-ink focus-visible:block group-hover:block">
        <MoreHorizontalIcon width={14} height={14} />
      </button>
      <Popover open={menu} onClose={() => setMenu(false)} className="right-0 top-7 w-48">
        <MenuItem icon={<EdgelessIcon width={16} height={16} />} onClick={() => { setMenu(false); void placeOnCanvas(doc.id); }}>放到当前画布</MenuItem>
        <MenuItem icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => { setMenu(false); addMaterialDocument(doc.id); }}>作为讨论材料</MenuItem>
        <MenuItem icon={<PageIcon width={16} height={16} />} onClick={() => { setMenu(false); openDocument(doc.id); }}>打开精读</MenuItem>
      </Popover>
    </li>
  );
}

function Sidebar() {
  const summary = useApp(state => state.summary);
  const view = useApp(state => state.view);
  const loading = useApp(state => state.loadingWorkspace);
  const error = useApp(state => state.workspaceError);
  const connection = useApp(state => state.connection);
  const fileInput = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => GROUPS.map(group => ({ ...group, docs: (summary?.documents ?? []).filter(doc => doc.kind === group.kind).sort((a, b) => b.updated_at.localeCompare(a.updated_at)) })), [summary?.documents]);
  return (
    <nav aria-label="工作区导航" className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 p-2">
        <Button size="sm" variant="secondary" className="flex-1" icon={<PlusIcon width={16} height={16} />} disabled={!summary} onClick={() => void createDocument('document', '', { open: true })}>新文稿</Button>
        <Button size="sm" variant="ghost" icon={<NoteShadowDuotoneIcon width={16} height={16} />} disabled={!summary} onClick={() => void createDocument('note', '', { place: view.type === 'canvas', open: view.type !== 'canvas' })}>想法</Button>
        <Button size="icon-sm" variant="ghost" aria-label="导入文件" disabled={!summary} icon={<ImportIcon width={16} height={16} />} onClick={() => fileInput.current?.click()} />
        <input ref={fileInput} type="file" multiple hidden accept=".pdf,.md,.markdown,.txt,text/plain,text/markdown,application/pdf,image/*"
          onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void importFiles(files); }} />
      </div>
      <div className="rc-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {connection === 'offline' && !summary && <p className="px-2 py-3 text-xs text-ink-muted">后端服务连接后载入工作区。</p>}
        {loading && <div className="px-2 py-3"><ClayBreatheDot label="载入工作区" /></div>}
        {error && <p className="px-2 py-3 text-xs text-[var(--rc-bad)]">{error}</p>}
        {summary && (
          <>
            <SectionTitle action={<Button size="xs" variant="ghost" aria-label="新建画布" icon={<PlusIcon width={14} height={14} />} onClick={() => void createCanvas(`画布 ${summary.canvases.length + 1}`)} />}>画布</SectionTitle>
            <ul className="space-y-0.5">
              {summary.canvases.map(canvas => (
                <li key={canvas.id}>
                  <button type="button" onClick={() => openCanvas(canvas.id)} className={`rc-focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${view.type === 'canvas' && view.id === canvas.id ? 'bg-[var(--cds-fill-ghost-selected)] font-medium text-ink' : 'text-ink-secondary hover:bg-[var(--cds-fill-ghost-hover)] hover:text-ink'}`}>
                    <KindIcon kind="canvas" className="text-ink-muted" />
                    <span className="min-w-0 flex-1 truncate">{canvas.name}</span>
                    <span className="text-[11px] tabular-nums text-ink-muted">{canvas.objects.length}</span>
                  </button>
                </li>
              ))}
            </ul>
            {groups.filter(group => group.docs.length > 0).map(group => (
              <div key={group.kind}>
                <SectionTitle>{group.label} · {group.docs.length}</SectionTitle>
                <ul className="space-y-0.5">
                  {group.docs.map(doc => <DocumentItem key={doc.id} doc={doc} active={view.type === 'document' && view.id === doc.id} />)}
                </ul>
              </div>
            ))}
            {summary.documents.length === 0 && (
              <p className="px-2 py-4 text-xs leading-relaxed text-ink-muted">新建文稿或导入调研 PDF、Markdown、文本和图片，再拖到画布中组织。</p>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

const TABS: { id: PanelTab; label: string; icon: ReactElement }[] = [
  { id: 'discuss', label: '讨论', icon: <ChatWithAiIcon width={14} height={14} /> },
  { id: 'anchors', label: '批注', icon: <CommentIcon width={14} height={14} /> },
  { id: 'relations', label: '关系', icon: <LinkIcon width={14} height={14} /> },
  { id: 'versions', label: '版本', icon: <HistoryIcon width={14} height={14} /> },
  { id: 'runs', label: '运行', icon: <TimelineIcon width={14} height={14} /> },
];

function ResearchPanel() {
  const tab = useApp(state => state.tab);
  return (
    <aside aria-label="研究面板" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-2">
        <SegmentedControl ariaLabel="研究面板" size="sm" className="flex-1" items={TABS} value={tab} onChange={setTab} />
        <Button size="icon-sm" variant="ghost" className="xl:hidden" aria-label="关闭研究面板" icon={<CloseIcon width={16} height={16} />} onClick={() => app.set({ panelOpen: false })} />
      </div>
      <div className="rc-scroll min-h-0 flex-1 overflow-y-auto">
        {tab === 'discuss' && <DiscussionPanel />}
        {tab === 'anchors' && <AnchorsPanel />}
        {tab === 'relations' && <RelationsPanel />}
        {tab === 'versions' && <VersionsPanel />}
        {tab === 'runs' && <RunsPanel />}
      </div>
    </aside>
  );
}

function Toasts() {
  const toasts = useApp(state => state.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[1100] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {toasts.map(item => (
        <div key={item.id} role={item.tone === 'error' ? 'alert' : 'status'} className={`rc-pop-in pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] shadow-popover ${item.tone === 'error' ? 'border-orange-500/30 bg-surface-popover text-[var(--rc-bad)]' : 'border-line bg-surface-popover text-ink'}`}>
          <span className="min-w-0 flex-1 leading-snug">{item.text}</span>
          {item.action && <Button size="xs" variant="secondary" onClick={() => { item.action!.run(); dismissToast(item.id); }}>{item.action.label}</Button>}
          <button type="button" aria-label="关闭提示" className="rc-focus-ring rounded p-0.5 text-ink-muted hover:text-ink" onClick={() => dismissToast(item.id)}><CloseIcon width={14} height={14} /></button>
        </div>
      ))}
    </div>
  );
}

function MainView() {
  const view = useApp(state => state.view);
  const connection = useApp(state => state.connection);
  const error = useApp(state => state.connectionError);
  if (view.type === 'canvas') return <CanvasView key={view.id} canvasId={view.id} />;
  if (view.type === 'document') return <DocumentView key={view.id} documentId={view.id} focusAnchorId={view.focus?.anchorId ?? null} />;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {connection === 'offline' ? (
        <>
          <p className="text-sm font-medium text-ink">正在等待后端服务</p>
          <p className="max-w-md text-xs leading-relaxed text-ink-muted">前端通过 /api 连接 Research Canvas 服务。服务启动后自动载入工作区。{error ? `最近一次错误：${error}` : ''}</p>
          <Button size="sm" variant="secondary" onClick={() => void checkHealth()}>立即重试</Button>
        </>
      ) : (
        <ClayBreatheDot label="载入工作区" />
      )}
    </div>
  );
}

export function App() {
  const sidebarOpen = useApp(state => state.sidebarOpen);
  const panelOpen = useApp(state => state.panelOpen);
  const view = useApp(state => state.view);

  useEffect(() => { void boot(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); setDialogs({ search: true }); }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        const current = app.get().view;
        const s = getSession();
        if (current.type === 'document') void s?.saveDocument(current.id);
        if (current.type === 'canvas') void s?.saveCanvas(current.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-surface-0 text-ink">
      <Header />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className={`absolute inset-y-0 left-0 z-40 w-[var(--rc-sidebar)] border-r border-line bg-surface-1 transition-transform duration-200 lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0 shadow-lg' : '-translate-x-full'}`}>
          <Sidebar />
        </div>
        {(sidebarOpen || panelOpen) && <div className="absolute inset-0 z-30 bg-black/25 xl:hidden" onClick={() => app.set({ sidebarOpen: false, panelOpen: false })} aria-hidden="true" />}
        <main className="min-w-0 flex-1" aria-label={view.type === 'canvas' ? '画布' : '文稿'}>
          <MainView />
        </main>
        <div className={`absolute inset-y-0 right-0 z-40 w-[min(100vw,var(--rc-panel))] border-l border-line bg-surface-1 transition-transform duration-200 xl:static xl:translate-x-0 ${panelOpen ? 'translate-x-0 shadow-lg' : 'translate-x-full'}`}>
          <ResearchPanel />
        </div>
      </div>
      <Toasts />
      <Dialogs />
    </div>
  );
}
