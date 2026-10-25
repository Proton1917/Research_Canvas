import type { TextBuffer } from '@editor/shared/adapters';
import {
  createIdentifier,
  type ServiceIdentifier,
} from '@editor/platform/di';
import type { ExtensionType } from '@editor/document';

import type { ElementModelMatcher } from '../../type.js';

export type ElementToPlainTextAdapterMatcher = ElementModelMatcher<TextBuffer>;

export const ElementToPlainTextAdapterMatcherIdentifier =
  createIdentifier<ElementToPlainTextAdapterMatcher>(
    'elementToPlainTextAdapterMatcher'
  );

export function ElementToPlainTextAdapterExtension(
  matcher: ElementToPlainTextAdapterMatcher
): ExtensionType & {
  identifier: ServiceIdentifier<ElementToPlainTextAdapterMatcher>;
} {
  const identifier = ElementToPlainTextAdapterMatcherIdentifier(matcher.name);
  return {
    setup: di => {
      di.addImpl(identifier, () => matcher);
    },
    identifier,
  };
}
