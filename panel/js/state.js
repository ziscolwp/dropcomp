var DCState = (function () {
  'use strict';

  function safeName(name) {
    return String(name).replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_');
  }

  function parseTimestamp(uniqueId) {
    var m = /_(\d{10,})$/.exec(String(uniqueId));
    return m ? parseInt(m[1], 10) : null;
  }

  function computeRenameTarget(oldUniqueId, newName) {
    var ts = parseTimestamp(oldUniqueId);
    if (ts === null) return null;
    return safeName(newName) + '_' + ts;
  }

  function formatMetaLine(comp) {
    if (!comp || !comp.width || !comp.height) return '';
    var parts = [comp.width + '×' + comp.height];
    if (comp.duration) parts.push((Math.round(comp.duration * 10) / 10).toFixed(1) + 's');
    if (comp.frameRate) parts.push(Math.round(comp.frameRate) + 'fps');
    return parts.join(' · ');
  }

  function addedAt(comp) {
    return comp.addedAt || parseTimestamp(comp.uniqueId) || 0;
  }

  return {
    safeName: safeName,
    parseTimestamp: parseTimestamp,
    computeRenameTarget: computeRenameTarget,
    formatMetaLine: formatMetaLine,
    addedAt: addedAt
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCState; }
