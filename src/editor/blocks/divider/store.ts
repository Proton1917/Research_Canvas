import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { DividerBlockSchemaExtension } from '@editor/model';

import { DividerBlockAdapterExtensions } from './adapters/extension';

export class DividerStoreExtension extends StoreExtensionProvider {
  override name = 'affine-divider-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(DividerBlockSchemaExtension);
    context.register(DividerBlockAdapterExtensions);
  }
}
