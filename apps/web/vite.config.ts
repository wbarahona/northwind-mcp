import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** In development the agent runs on 5174 (see apps/agent's dev script); Vite proxies to it. */
const AGENT = process.env.AGENT_DEV_URL ?? 'http://127.0.0.1:5174';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: AGENT, changeOrigin: false },
      '/healthz': { target: AGENT, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    // The agent's Content-Security-Policy allows no inline scripts or styles.
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
