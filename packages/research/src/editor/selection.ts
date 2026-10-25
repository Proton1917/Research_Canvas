// 编辑器选区与锚点之间的换算：选区 → 块内投影偏移；锚点定位 → DOM Range（用于高亮与滚动）。
import { BlockSelection, type BlockStdScope, TextSelection } from '@blocksuite/affine/std';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import type { BlockModel, DeltaInsert, Store } from '@blocksuite/affine/store';

import { blockPrefix, blockText, isProjectedBlock, modelDelta, textIndexToYIndex, yIndexToTextIndex } from './projection';

export type SelectionTarget = {
  blockId: string;
  quote: string;
  start: number;
  end: number;
  flavour: string;
};

export type SelectionRead = { target: SelectionTarget } | { error: string } | null;

type Delta = DeltaInsert<AffineTextAttributes>[];

function wholeBlock(model: BlockModel): SelectionTarget {
  const text = blockText(model);
  const prefix = model.flavour === 'affine:latex' ? 0 : blockPrefix(model).length;
  const suffix = model.flavour === 'affine:code' ? 4 : 0;
  const start = prefix;
  const end = model.flavour === 'affine:latex' ? text.length : text.length - suffix;
  return { blockId: model.id, quote: text.slice(start, end), start, end, flavour: model.flavour };
}

/** 读取当前选区。文本选区须位于单个文本块内；整块选择用于公式块或整段。 */
export function readSelection(std: BlockStdScope, store: Store): SelectionRead {
  const text = std.selection.find(TextSelection);
  if (text) {
    if (text.to && text.to.blockId !== text.from.blockId) return { error: '选段需位于同一个文本块内' };
    if (text.from.length === 0) return null;
    const model = store.getModelById(text.from.blockId);
    if (!model || !isProjectedBlock(model)) return null;
    const delta = modelDelta(model) as Delta;
    const prefix = blockPrefix(model).length;
    const start = prefix + yIndexToTextIndex(delta, text.from.index);
    const end = prefix + yIndexToTextIndex(delta, text.from.index + text.from.length);
    const quote = blockText(model).slice(start, end);
    if (!quote.trim()) return null;
    return { target: { blockId: model.id, quote, start, end, flavour: model.flavour } };
  }
  const blocks = std.selection.filter(BlockSelection);
  if (blocks.length === 1) {
    const model = store.getModelById(blocks[0].blockId);
    if (!model || !isProjectedBlock(model)) return null;
    const target = wholeBlock(model);
    return target.quote.trim() ? { target } : null;
  }
  if (blocks.length > 1) return { error: '一次选择一个段落或公式块' };
  return null;
}

/** 将块内投影偏移区间转换为页面中的 DOM Range。 */
export function rangeForProjection(std: BlockStdScope, store: Store, blockId: string, start: number, end: number): Range | null {
  const model = store.getModelById(blockId);
  if (!model) return null;
  const component = std.view.getBlock(blockId);
  if (!component) return null;
  if (model.flavour === 'affine:latex') {
    const range = document.createRange();
    range.selectNodeContents(component);
    return range;
  }
  const prefix = blockPrefix(model).length;
  const delta = modelDelta(model) as Delta;
  const from = textIndexToYIndex(delta, Math.max(0, start - prefix));
  const to = textIndexToYIndex(delta, Math.max(0, end - prefix), true);
  const richText = component.querySelector('rich-text') as (HTMLElement & { inlineEditor?: { toDomRange(range: { index: number; length: number }): Range | null } }) | null;
  const editor = richText?.inlineEditor;
  if (!editor) return null;
  try {
    return editor.toDomRange({ index: from, length: Math.max(0, to - from) });
  } catch {
    return null;
  }
}

export function scrollBlockIntoView(std: BlockStdScope, blockId: string) {
  const component = std.view.getBlock(blockId);
  component?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return !!component;
}

/** 选中块内的投影区间，用于从批注跳回原文。 */
export function selectProjection(std: BlockStdScope, store: Store, blockId: string, start: number, end: number) {
  const model = store.getModelById(blockId);
  if (!model) return;
  if (model.flavour === 'affine:latex') {
    std.selection.setGroup('note', [std.selection.create(BlockSelection, { blockId })]);
    return;
  }
  const prefix = blockPrefix(model).length;
  const delta = modelDelta(model) as Delta;
  const from = textIndexToYIndex(delta, Math.max(0, start - prefix));
  const to = textIndexToYIndex(delta, Math.max(0, end - prefix), true);
  std.selection.setGroup('note', [std.selection.create(TextSelection, { from: { blockId, index: from, length: Math.max(0, to - from) }, to: null })]);
}
