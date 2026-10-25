import type { ExtensionType } from '@editor/document';

import { CodeBlockHtmlAdapterExtension } from './html.js';
import { CodeBlockMarkdownAdapterExtensions } from './markdown/index.js';
import { CodeBlockNotionHtmlAdapterExtension } from './notion-html.js';
import { CodeBlockPlainTextAdapterExtension } from './plain-text.js';

export const CodeBlockAdapterExtensions: ExtensionType[] = [
  CodeBlockHtmlAdapterExtension,
  CodeBlockMarkdownAdapterExtensions,
  CodeBlockPlainTextAdapterExtension,
  CodeBlockNotionHtmlAdapterExtension,
].flat();
