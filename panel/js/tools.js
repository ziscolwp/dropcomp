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
    if (fn === 'tlSequence') return 'Sequenced ' + plural(n, 'layer') + '.';
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
  }

  function run(label, fn, args) {
    if (!DCBridge.acquire(label)) { DCUI.toast('Busy: ' + DCBridge.busyWith(), true); return; }
    DCBridge.call(fn, args, function (result) {
      DCBridge.release();
      var r = DCBridge.parseJson(result);
      if (r && r.ok) DCUI.toast(okMessage(fn, r), false);
      else DCUI.toast((r && r.error) || result || 'Tool failed.', true);
    });
  }

  function onClick(e) {
    var btn = e.target.closest('[data-tool]');
    if (!btn) return;
    var tool = btn.dataset.tool;
    var arg = btn.dataset.arg;
    if (tool === 'anchor') {
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
