import { ToolbarModuleExtension } from '@editor/shared/services';
import { BlockFlavourIdentifier } from '@editor/runtime';
import type { ExtensionType } from '@editor/document';

import { builtinLockedToolbarConfig, builtinMiscToolbarConfig } from './misc';

export const EdgelessElementToolbarExtension: ExtensionType[] = [
  ToolbarModuleExtension({
    id: BlockFlavourIdentifier('affine:surface:*'),
    config: builtinMiscToolbarConfig,
  }),

  // Special Scenarios
  // Only display the `unlock` button when the selection includes a locked element.
  ToolbarModuleExtension({
    id: BlockFlavourIdentifier('affine:surface:locked'),
    config: builtinLockedToolbarConfig,
  }),
];
