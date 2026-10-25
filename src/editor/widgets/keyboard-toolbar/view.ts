import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@editor/extensions';
import { IS_MOBILE } from '@editor/platform/env';

import { effects } from './effects';
import { keyboardToolbarWidget } from './widget';

export class KeyboardToolbarViewExtension extends ViewExtensionProvider {
  override name = 'affine-keyboard-toolbar-widget';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    if (
      context.scope === 'mobile-page' ||
      // Legacy mobile page
      (context.scope === 'page' && IS_MOBILE)
    ) {
      context.register(keyboardToolbarWidget);
    }
  }
}
