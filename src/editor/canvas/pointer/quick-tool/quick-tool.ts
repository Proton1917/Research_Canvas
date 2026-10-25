import { QuickToolExtension } from '@editor/widgets/edgeless-toolbar';
import { html } from 'lit';

export const defaultQuickTool = QuickToolExtension('default', ({ block }) => {
  return {
    priority: 100,
    type: 'default',
    content: html`<edgeless-default-tool-button
      .edgeless=${block}
    ></edgeless-default-tool-button>`,
  };
});
