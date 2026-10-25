import { createIdentifier } from '@editor/platform/di';
import type { ExtensionType } from '@editor/document';

import type { AffineUserInfo } from './types';

export interface WriterInfoService {
  getWriterInfo(): AffineUserInfo | null;
}

export const WriterInfoProvider = createIdentifier<WriterInfoService>(
  'affine-writer-info-service'
);

export function WriterInfoServiceExtension(
  service: WriterInfoService
): ExtensionType {
  return {
    setup(di) {
      di.addImpl(WriterInfoProvider, () => service);
    },
  };
}
