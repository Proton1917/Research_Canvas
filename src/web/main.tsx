import './styles.css';

import { registerEditorElements } from '@research/editor';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';

// 编辑器自定义元素管理自身的挂载与卸载。
registerEditorElements();

createRoot(document.getElementById('root')!).render(<App />);
