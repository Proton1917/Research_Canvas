import type { DocMode } from '@editor/model';
import type { BlockStdScope } from '@editor/runtime';
import type { ExtensionType, Store } from '@editor/document';
import { getEditorSpecs, type ResearchEditorContainer } from '@research/editor';
import { useEffect, useRef } from 'react';

type Props = {
  store: Store;
  mode: DocMode;
  className?: string;
  extensions?: ExtensionType[];
  onReady?: (editor: ResearchEditorContainer, std: BlockStdScope) => void | (() => void);
  onDispose?: () => void;
};

/** 挂载 BlockSuite 编辑器容器；文稿或模式变化时重建编辑器。 */
export function EditorHost({ store, mode, className = '', extensions, onReady, onDispose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  const dispose = useRef(onDispose);
  ready.current = onReady;
  dispose.current = onDispose;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const editor = document.createElement('rc-editor-container');
    const specs = getEditorSpecs({ getMode: () => editor.mode, setMode: next => editor.switchEditor(next), extra: extensions });
    editor.pageSpecs = specs.page;
    editor.edgelessSpecs = specs.edgeless;
    editor.mode = mode;
    editor.doc = store;
    element.append(editor);
    let cancelled = false;
    let cleanup: void | (() => void);
    void editor.updateComplete.then(() => {
      if (!cancelled) cleanup = ready.current?.(editor, editor.std);
    });
    return () => {
      cancelled = true;
      cleanup?.();
      dispose.current?.();
      editor.remove();
    };
  }, [store, mode, extensions]);

  return <div ref={host} className={`relative h-full min-h-0 w-full ${className}`} />;
}
