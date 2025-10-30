"use strict";

export default function createREGL(opts){
  const f = (window.createREGL || window.regl);
  if (!f) {
    throw new Error('[Tyro] REGL not loaded. Add <script src="https://unpkg.com/regl/dist/regl.min.js"></script> before modules.');
  }
  return f(opts);
}

