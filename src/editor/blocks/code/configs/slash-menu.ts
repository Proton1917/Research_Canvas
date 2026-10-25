import { type SlashMenuConfig } from '@editor/widgets/slash-menu';

export const codeSlashMenuConfig: SlashMenuConfig = {
  disableWhen: ({ model }) => {
    return model.flavour === 'affine:code';
  },
  items: [],
};
