var DCTools = (function () {
  'use strict';

  var mounted = false;
  var PRECOMP_FN = {
    precomp: 'tlPreComp', multi: 'tlMultiPreComp',
    decompose: 'tlDecompose', independent: 'tlIndependent'
  };
  var OK_MSG = {
    tlSetAnchor: 'Anchor set.', tlCreateLayer: 'Layer created.',
    tlAlign: 'Aligned.', tlDistribute: 'Distributed.', tlReset: 'Recentered.',
    tlSequence: 'Sequenced.', tlPreComp: 'Precomposed.',
    tlMultiPreComp: 'Precomposed each layer.', tlDecompose: 'Decomposed.',
    tlIndependent: 'Made independent.'
  };

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
      if (r && r.ok) DCUI.toast(OK_MSG[fn] || 'Done.', false);
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
      run('precomp', PRECOMP_FN[arg], []);
    }
  }

  return { init: init, ensureMounted: ensureMounted };
}());
