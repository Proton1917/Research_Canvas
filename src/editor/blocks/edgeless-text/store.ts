import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { EdgelessTextBlockSchemaExtension } from '@editor/model';

export class EdgelessTextStoreExtension extends StoreExtensionProvider {
  override name = 'affine-edgeless-text-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(EdgelessTextBlockSchemaExtension);
  }
}
