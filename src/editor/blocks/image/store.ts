import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { ImageBlockSchemaExtension } from '@editor/model';
import { ImageSelectionExtension } from '@editor/shared/selection';

import { ImageBlockAdapterExtensions } from './adapters/extension';

export class ImageStoreExtension extends StoreExtensionProvider {
  override name = 'affine-image-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register([ImageBlockSchemaExtension, ImageSelectionExtension]);
    context.register(ImageBlockAdapterExtensions);
  }
}
