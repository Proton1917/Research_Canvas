import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { FrameBlockSchemaExtension } from '@editor/model';

export class FrameStoreExtension extends StoreExtensionProvider {
  override name = 'affine-frame-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register([FrameBlockSchemaExtension]);
  }
}
