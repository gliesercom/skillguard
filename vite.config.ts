import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'lucide-react'],
          genlayer: ['genlayer-js', 'viem'],
        },
      },
    },
  },
  server: {
    strictPort: true,
    port: 5174,
    watch: { usePolling: true, interval: 300, ignored: ['**/*.tmp'] },
  },
});
