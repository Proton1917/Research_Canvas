// 项目目录与文件夹导入：目录树分页读取、导入预览与筛选、分批上传、取消、继续处理和冲突覆盖。
import {
  api, ApiError, type ApiErrorBody, type ImportCapabilities, type ProjectEntry, type ProjectImportResult,
} from '@research';

import type { Folder, FolderFile } from '../lib/folders';
import { createStore, useStore } from '../lib/store';
import { app, documentById, errorText, getSession, toast, upsertDocument } from './model';

// ------------------------------------------------------------------ 目录树
export type DirState = { entries: ProjectEntry[]; cursor: string | null; loading: boolean; error: string | null; loaded: boolean };

type TreeState = {
  workspaceId: string | null;
  /** `${projectId}/${path}` → 是否展开；项目根目录的 path 为空 */
  expanded: Record<string, boolean>;
  dirs: Record<string, DirState>;
  capabilities: ImportCapabilities | null;
};

export const tree = createStore<TreeState>({ workspaceId: null, expanded: {}, dirs: {}, capabilities: null });
export const useTree = <S,>(selector: (state: TreeState) => S) => useStore(tree, selector);

export const dirKey = (projectId: string, path: string) => `${projectId}/${path}`;

/** 切换工作区时清空目录缓存 */
function currentTree() {
  const workspaceId = app.get().workspaceId;
  if (tree.get().workspaceId !== workspaceId) tree.set({ workspaceId, expanded: {}, dirs: {} });
  return tree.get();
}

function patchDir(key: string, patch: Partial<DirState>) {
  tree.set(state => {
    const previous = state.dirs[key] ?? { entries: [], cursor: null, loading: false, error: null, loaded: false };
    return { dirs: { ...state.dirs, [key]: { ...previous, ...patch } } };
  });
}

/** 读取目录的一页条目；more 为真时从上页的 next_cursor 继续。 */
export async function loadDirectory(projectId: string, path: string, more = false) {
  currentTree();
  const key = dirKey(projectId, path);
  const current = tree.get().dirs[key];
  if (current?.loading) return;
  const workspaceId = app.get().workspaceId;
  patchDir(key, { loading: true, error: null });
  try {
    const page = await api.projectEntries(projectId, { parent: path, after: more ? current?.cursor ?? undefined : undefined });
    if (app.get().workspaceId !== workspaceId) return;
    const entries = more ? [...(tree.get().dirs[key]?.entries ?? []), ...page.entries] : page.entries;
    patchDir(key, { entries, cursor: page.next_cursor, loading: false, loaded: true });
  } catch (error) {
    patchDir(key, { loading: false, error: errorText(error) });
  }
}

export function toggleDirectory(projectId: string, path: string) {
  currentTree();
  const key = dirKey(projectId, path);
  const open = !tree.get().expanded[key];
  tree.set(state => ({ expanded: { ...state.expanded, [key]: open } }));
  if (open && !tree.get().dirs[key]?.loaded) void loadDirectory(projectId, path);
}

/** 导入后重新读取项目中已读取过的目录，保持原先已载入的条目数量。 */
async function refreshProjectTree(projectId: string) {
  const loaded = Object.entries(tree.get().dirs).filter(([key, dir]) => key.startsWith(`${projectId}/`) && dir.loaded);
  await Promise.all(loaded.map(async ([key, dir]) => {
    const path = key.slice(projectId.length + 1);
    const wanted = dir.entries.length;
    await loadDirectory(projectId, path);
    while ((tree.get().dirs[key]?.entries.length ?? 0) < wanted && tree.get().dirs[key]?.cursor) await loadDirectory(projectId, path, true);
  }));
}

export async function loadImportCapabilities() {
  const known = tree.get().capabilities;
  if (known) return known;
  const capabilities = await api.importCapabilities();
  tree.set({ capabilities });
  return capabilities;
}

/** 在项目目录中查找某一路径的条目（冲突结果不含条目时用于打开对应文稿）。 */
export async function findEntry(projectId: string, path: string): Promise<ProjectEntry | null> {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  let after: string | undefined;
  for (;;) {
    const page = await api.projectEntries(projectId, { parent, after });
    const found = page.entries.find(entry => entry.path === path);
    if (found) return found;
    if (!page.next_cursor) return null;
    after = page.next_cursor;
  }
}

