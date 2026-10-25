import { DefaultTool } from '@editor/blocks/surface';
import { toggleEmbedCardCreateModal } from '@editor/components/embed-card-modal';
import { BookmarkBlockSchema } from '@editor/model';
import {
  type SlashMenuConfig,
  SlashMenuConfigIdentifier,
} from '@editor/widgets/slash-menu';
import { LinkIcon } from '@blocksuite/icons/lit';
import { GfxControllerIdentifier } from '@editor/runtime/gfx';
import type { ExtensionType } from '@editor/document';

import { LinkTooltip } from './tooltips';

const bookmarkSlashMenuConfig: SlashMenuConfig = {
  items: [
    {
      name: 'Link',
      description: 'Add a bookmark for reference.',
      icon: LinkIcon(),
      tooltip: {
        figure: LinkTooltip,
        caption: 'Link',
      },
      group: '4_Content & Media@2',
      when: ({ model }) =>
        model.store.schema.flavourSchemaMap.has('affine:bookmark'),
      action: ({ std, model }) => {
        const { host } = std;
        const parentModel = host.store.getParent(model);
        if (!parentModel) {
          return;
        }
        const index = parentModel.children.indexOf(model) + 1;
        toggleEmbedCardCreateModal(
          host,
          'Links',
          'The added link will be displayed as a card view.',
          { mode: 'page', parentModel, index },
          ({ mode }) => {
            if (mode === 'edgeless') {
              const gfx = std.get(GfxControllerIdentifier);
              gfx.tool.setTool(DefaultTool);
            }
          }
        )
          .then(() => {
            if (model.text?.length === 0) {
              model.store.deleteBlock(model);
            }
          })
          .catch(console.error);
      },
    },
  ],
};

export const BookmarkSlashMenuConfigIdentifier = SlashMenuConfigIdentifier(
  BookmarkBlockSchema.model.flavour
);

export const BookmarkSlashMenuConfigExtension: ExtensionType = {
  setup: di => {
    di.addImpl(BookmarkSlashMenuConfigIdentifier, bookmarkSlashMenuConfig);
  },
};
