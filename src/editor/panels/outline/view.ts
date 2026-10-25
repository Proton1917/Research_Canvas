import { ViewExtensionProvider } from '@editor/extensions';

import { effects } from './effects';

export class OutlineViewExtension extends ViewExtensionProvider {
  override name = 'affine-outline-fragment';

  override effect() {
    super.effect();
    effects();
  }
}
