import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { META_CSP } from './src/shared/csp';

function injectProductionCsp(): Plugin {
  return {
    name: 'framewright:csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: META_CSP },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

export default defineConfig({
  main: {
    build: { externalizeDeps: false },
  },
  preload: {
    build: { externalizeDeps: false },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), injectProductionCsp()],
    build: {
      minify: true,
      // Loaded from local disk, so web-style code splitting buys nothing.
      chunkSizeWarningLimit: 2048,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
