import type { Connectable, NoteBlockModel } from '@editor/model';
import type { GfxModel } from '@editor/runtime/gfx';
import type { BlockModel } from '@editor/document';

export function isConnectable(
  element: GfxModel | null
): element is Connectable {
  return !!element && element.connectable;
}

export function isNoteBlock(
  element: BlockModel | GfxModel | null
): element is NoteBlockModel {
  return !!element && 'flavour' in element && element.flavour === 'affine:note';
}
