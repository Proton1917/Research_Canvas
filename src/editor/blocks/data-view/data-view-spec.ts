import { BlockViewExtension, FlavourExtension } from '@editor/runtime';
import type { ExtensionType } from '@editor/document';
import { literal } from 'lit/static-html.js';

export const DataViewBlockSpec: ExtensionType[] = [
  FlavourExtension('affine:data-view'),
  BlockViewExtension('affine:data-view', literal`affine-data-view`),
];
