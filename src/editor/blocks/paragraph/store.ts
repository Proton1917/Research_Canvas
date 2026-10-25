import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { ParagraphBlockSchemaExtension } from '@editor/model';

import { ParagraphBlockAdapterExtensions } from './adapters/extension';

export class ParagraphStoreExtension extends StoreExtensionProvider {
  override name = 'affine-paragraph-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(ParagraphBlockSchemaExtension);
    context.register(ParagraphBlockAdapterExtensions);
  }
}
