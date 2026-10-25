// 编辑器状态与后端文本块之间的投影。
//
// 后端 `content.blocks` 是选段、检索与 AI 上下文使用的文本；块标识沿用编辑器块标识，
// 编辑期间保持稳定。投影规则可逆：标题、引用、列表、代码和公式块写成 Markdown 前缀，
// 表格写成 GFM 表格，行内公式写成 `$…$`，因此后端按块改写或恢复后可以据文本重建编辑器结构。
import type { AffineTextAttributes } from '@editor/shared/types';
import { generateFractionalIndexingKeyBetween } from '@editor/shared/utils';
import type { BlockModel, DeltaInsert, Store } from '@editor/document';
import { nanoid, Text } from '@editor/document';

import type { TextBlock } from '../api/types';

type Attributes = AffineTextAttributes;
type Delta = DeltaInsert<Attributes>[];

type ParsedBlock =
  | { flavour: 'affine:paragraph'; props: { type: string }; delta: Delta }
  | { flavour: 'affine:list'; props: { type: string; checked?: boolean; order?: number | null }; delta: Delta }
  | { flavour: 'affine:code'; props: { language: string | null }; delta: Delta }
  | { flavour: 'affine:latex'; props: { latex: string }; delta: null }
  | { flavour: 'affine:table'; props: { rows: string[][] }; delta: null };

const TEXT_FLAVOURS = new Set(['affine:paragraph', 'affine:list', 'affine:code']);

type ModelProps = {
  type?: string;
  checked?: boolean;
  order?: number | null;
  language?: string | null;
  latex?: string;
  text?: Text;
  rows?: Record<string, { rowId: string; order: string }>;
  columns?: Record<string, { columnId: string; order: string }>;
  cells?: Record<string, { text: Text }>;
};

function props(model: BlockModel): ModelProps {
  return model.props as unknown as ModelProps;
}

export function isProjectedBlock(model: BlockModel) {
  return TEXT_FLAVOURS.has(model.flavour) || model.flavour === 'affine:latex' || model.flavour === 'affine:table';
}

/** 块在投影文本中的前缀，选段偏移需要加上它的长度。 */
export function blockPrefix(model: BlockModel): string {
  const p = props(model);
  switch (model.flavour) {
    case 'affine:paragraph': {
      const type = p.type ?? 'text';
      if (/^h[1-6]$/.test(type)) return `${'#'.repeat(Number(type[1]))} `;
      if (type === 'quote') return '> ';
      return '';
    }
    case 'affine:list': {
      if (p.type === 'numbered') return `${p.order ?? 1}. `;
      if (p.type === 'todo') return p.checked ? '- [x] ' : '- [ ] ';
      return '- ';
    }
    case 'affine:code':
      return `\`\`\`${p.language ?? ''}\n`;
    case 'affine:latex':
      return '$$';
    default:
      return '';
  }
}

function blockSuffix(model: BlockModel): string {
  if (model.flavour === 'affine:code') return '\n```';
  if (model.flavour === 'affine:latex') return '$$';
  return '';
}

function opText(op: DeltaInsert<Attributes>): string {
  const latex = op.attributes?.latex;
  return typeof latex === 'string' ? `$${latex}$` : op.insert;
}

export function deltaToText(delta: Delta): string {
  return delta.map(opText).join('');
}

/** 将 Y.Text 中的偏移换算为块内投影文本（不含前缀）的 UTF-16 偏移。 */
export function yIndexToTextIndex(delta: Delta, index: number): number {
  let y = 0;
  let projected = 0;
  for (const op of delta) {
    const length = op.insert.length;
    if (y + length >= index) {
      if (typeof op.attributes?.latex === 'string') return projected + (index > y ? opText(op).length : 0);
      return projected + (index - y);
    }
    y += length;
    projected += opText(op).length;
  }
  return projected;
}

/** 投影偏移换算回 Y.Text 偏移；落在行内公式内部时取公式起点或终点。 */
export function textIndexToYIndex(delta: Delta, index: number, roundUp = false): number {
  let y = 0;
  let projected = 0;
  for (const op of delta) {
    const text = opText(op);
    if (projected + text.length >= index) {
      if (typeof op.attributes?.latex === 'string') {
        if (index <= projected) return y;
        if (index >= projected + text.length) return y + op.insert.length;
        return roundUp ? y + op.insert.length : y;
      }
      return y + (index - projected);
    }
    y += op.insert.length;
    projected += text.length;
  }
  return y;
}

