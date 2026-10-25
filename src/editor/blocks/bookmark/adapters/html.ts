import { createEmbedBlockHtmlAdapterMatcher } from '@editor/blocks/embed';
import { BookmarkBlockSchema } from '@editor/model';
import { BlockHtmlAdapterExtension } from '@editor/shared/adapters';

export const bookmarkBlockHtmlAdapterMatcher =
  createEmbedBlockHtmlAdapterMatcher(BookmarkBlockSchema.model.flavour);

export const BookmarkBlockHtmlAdapterExtension = BlockHtmlAdapterExtension(
  bookmarkBlockHtmlAdapterMatcher
);
