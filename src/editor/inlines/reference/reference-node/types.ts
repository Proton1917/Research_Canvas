import type { ReferenceInfo } from '@editor/model';
import type { OpenDocMode } from '@editor/shared/services';
import type { EditorHost } from '@editor/runtime';
import type { Subject } from 'rxjs';

export type DocLinkClickedEvent = ReferenceInfo & {
  // default is active view
  openMode?: OpenDocMode;
  event?: MouseEvent;
  host: EditorHost;
};

export type RefNodeSlots = {
  docLinkClicked: Subject<DocLinkClickedEvent>;
};
