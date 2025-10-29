"use strict";

export function random(prng){
  const rand = typeof prng === 'function' ? prng : Math.random;
  const a = rand() * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}
