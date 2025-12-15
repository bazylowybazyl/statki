"use strict";
import regl from 'regl';

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
  const mergedAttributes = { 
    ...DEFAULT_ATTRIBUTES, 
    ...(opts && opts.attributes ? opts.attributes : {}) 
  };

  const finalOpts = { 
    ...opts, 
    attributes: mergedAttributes 
  };

  return regl(finalOpts);
}
