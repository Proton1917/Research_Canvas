import { SignalWatcher, WithDisposable } from '@editor/platform/lit';
import { ShadowlessElement } from '@editor/runtime';
import { property } from 'lit/decorators.js';

import type { Menu } from './menu.js';

export abstract class MenuItem extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  @property({ attribute: false })
  accessor menu!: Menu;
}
