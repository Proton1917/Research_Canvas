import type { ParagraphBlockModel } from '@editor/model';
import { ConfigExtensionFactory } from '@editor/runtime';

export interface ParagraphBlockConfig {
  getPlaceholder: (model: ParagraphBlockModel) => string;
}

export const ParagraphBlockConfigExtension =
  ConfigExtensionFactory<ParagraphBlockConfig>('affine:paragraph');
