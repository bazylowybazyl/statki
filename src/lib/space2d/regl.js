"use strict";

const DEFAULT_ATTRIBUTES = {
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance'
};

export default function createREGL(opts = {}){
  const factory = (typeof window !== 'undefined') ? (window.createREGL || window.regl) : null;
  if (typeof factory !== 'function') {
    throw new Error('[Tyro] REGL not loaded. Add <script src="https://unpkg.com/regl/dist/regl.min.js"></script> before modules.');
  }

  const mergedOpts = { ...opts };
  mergedOpts.attributes = { ...DEFAULT_ATTRIBUTES, ...(opts && opts.attributes) };

  try {
    return factory(mergedOpts);
  } catch (err) {
    const message = (err && err.message) ? String(err.message) : String(err || 'Unknown error');
    if (/context/i.test(message)) {
      throw new Error(`[Tyro] Unable to create REGL context — WebGL context limit reached or unavailable. Close other WebGL applications and try again. Original error: ${message}`);
    }
    throw err;
  }
}