// ------------------------------------------------------------------ 导入预览与筛选
/** 默认跳过的缓存与构建目录、系统文件；用户可在预览中逐项纳入。 */
export const DEFAULT_EXCLUDES = [
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.ipynb_checkpoints',
  '.cache', '.next', '.nuxt', '.parcel-cache', '.turbo', '.gradle', '.idea', '.vs', 'dist', 'build', 'target', 'out', 'coverage',
  '.runtime', '.DS_Store', 'Thumbs.db', 'desktop.ini',
];

/** 路径命中的默认跳过项（任一段名称），未命中时为 null。 */
export function excludedBy(path: string, include: string[]) {
  for (const part of path.split('/')) if (DEFAULT_EXCLUDES.includes(part) && !include.includes(part)) return part;
  return null;
}

export type ImportRoot = {
  id: string;
  /** 新建项目的名称；导入既有项目时显示该项目名 */
  name: string;
  /** null：新建项目；否则导入到既有项目 */
  projectId: string | null;
  files: FolderFile[];
  directories: string[];
};

export type ItemState = 'pending' | 'sending' | 'imported' | 'updated' | 'unchanged' | 'conflict' | 'failed' | 'cancelled' | 'oversize';
export type ImportItem = {
  rootId: string;
  path: string;
  file: File;
  state: ItemState;
  entry?: ProjectEntry;
  error?: ApiErrorBody['error'];
  /** 用户确认覆盖时携带的版本前提 */
  expected?: number;
};

export type ImportJob = {
  open: boolean;
  roots: ImportRoot[];
  /** 默认跳过项中由用户选择纳入的名称 */
  include: string[];
  phase: 'preview' | 'running' | 'stopped' | 'done';
  items: ImportItem[];
  /** rootId → 实际项目标识（新建后记录） */
  projects: Record<string, string>;
  /** 已提交过目录清单的项目 */
  directoriesSent: string[];
  batch: { index: number; total: number };
  cancel: boolean;
  stop: { reason: 'cancelled' | 'failed'; message: string } | null;
  /** 选中准备覆盖的冲突路径（rootId:path） */
  overwrite: string[];
};

const emptyJob: ImportJob = {
  open: false, roots: [], include: [], phase: 'preview', items: [], projects: {}, directoriesSent: [],
  batch: { index: 0, total: 0 }, cancel: false, stop: null, overwrite: [],
};

export const importJob = createStore<ImportJob>(emptyJob);
export const useImportJob = <S,>(selector: (state: ImportJob) => S) => useStore(importJob, selector);

let rootSeq = 0;

export function openImportDialog() {
  const job = importJob.get();
  // 进行中或已有结果时回到原任务；新的预览从空选择开始
  if (job.phase !== 'preview') importJob.set({ open: true });
  else importJob.set({ ...emptyJob, open: true });
  void loadImportCapabilities().catch(error => toast(`读取导入能力失败：${errorText(error)}`, 'error'));
}

/**
 * 关闭对话框。上传在关闭后继续进行；仍有冲突或未保存文件的结果保留，可从侧栏再次打开处理。
 */
export function closeImportDialog() {
  const job = importJob.get();
  if (job.phase === 'running' || (job.phase !== 'preview' && hasUnresolved(job))) importJob.set({ open: false });
  else importJob.set({ ...emptyJob });
}

function hasUnresolved(job: ImportJob) {
  return job.items.some(item => ['conflict', 'failed', 'cancelled'].includes(item.state));
}

/** 放弃上次结果，开始新的选择。 */
export function newImport() {
  importJob.set({ ...emptyJob, open: true });
}

/** 加入选择的文件夹；与既有项目同名时默认导入该项目（再次导入同一项目）。 */
export function addFolders(folders: Folder[]) {
  const projects = app.get().projects;
  const job = importJob.get();
  if (job.phase === 'running' || (job.phase !== 'preview' && hasUnresolved(job))) {
    // 进行中或仍有冲突、未保存文件的导入保留原结果，处理后再加入新的文件夹
    importJob.set({ open: true });
    toast(job.phase === 'running' ? '当前导入仍在进行，完成后再加入新的文件夹。' : '上次导入还有冲突或未保存的文件，处理后选择“新的导入”再加入文件夹。', 'info');
    return;
  }
  if (job.phase !== 'preview') importJob.set({ ...emptyJob, open: true });
  void loadImportCapabilities().catch(error => toast(`读取导入能力失败：${errorText(error)}`, 'error'));
  const roots = folders.map(folder => {
    folder.files.sort((a, b) => a.path.localeCompare(b.path));
    const existing = projects.find(item => item.project.name === folder.name);
    return { id: `root-${++rootSeq}`, name: folder.name, projectId: existing?.project.id ?? null, files: folder.files, directories: folder.directories };
  });
  importJob.set(state => ({ open: true, roots: [...state.roots, ...roots] }));
}

