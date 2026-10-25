import { type effects as blockRootEffects } from '@editor/blocks/root/effects';
import { type effects as componentCaptionEffects } from '@editor/components/caption';
import { type effects as componentColorPickerEffects } from '@editor/components/color-picker';
import { type effects as componentContextMenuEffects } from '@editor/components/context-menu';
import { type effects as componentDatePickerEffects } from '@editor/components/date-picker';
import { type effects as componentDropIndicatorEffects } from '@editor/components/drop-indicator';
import { type effects as componentEmbedCardModalEffects } from '@editor/components/embed-card-modal';
import { type effects as componentHighlightDropdownMenuEffects } from '@editor/components/highlight-dropdown-menu';
import { type effects as componentLinkPreviewEffects } from '@editor/components/link-preview';
import { type effects as componentLinkedDocTitleEffects } from '@editor/components/linked-doc-title';
import { type effects as componentPortalEffects } from '@editor/components/portal';
import { type effects as componentToggleButtonEffects } from '@editor/components/toggle-button';
import { type effects as componentToolbarEffects } from '@editor/components/toolbar';
import { type effects as componentViewDropdownMenuEffects } from '@editor/components/view-dropdown-menu';
import { type effects as richTextEffects } from '@editor/rich-text/effects';
import { type effects as stdEffects } from '@editor/runtime/effects';

export declare const _GLOBAL_:
  | typeof stdEffects
  | typeof richTextEffects
  | typeof blockRootEffects
  | typeof componentCaptionEffects
  | typeof componentContextMenuEffects
  | typeof componentDatePickerEffects
  | typeof componentDropIndicatorEffects
  | typeof componentEmbedCardModalEffects
  | typeof componentHighlightDropdownMenuEffects
  | typeof componentLinkPreviewEffects
  | typeof componentLinkedDocTitleEffects
  | typeof componentPortalEffects
  | typeof componentToolbarEffects
  | typeof componentToggleButtonEffects
  | typeof componentColorPickerEffects
  | typeof componentViewDropdownMenuEffects;
