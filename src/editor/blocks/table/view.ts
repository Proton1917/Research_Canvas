import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@editor/extensions';
import { TableModelFlavour } from '@editor/model';
import { SlashMenuConfigExtension } from '@editor/widgets/slash-menu';
import { BlockViewExtension, FlavourExtension } from '@editor/runtime';
import { literal } from 'lit/static-html.js';

import { tableSlashMenuConfig } from './configs/slash-menu';
import { effects } from './effects';

export class TableViewExtension extends ViewExtensionProvider {
  override name = 'affine-table-block';

  override effect(): void {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      FlavourExtension(TableModelFlavour),
      BlockViewExtension(TableModelFlavour, literal`affine-table`),
      SlashMenuConfigExtension(TableModelFlavour, tableSlashMenuConfig),
    ]);
  }
}
