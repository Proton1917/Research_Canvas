import { TextSelection } from '@editor/runtime';

import type { GetSelectionCommand } from './types';

export const getTextSelectionCommand: GetSelectionCommand = (ctx, next) => {
  const currentTextSelection = ctx.std.selection.find(TextSelection);
  if (!currentTextSelection) return;

  next({ currentTextSelection });
};
