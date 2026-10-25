import { createIdentifier } from '@editor/platform/di';
import type { ExtensionType } from '@editor/document';

export interface SidebarService {
  open: (tabId?: string) => void;
  close: () => void;
  getTabIds: () => string[];
}

export const SidebarExtensionIdentifier = createIdentifier<SidebarService>(
  'AffineSidebarExtension'
);

export const SidebarExtension = (service: SidebarService): ExtensionType => ({
  setup: di => {
    di.addImpl(SidebarExtensionIdentifier, () => service);
  },
});
