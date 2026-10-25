import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { RootBlockSchemaExtension } from '@editor/model';

import { RootBlockAdapterExtensions } from './adapters/extension';

export class RootStoreExtension extends StoreExtensionProvider {
  override name = 'affine-root-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(RootBlockSchemaExtension);
    context.register(RootBlockAdapterExtensions);
  }
}
