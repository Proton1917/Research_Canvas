import { FrameBlockSchema } from '@editor/model';
import { BlockViewExtension } from '@editor/runtime';
import type { ExtensionType } from '@editor/document';
import { literal } from 'lit/static-html.js';

import { FrameBlockInteraction } from './frame-block';
import { EdgelessFrameManager, FrameOverlay } from './frame-manager';

const flavour = FrameBlockSchema.model.flavour;

export const FrameBlockSpec: ExtensionType[] = [
  BlockViewExtension(flavour, literal`affine-frame`),
  FrameOverlay,
  EdgelessFrameManager,
  FrameBlockInteraction,
];
