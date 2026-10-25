import { richTextColumnConfig } from '@editor/blocks/database';
import type { PropertyMetaConfig } from '@editor/data-view';
import { propertyPresets } from '@editor/data-view/property-presets';

export const queryBlockColumns = [
  propertyPresets.datePropertyConfig,
  propertyPresets.numberPropertyConfig,
  propertyPresets.progressPropertyConfig,
  propertyPresets.selectPropertyConfig,
  propertyPresets.multiSelectPropertyConfig,
  propertyPresets.checkboxPropertyConfig,
];
export const queryBlockHiddenColumns: PropertyMetaConfig<
  string,
  any,
  any,
  any
>[] = [richTextColumnConfig];
const queryBlockAllColumns = [...queryBlockColumns, ...queryBlockHiddenColumns];
export const queryBlockAllColumnMap = Object.fromEntries(
  queryBlockAllColumns.map(v => [v.type, v as PropertyMetaConfig])
);
