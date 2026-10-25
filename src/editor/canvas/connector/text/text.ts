import {
  DefaultTool,
  EdgelessCRUDIdentifier,
} from '@editor/blocks/surface';
import type { ConnectorElementModel } from '@editor/model';
import { BlockSuiteError, ErrorCode } from '@editor/platform/exceptions';
import type { IVec } from '@editor/platform/gfx';
import { Bound } from '@editor/platform/gfx';
import type { BlockComponent } from '@editor/runtime';
import { GfxControllerIdentifier } from '@editor/runtime/gfx';
import * as Y from 'yjs';

import { EdgelessConnectorLabelEditor } from './edgeless-connector-label-editor';

export function mountConnectorLabelEditor(
  connector: ConnectorElementModel,
  edgeless: BlockComponent,
  point?: IVec
) {
  const mountElm = edgeless.querySelector('.edgeless-mount-point');
  if (!mountElm) {
    throw new BlockSuiteError(
      ErrorCode.ValueNotExists,
      "edgeless block's mount point does not exist"
    );
  }

  const gfx = edgeless.std.get(GfxControllerIdentifier);

  gfx.tool.setTool(DefaultTool);
  gfx.selection.set({
    elements: [connector.id],
    editing: true,
  });

  if (!connector.text) {
    const text = new Y.Text();
    const labelOffset = connector.labelOffset;
    let labelXYWH = connector.labelXYWH ?? [0, 0, 16, 16];

    if (point) {
      const center = connector.getNearestPoint(point);
      const distance = connector.getOffsetDistanceByPoint(center as IVec);
      const bounds = Bound.fromXYWH(labelXYWH);
      bounds.center = center;
      labelOffset.distance = distance;
      labelXYWH = bounds.toXYWH();
    }

    edgeless.std.get(EdgelessCRUDIdentifier).updateElement(connector.id, {
      text,
      labelXYWH,
      labelOffset: { ...labelOffset },
    });
  }

  const editor = new EdgelessConnectorLabelEditor();
  editor.connector = connector;

  mountElm.append(editor);
  editor.updateComplete
    .then(() => {
      editor.inlineEditor?.focusEnd();
    })
    .catch(console.error);
}