export function modelDelta(model: BlockModel): Delta {
  const text = props(model).text;
  return text ? (text.toDelta() as Delta) : [];
}

// ---------------------------------------------------------------------------
// 表格：首行作为表头写成 GFM 表格，单元格内的竖线与换行转义
// ---------------------------------------------------------------------------

const byOrder = (a: { order: string }, b: { order: string }) => (a.order > b.order ? 1 : -1);

function escapeCell(text: string) {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function unescapeCell(text: string) {
  return text.replace(/<br>/g, '\n').replace(/\\\|/g, '|');
}

function tableRows(model: BlockModel): string[][] {
  const p = props(model);
  const rows = Object.values(p.rows ?? {}).sort(byOrder);
  const columns = Object.values(p.columns ?? {}).sort(byOrder);
  return rows.map(row => columns.map(column => {
    const text = p.cells?.[`${row.rowId}:${column.columnId}`]?.text;
    return text ? deltaToText(text.toDelta() as Delta) : '';
  }));
}

function tableText(rows: string[][]): string {
  if (rows.length === 0 || rows[0].length === 0) return '';
  const line = (cells: string[]) => `| ${cells.map(escapeCell).join(' | ')} |`;
  return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n');
}

function splitRow(line: string): string[] | null {
  if (!line.startsWith('| ') || !line.endsWith(' |')) return null;
  const cells: string[] = [];
  let current = '';
  const body = line.slice(2, -2);
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '\\' && i + 1 < body.length) { current += char + body[++i]; continue; }
    if (char === '|' && body[i - 1] === ' ' && body[i + 1] === ' ') { cells.push(current.slice(0, -1)); current = ''; i++; continue; }
    current += char;
  }
  cells.push(current);
  return cells.map(unescapeCell);
}

function parseTable(text: string): string[][] | null {
  const lines = text.split('\n');
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const divider = splitRow(lines[1]);
  if (!header || !divider || divider.length !== header.length || divider.some(cell => cell !== '---')) return null;
  const rows = [header];
  for (const line of lines.slice(2)) {
    const cells = splitRow(line);
    if (!cells || cells.length !== header.length) return null;
    rows.push(cells);
  }
  return rows;
}

function tableProps(rows: string[][]) {
  const orders = (count: number) => {
    const result: string[] = [];
    for (let i = 0; i < count; i++) result.push(generateFractionalIndexingKeyBetween(result[i - 1] ?? null, null));
    return result;
  };
  const rowIds = rows.map(() => nanoid());
  const columnIds = rows[0].map(() => nanoid());
  const rowOrders = orders(rowIds.length);
  const columnOrders = orders(columnIds.length);
  const cells: Record<string, { text: Text }> = {};
  rows.forEach((row, r) => row.forEach((cell, c) => { cells[`${rowIds[r]}:${columnIds[c]}`] = { text: new Text(parseInline(cell)) }; }));
  return {
    rows: Object.fromEntries(rowIds.map((rowId, i) => [rowId, { rowId, order: rowOrders[i] }])),
    columns: Object.fromEntries(columnIds.map((columnId, i) => [columnId, { columnId, order: columnOrders[i] }])),
    cells,
  };
}

export function blockText(model: BlockModel): string {
  if (model.flavour === 'affine:latex') return `$$${props(model).latex ?? ''}$$`;
  if (model.flavour === 'affine:table') return tableText(tableRows(model));
  return blockPrefix(model) + deltaToText(modelDelta(model)) + blockSuffix(model);
}

/** 文稿中按阅读顺序排列的可投影块。 */
export function projectedModels(store: Store): BlockModel[] {
  const result: BlockModel[] = [];
  const visit = (model: BlockModel) => {
    if (model.flavour === 'affine:surface') return;
    if (isProjectedBlock(model)) result.push(model);
    model.children.forEach(visit);
  };
  if (store.root) visit(store.root);
  return result;
}

export function projectStore(store: Store, pages?: Map<string, number>): TextBlock[] {
  return projectedModels(store).map(model => {
    const block: TextBlock = { id: model.id, text: blockText(model) };
    const page = pages?.get(model.id);
    if (page != null) block.page = page;
    return block;
  });
}

