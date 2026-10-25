import { createEmbedBlockPlainTextAdapterMatcher } from '@editor/blocks/embed';
import { BookmarkBlockSchema } from '@editor/model';
import { BlockPlainTextAdapterExtension } from '@editor/shared/adapters';

export const bookmarkBlockPlainTextAdapterMatcher =
  createEmbedBlockPlainTextAdapterMatcher(BookmarkBlockSchema.model.flavour);

export const BookmarkBlockPlainTextAdapterExtension =
  BlockPlainTextAdapterExtension(bookmarkBlockPlainTextAdapterMatcher);
