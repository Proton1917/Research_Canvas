import type { PropertyMetaConfig } from '@editor/data-view';
import { createIdentifier } from '@editor/platform/di';

export interface DatabaseBlockConfigService {
  propertiesPresets: PropertyMetaConfig[];
}

export const DatabaseBlockConfigService =
  createIdentifier<DatabaseBlockConfigService>(
    'AffineDatabaseBlockConfigService'
  );
