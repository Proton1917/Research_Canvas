import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { SurfaceRefBlockSchemaExtension } from '@editor/model';

export class SurfaceRefStoreExtension extends StoreExtensionProvider {
  override name = 'affine-surface-ref-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(SurfaceRefBlockSchemaExtension);
  }
}
