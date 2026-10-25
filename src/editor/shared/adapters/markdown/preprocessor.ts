import {
  createIdentifier,
  type ServiceIdentifier,
  type ServiceProvider,
} from '@editor/platform/di';
import type { ExtensionType } from '@editor/document';

import {
  type AdapterPreprocessor,
  PreprocessorManager,
} from '../types/preprocessor';
import type { Markdown } from './type';

export type MarkdownAdapterPreprocessor = AdapterPreprocessor<Markdown>;

const MarkdownPreprocessorIdentifier =
  createIdentifier<MarkdownAdapterPreprocessor>('MarkdownPreprocessor');

export const MarkdownPreprocessorExtension = (
  preprocessor: MarkdownAdapterPreprocessor
): ExtensionType & {
  identifier: ServiceIdentifier<MarkdownAdapterPreprocessor>;
} => {
  const identifier = MarkdownPreprocessorIdentifier(preprocessor.name);
  return {
    setup: di => {
      di.addImpl(identifier, () => preprocessor);
    },
    identifier,
  };
};

export class MarkdownPreprocessorManager extends PreprocessorManager<
  Markdown,
  MarkdownAdapterPreprocessor
> {
  constructor(provider: ServiceProvider) {
    super(provider, MarkdownPreprocessorIdentifier);
  }
}
