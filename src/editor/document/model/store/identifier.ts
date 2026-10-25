import { createIdentifier } from '@editor/platform/di';

import type { Store } from './store';

export const StoreIdentifier = createIdentifier<Store>('Store');
