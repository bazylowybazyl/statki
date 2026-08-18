import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    __HEX_SIM_BUILD__: JSON.stringify('hex-sim-v2'),
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    rollupOptions: {
      // AI SPACE is a real second entry point, not a detached copy of the game.
      // Keeping it in the normal build catches broken imports whenever gameplay
      // modules change.
      input: ['index.html', 'AISPACE.html'],
    },
  },
});
