import { createIdentifier } from '@editor/platform/di';
import type { EditorHost } from '@editor/runtime';
import type { ViewportRecord } from '@editor/runtime/gfx';
import type { BlockModel } from '@editor/document';
import { Extension } from '@editor/document';

import type { BlockLayout, Rect } from '../types';

export abstract class BlockLayoutHandlerExtension<
  T extends BlockLayout = BlockLayout,
> extends Extension {
  abstract readonly blockType: string;

  abstract queryLayout(
    model: BlockModel,
    host: EditorHost,
    viewportRecord: ViewportRecord
  ): T | null;

  abstract calculateBound(layout: T): {
    rect: Rect;
    subRects: Rect[];
  };
}

export const BlockLayoutHandlersIdentifier =
  createIdentifier<BlockLayoutHandlerExtension>(
    'BlockLayoutHandlersIdentifier'
  );
