import { insertEmbedCard } from '@editor/blocks/embed';
import type { EmbedCardStyle, ReferenceParams } from '@editor/model';
import type { Command } from '@editor/runtime';

export type LinkableFlavour =
  | 'affine:bookmark'
  | 'affine:embed-linked-doc'
  | 'affine:embed-synced-doc'
  | 'affine:embed-iframe'
  | 'affine:embed-figma'
  | 'affine:embed-github'
  | 'affine:embed-loom'
  | 'affine:embed-youtube';

export type InsertedLinkType = {
  flavour: LinkableFlavour;
} | null;

export const insertEmbedLinkedDocCommand: Command<
  {
    docId: string;
    params?: ReferenceParams;
  },
  { blockId: string }
> = (ctx, next) => {
  const { docId, params, std } = ctx;
  const flavour = 'affine:embed-linked-doc';
  const targetStyle: EmbedCardStyle = 'vertical';
  const props: Record<string, unknown> = { pageId: docId };
  if (params) props.params = params;
  const blockId = insertEmbedCard(std, { flavour, targetStyle, props });
  if (!blockId) return;
  next({ blockId });
};
