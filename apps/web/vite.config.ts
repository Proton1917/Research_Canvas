import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const root = fileURLToPath(new URL('../..', import.meta.url));
// 后端地址读取 config/server.toml 的 host 与 port，默认 127.0.0.1:8787。
function backendOrigin() {
  if (process.env.RESEARCH_CANVAS_API) return process.env.RESEARCH_CANVAS_API;
  try {
    const toml = readFileSync(`${root}/config/server.toml`, 'utf8');
    const host = /^host\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? '127.0.0.1';
    const port = /^port\s*=\s*(\d+)/m.exec(toml)?.[1] ?? '8787';
    return `http://${host}:${port}`;
  } catch {
    return 'http://127.0.0.1:8787';
  }
}

export default defineConfig({
  cacheDir: `${root}/.runtime/vite-cache`,
  plugins: [wasm(), vanillaExtractPlugin()],
  esbuild: {
    jsx: 'automatic',
    target: 'es2022',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backendOrigin(), changeOrigin: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backendOrigin(), changeOrigin: false },
    },
  },
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      maxParallelFileOps: Math.max(1, cpus().length - 1),
      onwarn(warning, defaultHandler) {
        if (warning.code && ['EVAL', 'SOURCEMAP_ERROR', 'MODULE_LEVEL_DIRECTIVE'].includes(warning.code)) return;
        defaultHandler(warning);
      },
    },
  },
});
