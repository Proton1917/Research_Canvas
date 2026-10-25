import { DefaultTool } from '@editor/blocks/surface';
import type { GroupElementModel } from '@editor/model';
import { BlockSuiteError, ErrorCode } from '@editor/platform/exceptions';
import type { BlockComponent } from '@editor/runtime';
import { GfxControllerIdentifier } from '@editor/runtime/gfx';

import { EdgelessGroupTitleEditor } from './edgeless-group-title-editor';

export function mountGroupTitleEditor(
  group: GroupElementModel,
  edgeless: BlockComponent
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
    elements: [group.id],
    editing: true,
  });

  const groupEditor = new EdgelessGroupTitleEditor();
  groupEditor.group = group;

  mountElm.append(groupEditor);
}
