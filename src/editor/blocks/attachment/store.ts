import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { AttachmentBlockSchemaExtension } from '@editor/model';

import { AttachmentBlockAdapterExtensions } from './adapters/extension';

export class AttachmentStoreExtension extends StoreExtensionProvider {
  override name = 'affine-attachment-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(AttachmentBlockSchemaExtension);
    context.register(AttachmentBlockAdapterExtensions);
  }
}
