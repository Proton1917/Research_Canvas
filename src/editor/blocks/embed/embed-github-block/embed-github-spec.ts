import { EmbedGithubBlockSchema } from '@editor/model';
import { SlashMenuConfigExtension } from '@editor/widgets/slash-menu';
import { BlockViewExtension, FlavourExtension } from '@editor/runtime';
import type { ExtensionType } from '@editor/document';
import { literal } from 'lit/static-html.js';

import { createBuiltinToolbarConfigExtension } from '../configs/toolbar';
import { embedGithubSlashMenuConfig } from './configs/slash-menu';
import { EmbedGithubBlockInteraction } from './embed-edgeless-github-block';
import { EmbedGithubBlockComponent } from './embed-github-block';
import {
  EmbedGithubBlockOptionConfig,
  EmbedGithubBlockService,
} from './embed-github-service';

const flavour = EmbedGithubBlockSchema.model.flavour;

export const EmbedGithubViewExtensions: ExtensionType[] = [
  FlavourExtension(flavour),
  EmbedGithubBlockService,
  BlockViewExtension(flavour, model => {
    return model.parent?.flavour === 'affine:surface'
      ? literal`affine-embed-edgeless-github-block`
      : literal`affine-embed-github-block`;
  }),
  EmbedGithubBlockOptionConfig,
  EmbedGithubBlockInteraction,
  createBuiltinToolbarConfigExtension(flavour, EmbedGithubBlockComponent),
  SlashMenuConfigExtension(flavour, embedGithubSlashMenuConfig),
].flat();
