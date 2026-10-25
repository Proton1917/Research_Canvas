import { existsSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { parse } from 'smol-toml';

import configuration from './tsconfig.json';

const root = fileURLToPath(new URL('.', import.meta.url));
const aliases = Object.entries(configuration.compilerOptions.paths).map(([name, targets]) => ({
  find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '(.+)')}$`),
  replacement: fileURLToPath(new URL(targets[0], import.meta.url)).replace('*', '$1'),
}));

// 开发代理与后端共用服务地址配置。
function backendOrigin() {
  if (process.env.RESEARCH_CANVAS_API) return process.env.RESEARCH_CANVAS_API;
  const local = `${root}/config/server.toml`;
  const settings = parse(readFileSync(existsSync(local) ? local : `${root}/config/server.example.toml`, 'utf8'));
  if (typeof settings.host !== 'string' || typeof settings.port !== 'number') {
    throw new Error('后端配置需要 host 和 port');
  }
  return `http://${settings.host}:${settings.port}`;
}

export default defineConfig({
  cacheDir: `${root}/.runtime/vite-cache`,
  plugins: [wasm(), vanillaExtractPlugin()],
  esbuild: {
    jsx: 'automatic',
    target: 'es2022',
  },
  resolve: {
    alias: aliases,
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
    entries: ['index.html'],
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
