import type { CodeBlockModel } from '@editor/model';
import { createIdentifier } from '@editor/platform/di';
import type { ExtensionType } from '@editor/document';
import type { HTMLTemplateResult } from 'lit';

export type CodeBlockPreviewRenderer = (
  model: CodeBlockModel
) => HTMLTemplateResult | null;

export type CodeBlockPreviewContext = {
  renderer: CodeBlockPreviewRenderer;
  lang: string;
};

export const CodeBlockPreviewIdentifier =
  createIdentifier<CodeBlockPreviewContext>('CodeBlockPreview');

export function CodeBlockPreviewExtension(
  lang: string,
  renderer: CodeBlockPreviewRenderer
): ExtensionType {
  return {
    setup: di => {
      di.addImpl(CodeBlockPreviewIdentifier(lang), { renderer, lang });
    },
  };
}
