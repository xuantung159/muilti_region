import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: env.PORTAL_API_TARGET ? {
    '/api': { target: env.PORTAL_API_TARGET, changeOrigin: true },
  } : undefined },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  };
});
