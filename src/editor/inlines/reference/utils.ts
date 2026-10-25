import { REFERENCE_NODE } from '@editor/shared/consts';
import type { AffineInlineEditor } from '@editor/shared/types';

export function insertLinkedNode({
  inlineEditor,
  docId,
}: {
  inlineEditor: AffineInlineEditor;
  docId: string;
}) {
  if (!inlineEditor) return;
  const inlineRange = inlineEditor.getInlineRange();
  if (!inlineRange) return;
  inlineEditor.insertText(inlineRange, REFERENCE_NODE, {
    reference: { type: 'LinkedPage', pageId: docId },
  });
  inlineEditor.setInlineRange({
    index: inlineRange.index + 1,
    length: 0,
  });
}
