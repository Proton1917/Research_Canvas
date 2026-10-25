import { createTextActions } from '@editor/canvas/text';
import { EdgelessTextBlockModel } from '@editor/model';
import {
  type ToolbarModuleConfig,
  ToolbarModuleExtension,
} from '@editor/shared/services';
import { BlockFlavourIdentifier } from '@editor/runtime';

export const edgelessTextToolbarConfig = {
  // No need to adjust element bounds, which updates itself using ResizeObserver
  actions: createTextActions(EdgelessTextBlockModel, 'edgeless-text'),

  when: ctx => ctx.getSurfaceModelsByType(EdgelessTextBlockModel).length > 0,
} as const satisfies ToolbarModuleConfig;

export const edgelessTextToolbarExtension = ToolbarModuleExtension({
  id: BlockFlavourIdentifier('affine:surface:edgeless-text'),
  config: edgelessTextToolbarConfig,
});
