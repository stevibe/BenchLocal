import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = Number(process.env.BENCHLOCAL_PORT) || 4300;
const webDevPort = Number(process.env.BENCHLOCAL_WEB_PORT) || 4301;
const webRoot = path.resolve(__dirname, 'src/renderer');
const webOutDir = path.resolve(__dirname, '../dist/renderer-out');

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@core': path.resolve(__dirname, '../packages/benchlocal-core/src'),
      '@benchpack-host': path.resolve(
        __dirname,
        '../packages/benchpack-host/src',
      ),
    },
  },
  build: {
    outDir: webOutDir,
    emptyOutDir: true,
  },
  server: {
    port: webDevPort,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
