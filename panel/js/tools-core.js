var DCToolsCore = (function () {
  'use strict';

  // Row-major 3x3 grid index (0=top-left .. 8=bottom-right) -> bounding-box
  // fractions. Used at runtime by the panel and sent to the host as primitives.
  function anchorFraction(index) {
    var i = (typeof index === 'number') ? index : parseInt(index, 10);
    i = Math.floor(i);
    if (isNaN(i) || i < 0 || i > 8) i = 4;
    return [(i % 3) * 0.5, Math.floor(i / 3) * 0.5];
  }

  function clampInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  return { anchorFraction: anchorFraction, clampInt: clampInt };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCToolsCore; }
