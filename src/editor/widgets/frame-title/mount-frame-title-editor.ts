import { DefaultTool } from '@editor/blocks/surface';
import type { FrameBlockModel } from '@editor/model';
import { BlockSuiteError } from '@editor/platform/exceptions';
import type { BlockComponent } from '@editor/runtime';
import { GfxControllerIdentifier } from '@editor/runtime/gfx';

import { EdgelessFrameTitleEditor } from './edgeless-frame-title-editor';

export function mountFrameTitleEditor(
  frame: FrameBlockModel,
  edgeless: BlockComponent
) {
  const mountElm = edgeless.querySelector('.edgeless-mount-point');
  if (!mountElm) {
    throw new BlockSuiteError(
      BlockSuiteError.ErrorCode.ValueNotExists,
      "edgeless block's mount point does not exist"
    );
  }

  const gfx = edgeless.std.get(GfxControllerIdentifier);

  gfx.tool.setTool(DefaultTool);
  gfx.selection.set({
    elements: [frame.id],
    editing: true,
  });

  const frameEditor = new EdgelessFrameTitleEditor();
  frameEditor.frameModel = frame;
  frameEditor.edgeless = edgeless;

  mountElm.append(frameEditor);
}
