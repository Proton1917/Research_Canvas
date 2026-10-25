import { ViewExtensionProvider } from '@editor/extensions';

import { effects } from './effects';

export class AdapterPanelViewExtension extends ViewExtensionProvider {
  override name = 'affine-adapter-panel-fragment';

  override effect() {
    super.effect();
    effects();
  }
}
