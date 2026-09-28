"use strict";

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
const version = "1.0.0";

module.exports = { clamp, chunk, version };