export function updateRoot(id: string, patch: Partial<Pick<ImportRoot, 'name' | 'projectId'>>) {
  importJob.set(state => ({ roots: state.roots.map(root => (root.id === id ? { ...root, ...patch } : root)) }));
}

export function removeRoot(id: string) {
  importJob.set(state => ({ roots: state.roots.filter(root => root.id !== id) }));
}

export function toggleInclude(name: string) {
  importJob.set(state => ({ include: state.include.includes(name) ? state.include.filter(item => item !== name) : [...state.include, name] }));
}

export type RootPreview = {
  root: ImportRoot;
  files: FolderFile[];
  directories: string[];
  emptyDirectories: string[];
  bytes: number;
  oversize: FolderFile[];
  /** 默认跳过项 → 命中的文件数与字节数 */
  skipped: Map<string, { files: number; bytes: number }>;
};

const BATCH_BYTES = 16 * 1024 * 1024;
const BATCH_FILES = 24;

/**
 * 单次请求中为 multipart 清单、字段头与分隔预留的字节数：请求上限的 1/16，介于 32 KiB 与 256 KiB。
 * 一批至多 24 个文件的字段头与清单项在此范围内；目录清单较大时单独提交。
 */
export function requestReserve(capabilities: ImportCapabilities | null) {
  if (!capabilities) return 0;
  return Math.min(256 * 1024, Math.max(32 * 1024, Math.floor(capabilities.max_request_bytes / 16)));
}

/** 单个文件可用的大小：请求上限扣除 multipart 预留空间。预览筛选与分批使用同一数值。 */
export function fileLimit(capabilities: ImportCapabilities | null) {
  return capabilities ? capabilities.max_request_bytes - requestReserve(capabilities) : Infinity;
}

/** 超出单文件可用大小的说明，列出请求上限与预留空间 */
export function oversizeMessage(bytes: number, capabilities: ImportCapabilities) {
  return `文件 ${bytes.toLocaleString()} 字节，超过单个文件可用的 ${fileLimit(capabilities).toLocaleString()} 字节（请求上限 ${capabilities.max_request_bytes.toLocaleString()} 字节，其中 ${requestReserve(capabilities).toLocaleString()} 字节预留给 multipart 清单与分隔）；可调整服务配置 max_request_bytes 或跳过该文件`;
}

export function previewRoot(root: ImportRoot, include: string[], capabilities: ImportCapabilities | null): RootPreview {
  const skipped = new Map<string, { files: number; bytes: number }>();
  const files: FolderFile[] = [];
  const oversize: FolderFile[] = [];
  const limit = fileLimit(capabilities);
  for (const item of root.files) {
    const hit = excludedBy(item.path, []);
    if (hit) {
      const count = skipped.get(hit) ?? { files: 0, bytes: 0 };
      skipped.set(hit, { files: count.files + 1, bytes: count.bytes + item.file.size });
    }
    if (excludedBy(item.path, include)) continue;
    if (item.file.size > limit) oversize.push(item);
    else files.push(item);
  }
  for (const directory of root.directories) {
    const hit = excludedBy(directory, []);
    if (hit && !skipped.has(hit)) skipped.set(hit, { files: 0, bytes: 0 });
  }
  const directories = root.directories.filter(directory => !excludedBy(directory, include));
  // 空目录：既无文件也无子目录，只能通过目录清单保存
  const used = new Set<string>();
  for (const path of [...files.map(item => item.path), ...oversize.map(item => item.path), ...directories]) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) used.add(parts.slice(0, i).join('/'));
  }
  const emptyDirectories = directories.filter(directory => !used.has(directory));
  return { root, files, directories, emptyDirectories, bytes: files.reduce((sum, item) => sum + item.file.size, 0), oversize, skipped };
}

// ------------------------------------------------------------------ 分批上传
function batches(items: ImportItem[], capabilities: ImportCapabilities) {
  const limit = Math.min(BATCH_BYTES, fileLimit(capabilities));
  const result: ImportItem[][] = [];
  let current: ImportItem[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length > 0 && (current.length >= BATCH_FILES || bytes + item.file.size > limit)) {
      result.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.file.size;
  }
  if (current.length) result.push(current);
  return result;
}

