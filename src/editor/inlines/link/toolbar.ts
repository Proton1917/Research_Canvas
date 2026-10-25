import { ToolbarModuleExtension } from '@editor/shared/services';
import { BlockFlavourIdentifier } from '@editor/runtime';

import { builtinInlineLinkToolbarConfig } from './link-node/configs/toolbar.js';

export const linkToolbar = ToolbarModuleExtension({
  id: BlockFlavourIdentifier('affine:link'),
  config: builtinInlineLinkToolbarConfig,
});
