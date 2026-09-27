import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    __HEX_SIM_BUILD__: JSON.stringify('hex-sim-v2'),
  },
  // Port WebGPU (docs/webgpu/SPIKE.md p. 1): three, three/webgpu i three/tsl
  // prebundlowane razem — jeden rdzeń klas, a pierwsze wykrycie three/webgpu
  // w dev nie przeładowuje strony.
  optimizeDeps: {
    include: ['three', 'three/webgpu', 'three/tsl'],
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
});
