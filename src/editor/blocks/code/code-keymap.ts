import { textKeymap } from '@editor/inlines/preset';
import { CodeBlockSchema } from '@editor/model';
import { KeymapExtension } from '@editor/runtime';

export const CodeKeymapExtension = KeymapExtension(textKeymap, {
  flavour: CodeBlockSchema.model.flavour,
});
