var DCBridge = (function () {
  'use strict';

  function escapeForEvalScript(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  function buildCall(fnName, args) {
    var parts = (args || []).map(function (a) {
      return '"' + escapeForEvalScript(a) + '"';
    });
    return fnName + '(' + parts.join(', ') + ')';
  }

  function parseJson(result) {
    try { return JSON.parse(result); } catch (e) { return null; }
  }

  var cs = null;
  var currentOp = false;
  var extensionPath = null;

  function init(csInterface, extPath) {
    cs = csInterface;
    extensionPath = extPath || null;
  }

  function acquire(name) {
    if (currentOp) return false;
    currentOp = name;
    return true;
  }

  function release() { currentOp = false; }

  function busyWith() { return currentOp; }

  function call(fnName, args, cb) {
    cs.evalScript(buildCall(fnName, args), function (result) {
      // CEP returns the literal 'EvalScript error.' when the host function is
      // undefined - typically a module that failed to load at boot. Reload
      // the modules once and retry before surfacing the raw error.
      if (result === 'EvalScript error.' && extensionPath) {
        cs.evalScript(buildCall('loadHostModules', [extensionPath]), function () {
          cs.evalScript(buildCall(fnName, args), cb || function () {});
        });
        return;
      }
      (cb || function () {})(result);
    });
  }

  return {
    escapeForEvalScript: escapeForEvalScript,
    buildCall: buildCall,
    parseJson: parseJson,
    init: init,
    acquire: acquire,
    release: release,
    busyWith: busyWith,
    call: call
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCBridge; }
