// 读取用户选择的文件夹：目录选择器、带 webkitdirectory 的文件输入和拖放目录。
// 顶层文件夹名作为项目名，其下路径以 `/` 分隔作为项目内相对路径；空目录单独列出。

export type FolderFile = { file: File; path: string };
export type Folder = { name: string; files: FolderFile[]; directories: string[] };

function parentDirectories(path: string, into: Set<string>) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) into.add(parts.slice(0, i).join('/'));
}

/** `<input webkitdirectory>` 的结果：按 webkitRelativePath 的首段分组，浏览器不报告空目录。 */
export function foldersFromInput(files: File[]): Folder[] {
  const groups = new Map<string, { files: FolderFile[]; directories: Set<string> }>();
  for (const file of files) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const [root, ...rest] = relative.split('/');
    if (rest.length === 0) continue;
    const group = groups.get(root) ?? { files: [], directories: new Set<string>() };
    const path = rest.join('/');
    group.files.push({ file, path });
    parentDirectories(path, group.directories);
    groups.set(root, group);
  }
  return Array.from(groups, ([name, group]) => ({ name, files: group.files, directories: Array.from(group.directories).sort() }));
}

type DirectoryHandle = {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
};
type FileHandle = { kind: 'file'; name: string; getFile(): Promise<File> };

export function supportsDirectoryPicker() {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** 浏览器目录选择器（Chromium）：逐级读取，包含空目录。用户取消时返回 null。 */
export async function pickFolder(): Promise<Folder | null> {
  let handle: DirectoryHandle;
  try {
    handle = await (window as unknown as { showDirectoryPicker(options?: { mode?: 'read' }): Promise<DirectoryHandle> }).showDirectoryPicker({ mode: 'read' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
  return folderFromHandle(handle);
}

export async function folderFromHandle(handle: DirectoryHandle): Promise<Folder> {
  const files: FolderFile[] = [];
  const directories: string[] = [];
  const walk = async (directory: DirectoryHandle, prefix: string) => {
    for await (const child of directory.values()) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.kind === 'directory') {
        directories.push(path);
        await walk(child, path);
      } else {
        files.push({ file: await child.getFile(), path });
      }
    }
  };
  await walk(handle, '');
  return { name: handle.name, files, directories: directories.sort() };
}

type Entry = { isFile: boolean; isDirectory: boolean; name: string };
type FileEntry = Entry & { file(success: (file: File) => void, failure: (error: unknown) => void): void };
type DirectoryEntry = Entry & { createReader(): { readEntries(success: (entries: Entry[]) => void, failure: (error: unknown) => void): void } };

async function readAll(directory: DirectoryEntry): Promise<Entry[]> {
  const reader = directory.createReader();
  const all: Entry[] = [];
  // readEntries 每次返回一部分条目，直到返回空数组
  for (;;) {
    const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/**
 * 拖放：每个顶层目录形成一个文件夹（含空目录），顶层的单个文件另行返回。
 * DataTransfer 只在 drop 事件同步阶段可读，需在事件处理中先取出条目。
 */
export function entriesFromDrop(dataTransfer: DataTransfer): { entries: Entry[]; files: File[] } {
  const entries: Entry[] = [];
  const files: File[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null;
    if (entry?.isDirectory) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return { entries, files };
}

export async function foldersFromEntries(entries: Entry[]): Promise<Folder[]> {
  return Promise.all(entries.map(async root => {
    const files: FolderFile[] = [];
    const directories: string[] = [];
    const walk = async (directory: DirectoryEntry, prefix: string) => {
      for (const child of await readAll(directory)) {
        const path = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.isDirectory) {
          directories.push(path);
          await walk(child as DirectoryEntry, path);
        } else {
          const file = await new Promise<File>((resolve, reject) => (child as FileEntry).file(resolve, reject));
          files.push({ file, path });
        }
      }
    };
    await walk(root as DirectoryEntry, '');
    return { name: root.name, files, directories: directories.sort() };
  }));
}

/** 拖放中是否含有文件（目录拖放同样以 Files 类型出现）。 */
export function hasDroppedFiles(dataTransfer: DataTransfer | null) {
  return !!dataTransfer && Array.from(dataTransfer.types).includes('Files');
}
