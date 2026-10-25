import { ViewExtensionProvider } from '@editor/extensions';

import { effects } from './effects';

export class FramePanelViewExtension extends ViewExtensionProvider {
  override name = 'affine-frame-panel-fragment';

  override effect() {
    super.effect();
    effects();
  }
}