const itemKey = (item: { rootId: string; path: string }) => `${item.rootId}:${item.path}`;

function patchItems(keys: Set<string>, patch: (item: ImportItem) => Partial<ImportItem>) {
  importJob.set(state => ({ items: state.items.map(item => (keys.has(itemKey(item)) ? { ...item, ...patch(item) } : item)) }));
}

/** 按预览结果建立导入清单并开始上传。 */
export async function startImport() {
  const job = importJob.get();
  let capabilities: ImportCapabilities;
  try {
    capabilities = await loadImportCapabilities();
  } catch (error) {
    toast(`读取导入能力失败：${errorText(error)}`, 'error');
    return;
  }
  const previews = job.roots.map(root => previewRoot(root, job.include, capabilities));
  const items: ImportItem[] = previews.flatMap(preview => [
    ...preview.files.map(item => ({ rootId: preview.root.id, path: item.path, file: item.file, state: 'pending' as const })),
    ...preview.oversize.map(item => ({
      rootId: preview.root.id, path: item.path, file: item.file, state: 'oversize' as const,
      error: { code: 'too_large', message: oversizeMessage(item.file.size, capabilities) },
    })),
  ]);
  importJob.set({ items, phase: 'running', cancel: false, stop: null, projects: {}, directoriesSent: [], overwrite: [] });
  await runImport(previews.map(preview => ({ rootId: preview.root.id, directories: preview.directories })));
}

/** 取消：已发出的批次按实际响应更新，后续批次不再提交。 */
export function cancelImport() {
  if (importJob.get().phase === 'running') importJob.set({ cancel: true });
}

let directoryPlan: Array<{ rootId: string; directories: string[] }> = [];

async function runImport(plan?: Array<{ rootId: string; directories: string[] }>) {
  if (plan) directoryPlan = plan;
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) { importJob.set({ phase: 'stopped', stop: { reason: 'failed', message: '尚未打开工作区' } }); return; }
  importJob.set({ phase: 'running', cancel: false, stop: null });
  const touched = new Set<string>();
  const updatedDocs = new Set<string>();
  try {
    const capabilities = await loadImportCapabilities();
    const roots = importJob.get().roots;
    const queue = roots.map(root => ({ root, items: importJob.get().items.filter(item => item.rootId === root.id && item.state === 'pending') }));
    const planned = queue.map(({ root, items }) => {
      const groups = batches(items, capabilities);
      // 目录清单超过预留空间的一半时先单独提交，文件批次保持预留空间
      const directories = directoryPlan.find(item => item.rootId === root.id)?.directories ?? [];
      const large = !importJob.get().directoriesSent.includes(root.id) && new TextEncoder().encode(JSON.stringify(directories)).length > requestReserve(capabilities) / 2;
      return { root, groups: large && groups.length ? [[], ...groups] : groups };
    });
    const total = planned.reduce((sum, { root, groups }) => {
      const needsDirectories = !importJob.get().directoriesSent.includes(root.id) && (directoryPlan.find(item => item.rootId === root.id)?.directories.length ?? 0) > 0;
      return sum + Math.max(groups.length, needsDirectories ? 1 : 0);
    }, 0);
    let index = 0;
    importJob.set({ batch: { index: 0, total } });
    for (const { root, groups } of planned) {
      const directories = directoryPlan.find(item => item.rootId === root.id)?.directories ?? [];
      const needsDirectories = !importJob.get().directoriesSent.includes(root.id) && directories.length > 0;
      if (groups.length === 0 && !needsDirectories) continue;
      if (importJob.get().cancel) break;
      let projectId = root.projectId ?? importJob.get().projects[root.id];
      if (!projectId) {
        const project = await api.createProject(workspaceId, root.name.trim() || '未命名项目');
        projectId = project.id;
        importJob.set(state => ({ projects: { ...state.projects, [root.id]: project.id } }));
        await refreshProjects();
      }
      touched.add(projectId);
      for (const group of groups.length ? groups : [[]]) {
        if (importJob.get().cancel) break;
        const keys = new Set(group.map(itemKey));
        patchItems(keys, () => ({ state: 'sending' }));
        importJob.set({ batch: { index: ++index, total } });
        const sendDirectories = !importJob.get().directoriesSent.includes(root.id);
        let result: ProjectImportResult;
        try {
          result = await api.importProjectFiles(projectId, group.map(item => ({ file: item.file, path: item.path, expected_version: item.expected })), sendDirectories ? directories : []);
        } catch (error) {
          patchItems(keys, () => ({ state: 'failed', error: { code: error instanceof ApiError ? error.code : 'network', message: errorText(error) } }));
          throw error;
        }
        if (sendDirectories) importJob.set(state => ({ directoriesSent: [...state.directoriesSent, root.id] }));
        const byPath = new Map(result.results.map(entry => [entry.path, entry]));
        importJob.set(state => ({
          items: state.items.map(item => {
            if (!keys.has(itemKey(item))) return item;
            const outcome = byPath.get(item.path);
            if (!outcome) return { ...item, state: 'failed', error: { code: 'missing_result', message: '服务响应中没有此文件的结果' } };
            if (outcome.status === 'conflict') return { ...item, state: 'conflict', error: outcome.error, entry: undefined };
            if (outcome.status === 'updated' && outcome.entry.document_id) updatedDocs.add(outcome.entry.document_id);
            return { ...item, state: outcome.status, entry: outcome.entry, error: undefined, expected: undefined };
          }),
        }));
      }
    }
    if (importJob.get().cancel) {
      importJob.set(state => ({
        phase: 'stopped',
        items: state.items.map(item => (item.state === 'pending' ? { ...item, state: 'cancelled' } : item)),
        stop: { reason: 'cancelled', message: '已停止提交后续批次；已提交的批次保存在项目中。' },
      }));
    } else {
      importJob.set({ phase: 'done' });
    }
  } catch (error) {
    if (error instanceof ApiError && error.isNetwork) app.set({ connection: 'offline', connectionError: error.message });
    importJob.set({ phase: 'stopped', stop: { reason: 'failed', message: errorText(error) } });
  } finally {
    importJob.set({ cancel: false });
    await afterImport(touched, updatedDocs);
  }
}

