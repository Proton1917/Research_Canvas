import { createIdentifier } from '@editor/platform/di';
import type { EditorHost } from '@editor/runtime';

export const EditorHostKey = createIdentifier<EditorHost>('editor-host');
