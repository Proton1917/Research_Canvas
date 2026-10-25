import { FootNoteSchema } from '@editor/model';
import type { AffineTextAttributes } from '@editor/shared/types';
import { StdIdentifier } from '@editor/runtime';
import { InlineSpecExtension } from '@editor/runtime/inline';
import { html } from 'lit';
import z from 'zod';

import { FootNoteNodeConfigIdentifier } from './footnote-node/footnote-config';

export const FootNoteInlineSpecExtension =
  InlineSpecExtension<AffineTextAttributes>('footnote', provider => {
    const std = provider.get(StdIdentifier);
    const config =
      provider.getOptional(FootNoteNodeConfigIdentifier) ?? undefined;
    return {
      name: 'footnote',
      schema: z.object({
        footnote: FootNoteSchema.optional().nullable().catch(undefined),
      }),
      match: delta => {
        return !!delta.attributes?.footnote;
      },
      renderer: ({ delta }) => {
        return html`<affine-footnote-node
          .delta=${delta}
          .std=${std}
          .config=${config}
        ></affine-footnote-node>`;
      },
      embed: true,
    };
  });
