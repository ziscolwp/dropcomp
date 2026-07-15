var DCSync = (function () {
  'use strict';

  var EVENT_TYPE = 'com.dropcomp.changed';
  var KINDS = ['library', 'assets', 'scripts', 'prefs', 'path'];

  var cs = null;
  var ownId = '';

  function isKind(k) { return KINDS.indexOf(k) !== -1; }

  // CEP delivers event.data as a JSON string in some host versions and as an
  // already-parsed object in others; anything malformed decodes to null.
  function decode(raw) {
    var msg = raw;
    if (typeof raw === 'string') {
      try { msg = JSON.parse(raw); } catch (e) { return null; }
    }
    if (!msg || typeof msg !== 'object') return null;
    if (!isKind(msg.kind) || typeof msg.sender !== 'string') return null;
    return { kind: msg.kind, sender: msg.sender };
  }

  function makeEvent() {
    // CSEvent exists in the CEP runtime; node tests get a plain object
    if (typeof CSEvent !== 'undefined') return new CSEvent(EVENT_TYPE, 'APPLICATION');
    return { type: EVENT_TYPE, scope: 'APPLICATION' };
  }

  function init(csInterface, extensionId, onRemoteChange) {
    cs = csInterface;
    ownId = extensionId || '';
    var handler = onRemoteChange || function () {};
    cs.addEventListener(EVENT_TYPE, function (event) {
      var msg = decode(event && event.data);
      if (!msg || msg.sender === ownId) return;
      handler(msg.kind);
    });
  }

  function broadcast(kind) {
    if (!cs || !isKind(kind)) return;
    var ev = makeEvent();
    ev.extensionId = ownId;
    ev.data = JSON.stringify({ kind: kind, sender: ownId });
    cs.dispatchEvent(ev);
  }

  return { EVENT_TYPE: EVENT_TYPE, decode: decode, init: init, broadcast: broadcast };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCSync; }
