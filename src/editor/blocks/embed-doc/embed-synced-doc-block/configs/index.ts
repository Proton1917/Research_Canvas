import {
  EmbedSyncedDocBlockSchema,
  type EmbedSyncedDocModel,
} from '@editor/model';
import { type BlockStdScope, ConfigExtensionFactory } from '@editor/runtime';
import type { TemplateResult } from 'lit';

export type EmbedSyncedDocConfig = {
  edgelessHeader: (context: {
    model: EmbedSyncedDocModel;
    std: BlockStdScope;
  }) => TemplateResult;
};

export const EmbedSyncedDocConfigExtension =
  ConfigExtensionFactory<EmbedSyncedDocConfig>(
    EmbedSyncedDocBlockSchema.model.flavour
  );
