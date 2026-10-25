import { QuickToolExtension } from '@editor/widgets/edgeless-toolbar';
import { html } from 'lit';

export const connectorQuickTool = QuickToolExtension(
  'connector',
  ({ block }) => {
    return {
      type: 'connector',
      content: html`<edgeless-connector-tool-button
        .edgeless=${block}
      ></edgeless-connector-tool-button>`,
      priority: 80,
    };
  }
);
