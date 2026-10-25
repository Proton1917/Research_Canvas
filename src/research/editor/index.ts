import '@editor/effects';

import { ResearchEditorContainer } from './editor-container';

let registered = false;

/** 注册 BlockSuite 自定义元素与编辑器容器；应用启动时调用一次。 */
export function registerEditorElements() {
  if (registered) return;
  registered = true;
  if (!customElements.get('rc-editor-container')) customElements.define('rc-editor-container', ResearchEditorContainer);
}

export { ResearchEditorContainer } from './editor-container';
export * from './extensions';
export * from './projection';
export * from './scene';
export * from './selection';
export * from './session';
export { ResearchDoc, ResearchWorkspace } from './workspace';
