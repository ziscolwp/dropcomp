var DCTools = (function () {
  'use strict';

  var mounted = false;
  var PRECOMP_FN = {
    precomp: 'tlPreComp', multi: 'tlMultiPreComp',
    decompose: 'tlDecompose', independent: 'tlIndependent'
  };
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // Build a counted/named success message from the host's JSON result. The host
  // returns { ok, count, name?, ignored?, approx?, warn? }; surface those so the
  // user sees what actually happened instead of a flat "Done."
  function okMessage(fn, r) {
    var n = (r && typeof r.count === 'number') ? r.count : 0;
    var approx = (r && r.approx) ? ' ' + r.approx + ' parented (bounds approximate).' : '';
    if (fn === 'tlCreateLayer') return 'Created ' + ((r && r.name) || 'layer') + '.';
    if (fn === 'tlSetAnchor') return 'Anchor set on ' + plural(n, 'layer') + '.';
    if (fn === 'tlAlign') return 'Aligned ' + plural(n, 'layer') + '.' + approx;
    if (fn === 'tlDistribute') return 'Distributed ' + plural(n, 'layer') + '.' + approx;
    if (fn === 'tlReset') return 'Recentered ' + plural(n, 'layer') + '.' + approx;
    if (fn === 'tlSequence') {
      if (r && r.mode === 'keys') {
        return r.unit === 'key'
          ? 'Sequenced ' + plural(n, 'keyframe') + '.'
          : 'Staggered keyframes on ' + plural(n, 'layer') + '.';
      }
      if (r && r.mode === 'duplicate') return 'Added ' + plural(n, 'duplicate') + '.';
      return 'Staggered ' + plural(n, 'layer') + '.';
    }
    if (fn === 'tlPreComp') return 'Precomposed ' + plural(n, 'layer') + ((r && r.name) ? ' → ' + r.name : '') + '.';
    if (fn === 'tlMultiPreComp') return 'Precomposed ' + plural(n, 'layer') + ' separately.';
    if (fn === 'tlDecompose') return 'Decomposed into ' + plural(n, 'layer') + '.' + ((r && r.warn) ? ' Not preserved: ' + r.warn + '.' : '');
    if (fn === 'tlIndependent') return 'Made ' + plural(n, 'layer') + ' unique.' + ((r && r.ignored) ? ' ' + r.ignored + ' ignored.' : '');
    return 'Done.';
  }

  function init() { /* nothing to pre-load; wiring is lazy in ensureMounted */ }

  function ensureMounted() {
    if (mounted) return;
    mounted = true;
    var root = document.getElementById('tools');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onAnchorKeydown);
  }

  function setBusy(on) {
    var root = document.getElementById('tools');
    if (root) root.classList.toggle('tool-busy', on);
  }

  function run(label, fn, args) {
    if (!DCBridge.acquire(label)) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    setBusy(true);
    DCBridge.call(fn, args, function (result) {
      DCBridge.release();
      setBusy(false);
      var r = DCBridge.parseJson(result);
      if (r && r.ok) DCUI.toast(okMessage(fn, r), false);
      else DCUI.toast((r && r.error) || result || 'Tool failed.', true);
    });
  }

  // Mark the chosen anchor cell active (the spec's .anchor-cell.on state).
  function setAnchorActive(btn) {
    var cells = document.querySelectorAll('#tools .anchor-cell');
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('on');
    btn.classList.add('on');
  }

  // Roving-tabindex arrow-key navigation across the 3x3 anchor grid.
  function onAnchorKeydown(e) {
    var cell = e.target.closest ? e.target.closest('.anchor-cell') : null;
    if (!cell) return;
    var idx = parseInt(cell.dataset.arg, 10);
    var col = idx % 3, row = Math.floor(idx / 3), moved = false;
    if (e.key === 'ArrowRight' && col < 2) { idx++; moved = true; }
    else if (e.key === 'ArrowLeft' && col > 0) { idx--; moved = true; }
    else if (e.key === 'ArrowDown' && row < 2) { idx += 3; moved = true; }
    else if (e.key === 'ArrowUp' && row > 0) { idx -= 3; moved = true; }
    if (!moved) return;
    e.preventDefault();
    var cells = document.querySelectorAll('#tools .anchor-cell');
    for (var i = 0; i < cells.length; i++) cells[i].tabIndex = -1;
    cells[idx].tabIndex = 0;
    cells[idx].focus();
  }

  // Custom +/- steppers on the Count/Step fields (native spinners are hidden).
  function adjustStepper(btn) {
    var input = btn.parentNode ? btn.parentNode.querySelector('input') : null;
    if (!input) return;
    var delta = parseInt(btn.getAttribute('data-step'), 10) || 0;
    var min = input.hasAttribute('min') ? parseInt(input.getAttribute('min'), 10) : -100000;
    var max = input.hasAttribute('max') ? parseInt(input.getAttribute('max'), 10) : 100000;
    var next = DCToolsCore.clampInt(input.value, -100000, 100000, 0) + delta;
    if (next < min) next = min;
    if (next > max) next = max;
    input.value = next;
  }

  function onClick(e) {
    var stepBtn = e.target.closest ? e.target.closest('.stepper-btn') : null;
    if (stepBtn) { adjustStepper(stepBtn); return; }
    var btn = e.target.closest('[data-tool]');
    if (!btn) return;
    var tool = btn.dataset.tool;
    var arg = btn.dataset.arg;
    if (tool === 'anchor') {
      setAnchorActive(btn);
      var f = DCToolsCore.anchorFraction(parseInt(arg, 10));
      run('anchor', 'tlSetAnchor', [f[0], f[1]]);
    } else if (tool === 'create') {
      run('create', 'tlCreateLayer', [arg]);
    } else if (tool === 'align') {
      run('align', 'tlAlign', [arg]);
    } else if (tool === 'distribute') {
      run('distribute', 'tlDistribute', [arg]);
    } else if (tool === 'reset') {
      run('reset', 'tlReset', []);
    } else if (tool === 'sequence') {
      var num = DCToolsCore.clampInt(document.getElementById('tools-num').value, 1, 500, 1);
      var step = DCToolsCore.clampInt(document.getElementById('tools-step').value, -100000, 100000, 5);
      run('sequence', 'tlSequence', [num, step]);
    } else if (tool === 'precomp') {
      var fn = PRECOMP_FN[arg];
      if (fn) run('precomp', fn, []);
    }
  }

  return { init: init, ensureMounted: ensureMounted };
}());
