import './styles.css';

import { registerEditorElements } from '@research-canvas/research/editor';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';

// BlockSuite 编辑器为自定义元素，挂载与卸载由组件自身管理；不启用 StrictMode 的双重挂载。
registerEditorElements();

createRoot(document.getElementById('root')!).render(<App />);
