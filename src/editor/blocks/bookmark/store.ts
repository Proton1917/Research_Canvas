import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { BookmarkBlockSchemaExtension } from '@editor/model';

import { BookmarkBlockAdapterExtensions } from './adapters/extension';

export class BookmarkStoreExtension extends StoreExtensionProvider {
  override name = 'affine-bookmark-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(BookmarkBlockSchemaExtension);
    context.register(BookmarkBlockAdapterExtensions);
  }
}
