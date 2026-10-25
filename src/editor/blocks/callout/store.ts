import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import { CalloutBlockSchemaExtension } from '@editor/model';

import { CalloutBlockMarkdownAdapterExtension } from './adapters/markdown';

export class CalloutStoreExtension extends StoreExtensionProvider {
  override name = 'affine-callout-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(CalloutBlockSchemaExtension);
    context.register(CalloutBlockMarkdownAdapterExtension);
  }
}