/** 继续处理：重新提交失败或取消的文件。 */
export async function resumeImport() {
  importJob.set(state => ({ items: state.items.map(item => (item.state === 'failed' || item.state === 'cancelled' ? { ...item, state: 'pending', error: undefined } : item)) }));
  await runImport();
}

export function toggleOverwrite(item: ImportItem) {
  const key = itemKey(item);
  importJob.set(state => ({ overwrite: state.overwrite.includes(key) ? state.overwrite.filter(value => value !== key) : [...state.overwrite, key] }));
}

/** 用户确认覆盖：以冲突详情中的当前版本作为 expected_version 重传对应文件。 */
export async function overwriteConflicts() {
  const selected = new Set(importJob.get().overwrite);
  importJob.set(state => ({
    overwrite: [],
    items: state.items.map(item => {
      if (item.state !== 'conflict' || !selected.has(itemKey(item))) return item;
      const current = item.error?.details?.current_version;
      return typeof current === 'number' ? { ...item, state: 'pending', expected: current } : item;
    }),
  }));
  await runImport();
}

export function conflictVersion(item: ImportItem) {
  const value = item.error?.details?.current_version;
  return typeof value === 'number' ? value : null;
}

export function itemProject(item: ImportItem) {
  const job = importJob.get();
  return job.roots.find(root => root.id === item.rootId)?.projectId ?? job.projects[item.rootId] ?? null;
}

async function refreshProjects() {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return;
  try {
    const projects = await api.listProjects(workspaceId);
    if (app.get().workspaceId === workspaceId) app.set({ projects });
  } catch {
    /* 项目列表在下次刷新时更新 */
  }
}

/** 导入后刷新项目列表与已读取的目录；已载入的更新文件按新导入版本显示。 */
async function afterImport(projects: Set<string>, updated: Set<string>) {
  await refreshProjects();
  await Promise.all(Array.from(projects).map(refreshProjectTree));
  const session = getSession();
  await Promise.all(Array.from(updated).filter(id => documentById(id)).map(async id => {
    try {
      const doc = await api.getDocument(id);
      // 有未保存编辑时会话保留本地内容并进入冲突状态，由用户在文稿中选择
      if (session?.isLoaded(id)) await session.adoptImportedDocument(doc);
      upsertDocument(doc);
    } catch (error) {
      toast(`更新后的文件读取失败：${errorText(error)}`, 'error');
    }
  }));
}
