import {
  ChatWithAiIcon, CodeIcon, DownloadIcon, EdgelessIcon, FileIcon, FileIconCsvIcon, FileIconDocxIcon, FileIconJsonIcon, FileIconMdIcon,
  FileIconPdfIcon, FileIconPptxIcon, FileIconTxtIcon, FileIconXlsxIcon, FolderIcon, ImageIcon, MoreHorizontalIcon, PageIcon,
  ToggleDownIcon, ToggleRightIcon, UploadIcon,
} from '@blocksuite/icons/rc';
import { api, type ProjectEntry, type ProjectSummary } from '@research';
import { Button } from '@ui';
import { type ReactElement, useState } from 'react';

import { addMaterialDocument, loadDocument, openDocument, placeOnCanvas, useApp } from '../app/model';
import { dirKey, loadDirectory, openImportDialog, toggleDirectory, useImportJob, useTree } from '../app/projects';
import { formatBytes, TEXT_STATUS_LABEL, TEXT_STATUS_NOTE, textStatusTone } from '../lib/format';
import { DOC_DRAG_TYPE } from '../views/CanvasView';
import { Chip, MenuItem, Popover, SectionTitle } from './common';

const ICON_PROPS = { width: 16, height: 16, 'aria-hidden': true, className: 'shrink-0 text-ink-muted' } as const;

/** 按扩展名选择文件图标；未知格式使用通用文件图标。 */
export function FileFormatIcon({ name }: { name: string }): ReactElement {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(extension)) return <FileIconXlsxIcon {...ICON_PROPS} />;
  if (['pptx', 'ppt', 'pptm', 'ppsx', 'ppsm', 'potx'].includes(extension)) return <FileIconPptxIcon {...ICON_PROPS} />;
  if (['docx', 'doc'].includes(extension)) return <FileIconDocxIcon {...ICON_PROPS} />;
  if (extension === 'pdf') return <FileIconPdfIcon {...ICON_PROPS} />;
  if (['md', 'markdown', 'mdx', 'note'].includes(extension)) return <FileIconMdIcon {...ICON_PROPS} />;
  if (['json', 'jsonl', 'ipynb'].includes(extension)) return <FileIconJsonIcon {...ICON_PROPS} />;
  if (['csv', 'tsv'].includes(extension)) return <FileIconCsvIcon {...ICON_PROPS} />;
  if (['txt', 'log'].includes(extension)) return <FileIconTxtIcon {...ICON_PROPS} />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic'].includes(extension)) return <ImageIcon {...ICON_PROPS} />;
  if (['ts', 'tsx', 'js', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'swift', 'kt', 'rb', 'sh', 'toml', 'yaml', 'yml', 'html', 'css', 'sql', 'tex'].includes(extension)) return <CodeIcon {...ICON_PROPS} />;
  return <FileIcon {...ICON_PROPS} />;
}

/** 打开项目文件：按 document_id 取得完整文稿后进入精读视图。 */
export async function openProjectFile(documentId: string) {
  if (await loadDocument(documentId)) openDocument(documentId);
}

const INDENT = 12;

function FileNode({ entry, depth }: { entry: ProjectEntry; depth: number }) {
  const active = useApp(state => state.view.type === 'document' && state.view.id === entry.document_id);
  const [menu, setMenu] = useState(false);
  const status = entry.text_status === 'directory' ? null : entry.text_status;
  const documentId = entry.document_id;
  return (
    <li className="group relative" data-testid="project-file" data-path={entry.path}>
      <button
        type="button"
        draggable={!!documentId}
        onDragStart={event => { if (documentId) { event.dataTransfer.setData(DOC_DRAG_TYPE, documentId); event.dataTransfer.effectAllowed = 'copy'; } }}
        onClick={() => { if (documentId) void openProjectFile(documentId); }}
        className={`rc-focus-ring flex w-full items-center gap-1.5 rounded-lg py-1 pr-8 text-left text-[12.5px] ${active ? 'bg-[var(--cds-fill-ghost-selected)] font-medium text-ink' : 'text-ink-secondary hover:bg-[var(--cds-fill-ghost-hover)] hover:text-ink'}`}
        style={{ paddingLeft: 8 + depth * INDENT + 14 }}
        title={`${entry.path} · ${formatBytes(entry.byte_length)}${status ? ` · ${TEXT_STATUS_NOTE[status]}` : ''}${entry.message ? `\n${entry.message}` : ''}`}
      >
        <FileFormatIcon name={entry.name} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {status && status !== 'ready' && <Chip tone={textStatusTone(status)} className="h-4 px-1.5 text-[10px]">{TEXT_STATUS_LABEL[status]}</Chip>}
      </button>
      <button type="button" aria-label={`${entry.name} 的操作`} onClick={() => setMenu(open => !open)} className="rc-focus-ring absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-ink-muted hover:bg-[var(--cds-fill-ghost-hover)] hover:text-ink focus-visible:block group-hover:block">
        <MoreHorizontalIcon width={14} height={14} />
      </button>
      <Popover open={menu} onClose={() => setMenu(false)} className="right-0 top-6 w-52">
        <MenuItem icon={<PageIcon width={16} height={16} />} disabled={!documentId} onClick={() => { setMenu(false); if (documentId) void openProjectFile(documentId); }}>打开精读</MenuItem>
        <MenuItem icon={<EdgelessIcon width={16} height={16} />} disabled={!documentId} onClick={() => { setMenu(false); if (documentId) void placeOnCanvas(documentId); }}>放到当前画布</MenuItem>
        <MenuItem icon={<ChatWithAiIcon width={16} height={16} />} disabled={!documentId} onClick={() => { setMenu(false); if (documentId) addMaterialDocument(documentId); }}>作为讨论材料</MenuItem>
        {entry.asset_id && (
          <a href={api.assetUrl(entry.asset_id)} download={entry.name} onClick={() => setMenu(false)} className="rc-focus-ring flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-[var(--cds-fill-ghost-hover)]">
            <span className="flex shrink-0 text-ink-secondary"><DownloadIcon width={16} height={16} /></span>
            <span className="min-w-0 flex-1 truncate">下载原件</span>
            <span className="shrink-0 text-[11px] text-ink-muted">{formatBytes(entry.byte_length)}</span>
          </a>
        )}
      </Popover>
    </li>
  );
}

