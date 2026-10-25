import { CommentInlineSpecExtension } from '@editor/inlines/comment';
import { FootNoteInlineSpecExtension } from '@editor/inlines/footnote';
import { LatexInlineSpecExtension } from '@editor/inlines/latex';
import { LinkInlineSpecExtension } from '@editor/inlines/link';
import { MentionInlineSpecExtension } from '@editor/inlines/mention';
import { ReferenceInlineSpecExtension } from '@editor/inlines/reference';
import type { AffineTextAttributes } from '@editor/shared/types';
import { InlineManagerExtension } from '@editor/runtime/inline';

import {
  BackgroundInlineSpecExtension,
  BoldInlineSpecExtension,
  CodeInlineSpecExtension,
  ColorInlineSpecExtension,
  ItalicInlineSpecExtension,
  StrikeInlineSpecExtension,
  UnderlineInlineSpecExtension,
} from './inline-spec';

export const DefaultInlineManagerExtension =
  InlineManagerExtension<AffineTextAttributes>({
    id: 'DefaultInlineManager',
    specs: [
      BoldInlineSpecExtension.identifier,
      ItalicInlineSpecExtension.identifier,
      UnderlineInlineSpecExtension.identifier,
      StrikeInlineSpecExtension.identifier,
      CodeInlineSpecExtension.identifier,
      BackgroundInlineSpecExtension.identifier,
      ColorInlineSpecExtension.identifier,
      LatexInlineSpecExtension.identifier,
      ReferenceInlineSpecExtension.identifier,
      LinkInlineSpecExtension.identifier,
      FootNoteInlineSpecExtension.identifier,
      MentionInlineSpecExtension.identifier,
      CommentInlineSpecExtension.identifier,
    ],
  });
