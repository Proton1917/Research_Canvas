import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@editor/extensions';
import { SlashMenuConfigExtension } from '@editor/widgets/slash-menu';
import { BlockViewExtension, FlavourExtension } from '@editor/runtime';
import { literal } from 'lit/static-html.js';

import { CalloutKeymapExtension } from './callout-keymap';
import { calloutSlashMenuConfig } from './configs/slash-menu';
import { effects } from './effects';

export class CalloutViewExtension extends ViewExtensionProvider {
  override name = 'affine-callout-block';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      FlavourExtension('affine:callout'),
      BlockViewExtension('affine:callout', literal`affine-callout`),
      CalloutKeymapExtension,
      SlashMenuConfigExtension('affine:callout', calloutSlashMenuConfig),
    ]);
  }
}
