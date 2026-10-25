import { AttachmentStoreExtension } from '@editor/blocks/attachment/store';
import { BookmarkStoreExtension } from '@editor/blocks/bookmark/store';
import { CalloutStoreExtension } from '@editor/blocks/callout/store';
import { CodeStoreExtension } from '@editor/blocks/code/store';
import { DataViewStoreExtension } from '@editor/blocks/data-view/store';
import { DatabaseStoreExtension } from '@editor/blocks/database/store';
import { DividerStoreExtension } from '@editor/blocks/divider/store';
import { EdgelessTextStoreExtension } from '@editor/blocks/edgeless-text/store';
import { EmbedStoreExtension } from '@editor/blocks/embed/store';
import { EmbedDocStoreExtension } from '@editor/blocks/embed-doc/store';
import { FrameStoreExtension } from '@editor/blocks/frame/store';
import { ImageStoreExtension } from '@editor/blocks/image/store';
import { LatexStoreExtension } from '@editor/blocks/latex/store';
import { ListStoreExtension } from '@editor/blocks/list/store';
import { NoteStoreExtension } from '@editor/blocks/note/store';
import { ParagraphStoreExtension } from '@editor/blocks/paragraph/store';
import { RootStoreExtension } from '@editor/blocks/root/store';
import { SurfaceStoreExtension } from '@editor/blocks/surface/store';
import { SurfaceRefStoreExtension } from '@editor/blocks/surface-ref/store';
import { TableStoreExtension } from '@editor/blocks/table/store';
import { FoundationStoreExtension } from '@editor/foundation/store';
import { BrushStoreExtension } from '@editor/canvas/brush/store';
import { ConnectorStoreExtension } from '@editor/canvas/connector/store';
import { GroupStoreExtension } from '@editor/canvas/group/store';
import { MindmapStoreExtension } from '@editor/canvas/mindmap/store';
import { ShapeStoreExtension } from '@editor/canvas/shape/store';
import { TextStoreExtension } from '@editor/canvas/text/store';
import { FootnoteStoreExtension } from '@editor/inlines/footnote/store';
import { LatexStoreExtension as InlineLatexStoreExtension } from '@editor/inlines/latex/store';
import { LinkStoreExtension } from '@editor/inlines/link/store';
import { InlinePresetStoreExtension } from '@editor/inlines/preset/store';
import { ReferenceStoreExtension } from '@editor/inlines/reference/store';

export function getInternalStoreExtensions() {
  return [
    FoundationStoreExtension,

    AttachmentStoreExtension,
    BookmarkStoreExtension,
    CalloutStoreExtension,
    CodeStoreExtension,
    DataViewStoreExtension,
    DatabaseStoreExtension,
    DividerStoreExtension,
    EdgelessTextStoreExtension,
    EmbedStoreExtension,
    EmbedDocStoreExtension,
    FrameStoreExtension,
    ImageStoreExtension,
    LatexStoreExtension,
    ListStoreExtension,
    NoteStoreExtension,
    ParagraphStoreExtension,
    SurfaceRefStoreExtension,
    TableStoreExtension,
    SurfaceStoreExtension,
    RootStoreExtension,

    FootnoteStoreExtension,
    LinkStoreExtension,
    ReferenceStoreExtension,
    InlineLatexStoreExtension,
    InlinePresetStoreExtension,

    BrushStoreExtension,
    ShapeStoreExtension,
    MindmapStoreExtension,
    ConnectorStoreExtension,
    GroupStoreExtension,
    TextStoreExtension,
  ];
}
