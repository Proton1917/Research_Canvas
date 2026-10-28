import { CloseIcon, FolderIcon, PageIcon } from '@blocksuite/icons/rc';
import { Button, Dialog } from '@ui';
import { type DragEvent, useMemo, useRef, useState } from 'react';

import { errorText, importFiles, toast, useApp } from '../app/model';
import {
  addFolders, cancelImport, closeImportDialog, conflictVersion, findEntry, type ImportItem, itemProject, type ItemState, newImport, openImportDialog,
  overwriteConflicts, previewRoot, removeRoot, resumeImport, startImport, toggleInclude, toggleOverwrite, updateRoot, useImportJob, useTree,
} from '../app/projects';
import {
  entriesFromDrop, foldersFromEntries, foldersFromInput, hasDroppedFiles, pickFolder, supportsDirectoryPicker,
} from '../lib/folders';
import { formatBytes, TEXT_STATUS_LABEL, textStatusTone } from '../lib/format';
import { Chip } from './common';
import { FileFormatIcon, openProjectFile } from './ProjectTree';

const ITEM_LABEL: Record<ItemState, string> = {
  pending: '等待提交',
  sending: '上传中',
  imported: '新导入',
  updated: '已更新',
  unchanged: '内容相同 · 复用',
  conflict: '版本冲突',
  failed: '未保存',
  cancelled: '已取消 · 未提交',
  oversize: '超出请求上限',
};

const ITEM_TONE: Record<ItemState, 'ok' | 'warn' | 'bad' | 'muted' | 'clay'> = {
  pending: 'muted', sending: 'clay', imported: 'ok', updated: 'ok', unchanged: 'muted', conflict: 'warn', failed: 'bad', cancelled: 'muted', oversize: 'bad',
};

type Filter = 'all' | 'conflict' | 'notes' | 'failed';

/** 文件夹的选择入口：目录选择器优先（包含空目录），不支持时使用 webkitdirectory 文件输入。 */
function useFolderPicker() {
  const input = useRef<HTMLInputElement>(null);
  const pick = async () => {
    if (!supportsDirectoryPicker()) { input.current?.click(); return; }
    try {
      const folder = await pickFolder();
      if (folder) addFolders([folder]);
    } catch (error) {
      toast(`读取文件夹失败：${errorText(error)}`, 'error');
    }
  };
  const element = (
    <input
      ref={input}
      type="file"
      hidden
      multiple
      data-testid="folder-input"
      {...{ webkitdirectory: '', directory: '' }}
      onChange={event => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        const folders = foldersFromInput(files);
        if (folders.length) addFolders(folders);
      }}
    />
  );
  return { pick, input: element, chooseByInput: () => input.current?.click() };
}

/** 拖放一个或多个文件夹；顶层的单个文件按普通文件导入。 */
export async function dropFolders(event: DragEvent | globalThis.DragEvent) {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  const { entries, files } = entriesFromDrop(transfer);
  if (files.length) void importFiles(files);
  if (!entries.length) return;
  try {
    const folders = await foldersFromEntries(entries);
    addFolders(folders);
    openImportDialog();
  } catch (error) {
    toast(`读取拖入的文件夹失败：${errorText(error)}`, 'error');
  }
}

