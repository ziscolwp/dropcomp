// DropComp rail - keyboard behavior for the vertical nav rail (ARIA tabs,
// manual activation): Up/Down/Home/End move focus among the tabs, activation
// stays on the buttons' native Enter/Space/click. Selection visuals and
// aria-selected live in DCShell.setActiveTab, the single active-tab authority.
var DCRail = (function () {
  'use strict';

  // Index that should receive focus for a tablist keydown; null = not ours.
  function targetIndex(key, index, count) {
    if (!count) return null;
    if (key === 'ArrowDown') return (index + 1) % count;
    if (key === 'ArrowUp') return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return null;
  }

  function init(tablist) {
    if (!tablist) return;
    var tabs = tablist.querySelectorAll('[role="tab"]');
    tablist.addEventListener('keydown', function (e) {
      var current = -1;
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i] === e.target) { current = i; break; }
      }
      if (current === -1) return;
      var next = targetIndex(e.key, current, tabs.length);
      if (next === null) return;
      e.preventDefault();
      // roving tabindex follows focus so Tab exits (and re-enters) here
      for (var j = 0; j < tabs.length; j++) {
        tabs[j].setAttribute('tabindex', j === next ? '0' : '-1');
      }
      tabs[next].focus();
    });
  }

  return { init: init, targetIndex: targetIndex };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCRail; }
