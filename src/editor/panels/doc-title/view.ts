import { ViewExtensionProvider } from '@editor/extensions';

import { effects } from './effects';

export class DocTitleViewExtension extends ViewExtensionProvider {
  override name = 'affine-doc-title-fragment';

  override effect() {
    super.effect();
    effects();
  }
}
