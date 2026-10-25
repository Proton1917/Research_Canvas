import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@editor/extensions';
import { BlockViewExtension } from '@editor/runtime';
import { literal } from 'lit/static-html.js';

import { effects } from './effects';
import { DividerMarkdownExtension } from './markdown';

export class DividerViewExtension extends ViewExtensionProvider {
  override name = 'affine-divider-block';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      BlockViewExtension('affine:divider', literal`affine-divider`),
      DividerMarkdownExtension,
    ]);
  }
}