export function storeTitle(store: Store): string {
  const root = store.root;
  const title = root ? (root.props as { title?: Text }).title : undefined;
  return title?.toString() ?? '';
}

// ---------------------------------------------------------------------------
// 从文本重建
// ---------------------------------------------------------------------------

function parseInline(text: string): Delta {
  const delta: Delta = [];
  const pattern = /(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) delta.push({ insert: text.slice(last, index) });
    delta.push({ insert: ' ', attributes: { latex: match[1] } });
    last = index + match[0].length;
  }
  if (last < text.length) delta.push({ insert: text.slice(last) });
  return delta;
}

function parseStructured(text: string): ParsedBlock {
  const latex = /^\$\$([\s\S]*)\$\$$/.exec(text);
  if (latex && !latex[1].includes('$$')) return { flavour: 'affine:latex', props: { latex: latex[1] }, delta: null };
  const table = parseTable(text);
  if (table) return { flavour: 'affine:table', props: { rows: table }, delta: null };
  const code = /^```([^\n`]*)\n([\s\S]*)\n```$/.exec(text);
  if (code) return { flavour: 'affine:code', props: { language: code[1] || null }, delta: [{ insert: code[2] }].filter(op => op.insert) };
  const heading = /^(#{1,6}) /.exec(text);
  if (heading) return { flavour: 'affine:paragraph', props: { type: `h${heading[1].length}` }, delta: parseInline(text.slice(heading[0].length)) };
  if (text.startsWith('> ')) return { flavour: 'affine:paragraph', props: { type: 'quote' }, delta: parseInline(text.slice(2)) };
  const todo = /^- \[( |x)\] /.exec(text);
  if (todo) return { flavour: 'affine:list', props: { type: 'todo', checked: todo[1] === 'x' }, delta: parseInline(text.slice(todo[0].length)) };
  if (text.startsWith('- ')) return { flavour: 'affine:list', props: { type: 'bulleted' }, delta: parseInline(text.slice(2)) };
  const numbered = /^(\d{1,6})\. /.exec(text);
  if (numbered) return { flavour: 'affine:list', props: { type: 'numbered', order: Number(numbered[1]) }, delta: parseInline(text.slice(numbered[0].length)) };
  return { flavour: 'affine:paragraph', props: { type: 'text' }, delta: parseInline(text) };
}

function parsedText(parsed: ParsedBlock): string {
  switch (parsed.flavour) {
    case 'affine:latex':
      return `$$${parsed.props.latex}$$`;
    case 'affine:table':
      return tableText(parsed.props.rows);
    case 'affine:code':
      return `\`\`\`${parsed.props.language ?? ''}\n${deltaToText(parsed.delta)}\n\`\`\``;
    case 'affine:list': {
      const { type, checked, order } = parsed.props;
      const prefix = type === 'numbered' ? `${order ?? 1}. ` : type === 'todo' ? (checked ? '- [x] ' : '- [ ] ') : '- ';
      return prefix + deltaToText(parsed.delta);
    }
    case 'affine:paragraph': {
      const type = parsed.props.type;
      const prefix = /^h[1-6]$/.test(type) ? `${'#'.repeat(Number(type[1]))} ` : type === 'quote' ? '> ' : '';
      return prefix + deltaToText(parsed.delta);
    }
  }
}

/**
 * 解析单个文本块。结构化解析的结果必须能投影回原文；
 * 不能逐字还原时按普通段落保存原文，保证块文本与后端一致。
 */
export function parseBlockText(text: string, structured: boolean): ParsedBlock {
  if (structured) {
    const parsed = parseStructured(text);
    if (parsedText(parsed) === text) return parsed;
  }
  return { flavour: 'affine:paragraph', props: { type: 'text' }, delta: text ? [{ insert: text }] : [] };
}

function addParsedBlock(store: Store, parsed: ParsedBlock, id: string, parentId: string, index?: number) {
  if (parsed.flavour === 'affine:latex') {
    return store.addBlock('affine:latex', { id, latex: parsed.props.latex } as never, parentId, index);
  }
  if (parsed.flavour === 'affine:table') {
    return store.addBlock('affine:table', { id, ...tableProps(parsed.props.rows) } as never, parentId, index);
  }
  return store.addBlock(parsed.flavour, { id, ...parsed.props, text: new Text(parsed.delta) } as never, parentId, index);
}