function Preview() {
  const roots = useImportJob(state => state.roots);
  const include = useImportJob(state => state.include);
  const capabilities = useTree(state => state.capabilities);
  const projects = useApp(state => state.projects);
  const previews = useMemo(() => roots.map(root => previewRoot(root, include, capabilities)), [roots, include, capabilities]);
  const skipped = useMemo(() => {
    const merged = new Map<string, { files: number; bytes: number }>();
    for (const preview of previews) for (const [name, count] of preview.skipped) {
      const current = merged.get(name) ?? { files: 0, bytes: 0 };
      merged.set(name, { files: current.files + count.files, bytes: current.bytes + count.bytes });
    }
    return Array.from(merged);
  }, [previews]);
  if (roots.length === 0) return null;
  return (
    <div className="space-y-3">
      {previews.map(preview => {
        const { root } = preview;
        const target = root.projectId ? projects.find(item => item.project.id === root.projectId) : null;
        return (
          <section key={root.id} className="rounded-xl border border-line bg-surface-1 p-3" data-testid="import-root" data-name={root.name}>
            <div className="flex items-center gap-2">
              <FolderIcon width={16} height={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
              <select
                aria-label="导入目标"
                className={`rc-input !w-auto py-1 text-[13px] ${root.projectId ? 'min-w-0 flex-1' : 'max-w-[45%] shrink-0'}`}
                value={root.projectId ?? ''}
                onChange={event => updateRoot(root.id, { projectId: event.target.value || null })}
              >
                <option value="">新建项目</option>
                {projects.map(item => <option key={item.project.id} value={item.project.id}>既有项目：{item.project.name}</option>)}
              </select>
              {!root.projectId && (
                <input aria-label="项目名称" className="rc-input min-w-0 flex-1 !w-auto py-1 text-[13px]" value={root.name} onChange={event => updateRoot(root.id, { name: event.target.value })} />
              )}
              <Button size="icon-sm" variant="ghost" aria-label={`移除文件夹 ${root.name}`} icon={<CloseIcon width={14} height={14} />} onClick={() => removeRoot(root.id)} />
            </div>
            <p className="mt-2 text-xs text-ink-secondary" data-testid="import-root-stats">
              {preview.files.length} 个文件 · {formatBytes(preview.bytes)}（{preview.bytes.toLocaleString()} 字节）· {preview.directories.length} 个目录
              {preview.emptyDirectories.length > 0 && `，其中 ${preview.emptyDirectories.length} 个空目录（随目录清单保存）`}
            </p>
            {root.projectId && target && (
              <p className="mt-1 text-xs text-ink-muted">导入既有项目「{target.project.name}」，该项目已有 {target.file_count} 个文件。同路径原件相同则复用，原件变化则生成新版本；文稿在上次导入后已编辑时列为冲突，由你确认是否覆盖。</p>
            )}
            {preview.oversize.length > 0 && (
              <ul className="mt-2 space-y-0.5 rounded-lg bg-orange-500/10 px-2.5 py-1.5 text-xs text-[var(--rc-bad)]">
                {preview.oversize.map(item => (
                  <li key={item.path}>「{item.path}」{formatBytes(item.file.size)}，超过单次请求上限 {formatBytes(capabilities?.max_request_bytes ?? 0)}，不会上传；可调整服务配置 max_request_bytes 或缩小文件范围。</li>
                ))}
              </ul>
            )}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-ink-muted">文件与目录清单</summary>
              <ul className="rc-scroll mt-1 max-h-48 space-y-px overflow-auto">
                {preview.emptyDirectories.map(path => (
                  <li key={`d:${path}`} className="flex items-center gap-1.5 text-ink-secondary"><FolderIcon width={14} height={14} aria-hidden="true" className="shrink-0" /><span className="truncate">{path}/</span><span className="ml-auto shrink-0 text-ink-muted">空目录</span></li>
                ))}
                {preview.files.slice(0, 400).map(item => (
                  <li key={item.path} className="flex items-center gap-1.5 text-ink-secondary"><FileFormatIcon name={item.path} /><span className="min-w-0 truncate">{item.path}</span><span className="ml-auto shrink-0 tabular-nums text-ink-muted">{formatBytes(item.file.size)}</span></li>
                ))}
                {preview.files.length > 400 && <li className="text-ink-muted">另有 {preview.files.length - 400} 个文件</li>}
              </ul>
            </details>
          </section>
        );
      })}
      {skipped.length > 0 && (
        <section className="rounded-xl border border-line px-3 py-2" data-testid="import-filters">
          <p className="text-xs font-medium text-ink">默认跳过的缓存、构建目录与系统文件</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">勾选后一并导入。</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {skipped.map(([name, count]) => (
              <li key={name}>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs text-ink-secondary">
                  <input type="checkbox" checked={include.includes(name)} onChange={() => toggleInclude(name)} />
                  <span className="font-mono">{name}</span>
                  <span className="text-ink-muted">{count.files} 个文件 · {formatBytes(count.bytes)}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ItemRow({ item, showRoot }: { item: ImportItem; showRoot: string | null }) {
  const overwrite = useImportJob(state => state.overwrite.includes(`${item.rootId}:${item.path}`));
  const phase = useImportJob(state => state.phase);
  const status = item.entry && item.entry.text_status !== 'directory' ? item.entry.text_status : null;
  const version = conflictVersion(item);
  const open = async () => {
    const projectId = itemProject(item);
    const documentId = item.entry?.document_id ?? (projectId ? (await findEntry(projectId, item.path).catch(() => null))?.document_id : null);
    if (documentId) void openProjectFile(documentId);
  };
  return (
    <li className="rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--cds-fill-ghost-hover)]" data-testid="import-item" data-path={item.path} data-state={item.state}>
      <div className="flex items-center gap-1.5">
        <FileFormatIcon name={item.path} />
        <span className="min-w-0 flex-1 truncate text-ink" title={item.path}>{showRoot && <span className="text-ink-muted">{showRoot}/</span>}{item.path}</span>
        <span className="shrink-0 tabular-nums text-ink-muted">{formatBytes(item.file.size)}</span>
        {status && status !== 'ready' && <Chip tone={textStatusTone(status)}>{TEXT_STATUS_LABEL[status]}</Chip>}
        <Chip tone={ITEM_TONE[item.state]}>{ITEM_LABEL[item.state]}</Chip>
      </div>
      {item.entry?.message && <p className="mt-0.5 whitespace-pre-wrap pl-6 text-ink-secondary">{item.entry.message}</p>}
      {item.error && item.state !== 'conflict' && <p className="mt-0.5 pl-6 text-[var(--rc-bad)]">{item.error.message}</p>}
      {item.state === 'conflict' && (
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-6">
          <span className="text-[var(--rc-warn)]">
            {item.error?.code === 'version_conflict' ? `工作区文稿在上次导入后已有编辑${version != null ? `（当前版本 ${version}）` : ''}，本次未覆盖。` : item.error?.message}
          </span>
          {version != null && phase !== 'running' && (
            <label className="inline-flex items-center gap-1 text-ink">
              <input type="checkbox" checked={overwrite} onChange={() => toggleOverwrite(item)} />
              以导入原件覆盖版本 {version}
            </label>
          )}
          <button type="button" className="rc-focus-ring rounded text-clay hover:underline" onClick={() => void open()}>查看当前文稿</button>
        </div>
      )}
      {(item.state === 'imported' || item.state === 'updated' || item.state === 'unchanged') && item.entry?.document_id && (
        <p className="mt-0.5 pl-6 text-ink-muted">
          文稿版本 {item.entry.imported_version ?? '?'} ·{' '}
          <button type="button" className="rc-focus-ring rounded text-clay hover:underline" onClick={() => void openProjectFile(item.entry!.document_id!)}>打开</button>
        </p>
      )}
    </li>
  );
}

function Progress() {
  const job = useImportJob(state => state);
  const [filter, setFilter] = useState<Filter>('all');
  const sendable = job.items.filter(item => item.state !== 'oversize');
  // 已处理：服务端已返回结果（保存、复用或冲突）的文件
  const finished = sendable.filter(item => ['imported', 'updated', 'unchanged', 'conflict'].includes(item.state));
  const doneBytes = finished.reduce((sum, item) => sum + item.file.size, 0);
  const totalBytes = sendable.reduce((sum, item) => sum + item.file.size, 0);
  const counts = new Map<ItemState, number>();
  for (const item of job.items) counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
  const shown = job.items.filter(item => filter === 'all'
    || (filter === 'conflict' && item.state === 'conflict')
    || (filter === 'failed' && ['failed', 'cancelled', 'oversize'].includes(item.state))
    || (filter === 'notes' && !!item.entry && item.entry.text_status !== 'ready' && item.entry.text_status !== 'directory'));
  const rootName = (id: string) => (job.roots.length > 1 ? job.roots.find(root => root.id === id)?.name ?? null : null);
  const percent = sendable.length ? Math.round((finished.length / sendable.length) * 100) : 100;
  return (
    <div className="space-y-3">
      <div data-testid="import-progress">
        <div className="flex items-center justify-between text-xs text-ink-secondary">
          <span>{job.phase === 'running' ? `正在提交第 ${job.batch.index} / ${job.batch.total} 批` : job.phase === 'done' ? '导入完成' : '导入已停止'}</span>
          <span className="tabular-nums">已处理 {finished.length} / {sendable.length} 个文件 · {formatBytes(doneBytes)} / {formatBytes(totalBytes)}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--cds-alpha-1)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-clay transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="import-counts">
          {Array.from(counts).map(([state, count]) => <Chip key={state} tone={ITEM_TONE[state]}>{ITEM_LABEL[state]} {count}</Chip>)}
        </div>
      </div>
      {job.stop && (
        <p className={`rounded-lg px-3 py-2 text-xs ${job.stop.reason === 'failed' ? 'bg-orange-500/10 text-[var(--rc-bad)]' : 'bg-[var(--cds-alpha-1)] text-ink-secondary'}`} data-testid="import-stop">
          {job.stop.reason === 'failed' ? `提交中断：${job.stop.message}。已完成的批次已保存，可继续处理剩余文件。` : job.stop.message}
        </p>
      )}
      <div className="flex gap-1 border-b border-line" role="tablist">
        {([['all', '全部'], ['conflict', `冲突 ${counts.get('conflict') ?? 0}`], ['notes', '读取说明'], ['failed', '未保存']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={filter === id} type="button" onClick={() => setFilter(id)} className={`rc-focus-ring -mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${filter === id ? 'border-clay text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      <ul className="rc-scroll max-h-[42vh] space-y-px overflow-auto" data-testid="import-items">
        {shown.slice(0, 600).map(item => <ItemRow key={`${item.rootId}:${item.path}`} item={item} showRoot={rootName(item.rootId)} />)}
        {shown.length === 0 && <li className="px-2 py-4 text-center text-xs text-ink-muted">没有符合条件的文件</li>}
        {shown.length > 600 && <li className="px-2 py-1 text-xs text-ink-muted">另有 {shown.length - 600} 项</li>}
      </ul>
    </div>
  );
}

export function ProjectImportDialog() {
  const open = useImportJob(state => state.open);
  const phase = useImportJob(state => state.phase);
  const roots = useImportJob(state => state.roots);
  const include = useImportJob(state => state.include);
  const items = useImportJob(state => state.items);
  const overwrite = useImportJob(state => state.overwrite.length);
  const capabilities = useTree(state => state.capabilities);
  const [dragging, setDragging] = useState(false);
  const { pick, input, chooseByInput } = useFolderPicker();
  const totals = useMemo(() => {
    const previews = roots.map(root => previewRoot(root, include, capabilities));
    return { files: previews.reduce((sum, item) => sum + item.files.length, 0), bytes: previews.reduce((sum, item) => sum + item.bytes, 0), dirs: previews.reduce((sum, item) => sum + item.emptyDirectories.length, 0) };
  }, [roots, include, capabilities]);
  const remaining = items.filter(item => item.state === 'failed' || item.state === 'cancelled').length;
  const busy = phase === 'running';

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (phase === 'preview') void dropFolders(event);
  };

  const footer = phase === 'preview' ? (
    <>
      <Button size="sm" variant="ghost" onClick={closeImportDialog}>取消</Button>
      <Button size="sm" variant="primary" disabled={totals.files === 0 && totals.dirs === 0} onClick={() => void startImport()}>
        开始导入（{totals.files} 个文件 · {formatBytes(totals.bytes)}）
      </Button>
    </>
  ) : (
    <>
      {busy && <Button size="sm" variant="secondary" onClick={cancelImport}>取消后续批次</Button>}
      {!busy && remaining > 0 && <Button size="sm" variant="secondary" onClick={() => void resumeImport()}>继续导入未保存的 {remaining} 个文件</Button>}
      {!busy && overwrite > 0 && <Button size="sm" variant="primary" onClick={() => void overwriteConflicts()}>覆盖所选 {overwrite} 个文件</Button>}
      {!busy && <Button size="sm" variant="ghost" onClick={newImport}>新的导入</Button>}
      <Button size="sm" variant={busy ? 'ghost' : 'primary'} onClick={closeImportDialog}>{busy ? '在后台继续' : '完成'}</Button>
    </>
  );

  return (
    <Dialog open={open} onClose={closeImportDialog} title="导入项目文件夹" width="max-w-3xl" footer={footer}
      description="顶层文件夹作为项目名称，其下路径作为项目内相对路径保存；多个文件夹分别成为项目。文件正文在打开或选为材料时读取。工作区归档请使用“从 JSON 归档恢复”。">
      {input}
      {phase === 'preview' ? (
        <div className="space-y-3">
          <div
            data-testid="folder-drop"
            onDragOver={event => { if (hasDroppedFiles(event.dataTransfer)) { event.preventDefault(); setDragging(true); } }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs ${dragging ? 'border-clay bg-clay/8' : 'border-line'}`}
          >
            <Button size="sm" variant="secondary" icon={<FolderIcon width={16} height={16} />} onClick={() => void pick()}>{roots.length ? '再添加一个文件夹' : '选择文件夹'}</Button>
            {supportsDirectoryPicker() && <Button size="sm" variant="ghost" icon={<PageIcon width={16} height={16} />} title="浏览器上传对话框不报告空目录" onClick={chooseByInput}>以上传对话框选择</Button>}
            <span className="text-ink-muted">或把一个或多个文件夹拖到这里。</span>
          </div>
          <Preview />
        </div>
      ) : (
        <Progress />
      )}
    </Dialog>
  );
}
