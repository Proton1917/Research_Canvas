import {
  EmbedFigmaBlockSchema,
  EmbedFigmaStyles,
} from '@editor/model';
import { EmbedOptionConfig } from '@editor/shared/services';

import { figmaUrlRegex } from './embed-figma-model.js';

export const EmbedFigmaBlockOptionConfig = EmbedOptionConfig({
  flavour: EmbedFigmaBlockSchema.model.flavour,
  urlRegex: figmaUrlRegex,
  styles: EmbedFigmaStyles,
  viewType: 'embed',
});
