import type { BlockFlavourIdentifier } from '@editor/runtime';

import type { ToolbarModuleConfig } from './config';

export type ToolbarModule = {
  readonly id: ReturnType<typeof BlockFlavourIdentifier>;

  readonly config: ToolbarModuleConfig;
};
