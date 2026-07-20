// DropComp density - responsive body classes driven by #main's real content
// width. The 40px rail only exists in the combined panel, so a viewport media
// query is 40px wrong there; measuring #main keeps every mode honest.
// dc-narrow (<360px): drop the header title, tighten paddings.
// dc-tight  (<300px): tool buttons go icon-only (tooltips still explain).
var DCDensity = (function () {
  'use strict';

  var NARROW = 360;
  var TIGHT = 300;

  function classesFor(width) {
    return { narrow: width < NARROW, tight: width < TIGHT };
  }

  function measure() {
    var main = document.getElementById('main');
    var width = main ? main.clientWidth : window.innerWidth;
    if (!width) return; // app still hidden at boot - keep state until it shows
    var c = classesFor(width);
    document.body.classList.toggle('dc-narrow', c.narrow);
    document.body.classList.toggle('dc-tight', c.tight);
  }

  function init() {
    var main = document.getElementById('main');
    // the observer also fires when #main first gets a box (app unhidden)
    if (typeof ResizeObserver !== 'undefined' && main) {
      new ResizeObserver(measure).observe(main);
    }
    window.addEventListener('resize', measure);
    measure();
  }

  return { init: init, measure: measure, classesFor: classesFor, NARROW: NARROW, TIGHT: TIGHT };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCDensity; }
