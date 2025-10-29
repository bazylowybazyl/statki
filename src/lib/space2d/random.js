"use strict";

export function generateRandomSeed(){
  return (Math.random() * 1e18).toString(36);
}

export function hashcode(str){
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 131 + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function rand(seed, offset = 0){
  const s = (hashcode(String(seed)) + (offset | 0)) >>> 0;
  const r = mulberry32(s || 1);
  return { random: r };
}