/** 在空文稿中按后端文本块创建页面、画布表面和正文块。 */
export function buildStoreFromBlocks(store: Store, title: string, blocks: TextBlock[], structured: boolean) {
  const rootId = store.addBlock('affine:page', { title: new Text(title) });
  store.addBlock('affine:surface', {}, rootId);
  const noteId = store.addBlock('affine:note', {}, rootId);
  if (blocks.length === 0) {
    store.addBlock('affine:paragraph', {}, noteId);
    return;
  }
  for (const block of blocks) addParsedBlock(store, parseBlockText(block.text, structured), block.id, noteId);
}

/** 创建空白文稿结构，正文含一个空段落。 */
export function buildEmptyStore(store: Store, title: string) {
  buildStoreFromBlocks(store, title, [], true);
}

/** 创建画布文稿：只含页面根块与画布表面。 */
export function buildCanvasStore(store: Store, title: string) {
  const rootId = store.addBlock('affine:page', { title: new Text(title) });
  store.addBlock('affine:surface', {}, rootId);
}

function replaceDelta(text: Text, next: Delta) {
  const oldPlain = text.toString();
  const nextPlain = next.map(op => op.insert).join('');
  const nextLatex = next.some(op => typeof op.attributes?.latex === 'string');
  const oldLatex = (text.toDelta() as Delta).some(op => typeof op.attributes?.latex === 'string');
  if (nextLatex || oldLatex) {
    text.clear();
    text.applyDelta(next);
    return;
  }
  if (oldPlain === nextPlain) return;
  let start = 0;
  while (start < oldPlain.length && start < nextPlain.length && oldPlain[start] === nextPlain[start]) start++;
  let endOld = oldPlain.length;
  let endNew = nextPlain.length;
  while (endOld > start && endNew > start && oldPlain[endOld - 1] === nextPlain[endNew - 1]) { endOld--; endNew--; }
  if (endOld > start) text.delete(start, endOld - start);
  if (endNew > start) text.insert(nextPlain.slice(start, endNew), start);
}

/**
 * 将已加载的编辑器状态更新为后端当前文本块：保留块标识与未改动块的格式，
 * 修改的块按最小区间替换文字，新增块插入到前一个块之后，缺失的块删除。
 */
export function reconcileStore(store: Store, title: string, blocks: TextBlock[], structured = true) {
  const root = store.root;
  if (!root) return;
  const rootTitle = (root.props as { title?: Text }).title;
  if (rootTitle && rootTitle.toString() !== title) replaceDelta(rootTitle, [{ insert: title }]);
  const existing = new Map(projectedModels(store).map(model => [model.id, model]));
  const wanted = new Set(blocks.map(block => block.id));
  store.transact(() => {
    for (const [id, model] of existing) {
      if (!wanted.has(id)) store.deleteBlock(model);
    }
    let previous: BlockModel | null = null;
    for (const block of blocks) {
      const model = existing.get(block.id);
      const parsed = parseBlockText(block.text, structured);
      if (model && blockText(model) === block.text) { previous = model; continue; }
      if (model && model.flavour === parsed.flavour && parsed.flavour !== 'affine:table') {
        if (parsed.flavour === 'affine:latex') {
          store.updateBlock(model, { latex: parsed.props.latex });
        } else {
          store.updateBlock(model, parsed.props as never);
          const text = props(model).text;
          if (text) replaceDelta(text, parsed.delta);
        }
        previous = model;
        continue;
      }
      let parent: BlockModel | null;
      let index: number | undefined;
      if (model) {
        parent = store.getParent(model);
        index = parent ? parent.children.indexOf(model) : undefined;
        store.deleteBlock(model);
      } else if (previous) {
        parent = store.getParent(previous);
        index = parent ? parent.children.indexOf(previous) + 1 : undefined;
      } else {
        parent = store.getModelsByFlavour('affine:note')[0] ?? null;
        index = 0;
      }
      if (!parent) parent = store.getModelsByFlavour('affine:note')[0] ?? null;
      if (!parent) continue;
      addParsedBlock(store, parsed, block.id, parent.id, index);
      previous = store.getBlock(block.id)?.model ?? previous;
    }
  });
}
