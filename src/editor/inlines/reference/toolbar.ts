import { ToolbarModuleExtension } from '@editor/shared/services';
import { BlockFlavourIdentifier } from '@editor/runtime';

import { builtinInlineReferenceToolbarConfig } from './reference-node/configs/toolbar';

export const referenceNodeToolbar = ToolbarModuleExtension({
  id: BlockFlavourIdentifier('affine:reference'),
  config: builtinInlineReferenceToolbarConfig,
});