function DirectoryNode({ projectId, entry, depth }: { projectId: string; entry: ProjectEntry; depth: number }) {
  const open = useTree(state => !!state.expanded[dirKey(projectId, entry.path)]);
  return (
    <li data-testid="project-directory" data-path={entry.path}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggleDirectory(projectId, entry.path)}
        className="rc-focus-ring flex w-full items-center gap-1 rounded-lg py-1 pr-2 text-left text-[12.5px] text-ink-secondary hover:bg-[var(--cds-fill-ghost-hover)] hover:text-ink"
        style={{ paddingLeft: 8 + depth * INDENT }}
      >
        {open ? <ToggleDownIcon width={14} height={14} className="shrink-0" aria-hidden="true" /> : <ToggleRightIcon width={14} height={14} className="shrink-0" aria-hidden="true" />}
        <FolderIcon {...ICON_PROPS} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {open && <DirectoryChildren projectId={projectId} path={entry.path} depth={depth + 1} />}
    </li>
  );
}

function DirectoryChildren({ projectId, path, depth }: { projectId: string; path: string; depth: number }) {
  const dir = useTree(state => state.dirs[dirKey(projectId, path)]);
  const pad = { paddingLeft: 8 + depth * INDENT + 14 };
  return (
    <ul className="space-y-px" data-testid="project-children" data-parent={path}>
      {dir?.entries.map(entry => entry.kind === 'directory'
        ? <DirectoryNode key={entry.path} projectId={projectId} entry={entry} depth={depth} />
        : <FileNode key={entry.path} entry={entry} depth={depth} />)}
      {dir?.loaded && dir.entries.length === 0 && <li className="py-1 text-[11.5px] text-ink-muted" style={pad}>空目录</li>}
      {dir?.loading && <li className="py-1 text-[11.5px] text-ink-muted" style={pad}>读取中…</li>}
      {dir?.error && (
        <li className="py-1 text-[11.5px] text-[var(--rc-bad)]" style={pad}>
          {dir.error} <button type="button" className="underline" onClick={() => void loadDirectory(projectId, path, dir.loaded)}>重试</button>
        </li>
      )}
      {dir?.cursor && !dir.loading && (
        <li style={pad}>
          <button type="button" className="rc-focus-ring rounded py-1 text-[11.5px] text-clay hover:underline" onClick={() => void loadDirectory(projectId, path, true)}>
            加载更多（已显示 {dir.entries.length} 项）
          </button>
        </li>
      )}
    </ul>
  );
}

function ProjectNode({ summary }: { summary: ProjectSummary }) {
  const { project } = summary;
  const open = useTree(state => !!state.expanded[dirKey(project.id, '')]);
  return (
    <li data-testid="project-node" data-project={project.name}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggleDirectory(project.id, '')}
        className="rc-focus-ring flex w-full items-center gap-1 rounded-lg py-1.5 pl-2 pr-2 text-left text-[13px] text-ink hover:bg-[var(--cds-fill-ghost-hover)]"
        title={`${project.name} · ${summary.file_count} 个文件 · ${formatBytes(summary.byte_length)}`}
      >
        {open ? <ToggleDownIcon width={14} height={14} className="shrink-0" aria-hidden="true" /> : <ToggleRightIcon width={14} height={14} className="shrink-0" aria-hidden="true" />}
        <FolderIcon {...ICON_PROPS} />
        <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{summary.file_count}</span>
      </button>
      {open && <DirectoryChildren projectId={project.id} path="" depth={1} />}
    </li>
  );
}

/** 侧栏的项目目录：每个项目按目录分页展开，文件正文在打开或使用时读取。 */
export function ProjectsSection() {
  const projects = useApp(state => state.projects);
  const running = useImportJob(state => (state.phase === 'running' ? state.batch : null));
  const hidden = useImportJob(state => !state.open && state.phase !== 'preview');
  return (
    <div data-testid="projects-section">
      <SectionTitle action={<Button size="xs" variant="ghost" aria-label="导入项目文件夹" title="导入项目文件夹" icon={<UploadIcon width={14} height={14} />} onClick={openImportDialog} />}>
        项目 · {projects.length}
      </SectionTitle>
      {hidden && (
        <button type="button" onClick={openImportDialog} className="rc-focus-ring mb-1 w-full rounded-lg bg-clay/10 px-2 py-1 text-left text-[11.5px] text-clay">
          {running ? `导入进行中 · 第 ${running.index}/${running.total} 批，查看进度` : '查看上次导入结果'}
        </button>
      )}
      {projects.length === 0 ? (
        <button type="button" onClick={openImportDialog} className="rc-focus-ring w-full rounded-lg border border-dashed border-line px-2 py-2 text-left text-[11.5px] leading-relaxed text-ink-muted hover:border-line-strong hover:text-ink">
          选择整个文件夹作为项目导入，保留目录与相对路径；可加入多个项目。
        </button>
      ) : (
        <ul className="space-y-px">
          {projects.map(summary => <ProjectNode key={summary.project.id} summary={summary} />)}
        </ul>
      )}
    </div>
  );
}
