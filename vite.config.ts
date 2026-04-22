import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples/jsm/')) {
            return 'three-examples';
          }

          if (id.includes('node_modules/three/')) {
            return 'three-core';
          }

          return undefined;
        },
      },
    },
  },
});
