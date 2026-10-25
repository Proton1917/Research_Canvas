import { AttachmentViewExtension } from '@editor/blocks/attachment/view';
import { BookmarkViewExtension } from '@editor/blocks/bookmark/view';
import { CalloutViewExtension } from '@editor/blocks/callout/view';
import { CodeBlockViewExtension } from '@editor/blocks/code/view';
import { DataViewViewExtension } from '@editor/blocks/data-view/view';
import { DatabaseViewExtension } from '@editor/blocks/database/view';
import { DividerViewExtension } from '@editor/blocks/divider/view';
import { EdgelessTextViewExtension } from '@editor/blocks/edgeless-text/view';
import { EmbedViewExtension } from '@editor/blocks/embed/view';
import { EmbedDocViewExtension } from '@editor/blocks/embed-doc/view';
import { FrameViewExtension } from '@editor/blocks/frame/view';
import { ImageViewExtension } from '@editor/blocks/image/view';
import { LatexViewExtension } from '@editor/blocks/latex/view';
import { ListViewExtension } from '@editor/blocks/list/view';
import { NoteViewExtension } from '@editor/blocks/note/view';
import { ParagraphViewExtension } from '@editor/blocks/paragraph/view';
import { RootViewExtension } from '@editor/blocks/root/view';
import { SurfaceViewExtension } from '@editor/blocks/surface/view';
import { SurfaceRefViewExtension } from '@editor/blocks/surface-ref/view';
import { TableViewExtension } from '@editor/blocks/table/view';
import { FoundationViewExtension } from '@editor/foundation/view';
import { AdapterPanelViewExtension } from '@editor/panels/adapter-panel/view';
import { DocTitleViewExtension } from '@editor/panels/doc-title/view';
import { FramePanelViewExtension } from '@editor/panels/frame-panel/view';
import { OutlineViewExtension } from '@editor/panels/outline/view';
import { BrushViewExtension } from '@editor/canvas/brush/view';
import { ConnectorViewExtension } from '@editor/canvas/connector/view';
import { GroupViewExtension } from '@editor/canvas/group/view';
import { LinkViewExtension as GfxLinkViewExtension } from '@editor/canvas/link/view';
import { MindmapViewExtension } from '@editor/canvas/mindmap/view';
import { NoteViewExtension as GfxNoteViewExtension } from '@editor/canvas/note/view';
import { PointerViewExtension } from '@editor/canvas/pointer/view';
import { ShapeViewExtension } from '@editor/canvas/shape/view';
import { TemplateViewExtension } from '@editor/canvas/template/view';
import { TextViewExtension } from '@editor/canvas/text/view';
import { InlineCommentViewExtension } from '@editor/inlines/comment/view';
import { FootnoteViewExtension } from '@editor/inlines/footnote/view';
import { LatexViewExtension as InlineLatexViewExtension } from '@editor/inlines/latex/view';
import { LinkViewExtension } from '@editor/inlines/link/view';
import { MentionViewExtension } from '@editor/inlines/mention/view';
import { InlinePresetViewExtension } from '@editor/inlines/preset/view';
import { ReferenceViewExtension } from '@editor/inlines/reference/view';
import { DragHandleViewExtension } from '@editor/widgets/drag-handle/view';
import { EdgelessAutoConnectViewExtension } from '@editor/widgets/edgeless-auto-connect/view';
import { EdgelessDraggingAreaViewExtension } from '@editor/widgets/edgeless-dragging-area/view';
import { EdgelessSelectedRectViewExtension } from '@editor/widgets/edgeless-selected-rect/view';
import { EdgelessToolbarViewExtension } from '@editor/widgets/edgeless-toolbar/view';
import { EdgelessZoomToolbarViewExtension } from '@editor/widgets/edgeless-zoom-toolbar/view';
import { FrameTitleViewExtension } from '@editor/widgets/frame-title/view';
import { KeyboardToolbarViewExtension } from '@editor/widgets/keyboard-toolbar/view';
import { LinkedDocViewExtension } from '@editor/widgets/linked-doc/view';
import { NoteSlicerViewExtension } from '@editor/widgets/note-slicer/view';
import { PageDraggingAreaViewExtension } from '@editor/widgets/page-dragging-area/view';
import { RemoteSelectionViewExtension } from '@editor/widgets/remote-selection/view';
import { ScrollAnchoringViewExtension } from '@editor/widgets/scroll-anchoring/view';
import { SlashMenuViewExtension } from '@editor/widgets/slash-menu/view';
import { ToolbarViewExtension } from '@editor/widgets/toolbar/view';
import { ViewportOverlayViewExtension } from '@editor/widgets/viewport-overlay/view';

export function getInternalViewExtensions() {
  return [
    FoundationViewExtension,

    // Gfx
    PointerViewExtension,
    GfxNoteViewExtension,
    BrushViewExtension,
    ShapeViewExtension,
    MindmapViewExtension,
    ConnectorViewExtension,
    GroupViewExtension,
    TextViewExtension,
    TemplateViewExtension,
    GfxLinkViewExtension,

    // Block
    AttachmentViewExtension,
    BookmarkViewExtension,
    CalloutViewExtension,
    CodeBlockViewExtension,
    DataViewViewExtension,
    DatabaseViewExtension,
    DividerViewExtension,
    EdgelessTextViewExtension,
    EmbedViewExtension,
    EmbedDocViewExtension,
    FrameViewExtension,
    ImageViewExtension,
    LatexViewExtension,
    ListViewExtension,
    NoteViewExtension,
    ParagraphViewExtension,
    SurfaceRefViewExtension,
    TableViewExtension,
    SurfaceViewExtension,
    RootViewExtension,

    // Inline
    InlineCommentViewExtension,
    FootnoteViewExtension,
    LinkViewExtension,
    ReferenceViewExtension,
    InlineLatexViewExtension,
    MentionViewExtension,
    InlinePresetViewExtension,

    // Widget
    // order will affect the z-index of the widget
    DragHandleViewExtension,
    EdgelessAutoConnectViewExtension,
    FrameTitleViewExtension,
    KeyboardToolbarViewExtension,
    LinkedDocViewExtension,
    RemoteSelectionViewExtension,
    ScrollAnchoringViewExtension,
    SlashMenuViewExtension,
    ToolbarViewExtension,
    ViewportOverlayViewExtension,
    EdgelessZoomToolbarViewExtension,
    PageDraggingAreaViewExtension,
    EdgelessSelectedRectViewExtension,
    EdgelessDraggingAreaViewExtension,
    NoteSlicerViewExtension,
    EdgelessToolbarViewExtension,

    // Fragment
    DocTitleViewExtension,
    FramePanelViewExtension,
    OutlineViewExtension,
    AdapterPanelViewExtension,
  ];
}
