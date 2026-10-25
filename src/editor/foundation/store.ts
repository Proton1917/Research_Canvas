import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@editor/extensions';
import {
  HtmlAdapterFactoryExtension,
  ImageProxyService,
  MarkdownAdapterFactoryExtension,
  MixTextAdapterFactoryExtension,
  NotionHtmlAdapterFactoryExtension,
  NotionTextAdapterFactoryExtension,
  PlainTextAdapterFactoryExtension,
} from '@editor/shared/adapters';
import { HighlightSelectionExtension } from '@editor/shared/selection';
import {
  BlockMetaService,
  FeatureFlagService,
} from '@editor/shared/services';
import {
  BlockSelectionExtension,
  CursorSelectionExtension,
  SurfaceSelectionExtension,
  TextSelectionExtension,
} from '@editor/runtime';

export class FoundationStoreExtension extends StoreExtensionProvider {
  override name = 'foundation';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register([
      // predefined selections
      BlockSelectionExtension,
      TextSelectionExtension,
      SurfaceSelectionExtension,
      CursorSelectionExtension,
      HighlightSelectionExtension,

      // predefined adapters
      MarkdownAdapterFactoryExtension,
      PlainTextAdapterFactoryExtension,
      HtmlAdapterFactoryExtension,
      NotionTextAdapterFactoryExtension,
      NotionHtmlAdapterFactoryExtension,
      MixTextAdapterFactoryExtension,

      // shared services
      FeatureFlagService,
      BlockMetaService,
      // TODO(@mirone): maybe merge these services into a file setting service
      ImageProxyService,
    ]);
  }
}
