// DropComp tooltip - one fast, theme-matched hover/focus tip for the whole panel,
// replacing the slow native title tooltip. Text-only (textContent), never innerHTML,
// because script names/descriptions/paths are user data.
var DCTooltip = (function () {
  'use strict';

  var SHOW_DELAY = 300; // ms hover before showing; focus shows immediately
  var MARGIN = 6;       // viewport edge gap (px)

  // Decide where the tip box goes relative to its anchor, clamped to the viewport.
  function clampPosition(anchorRect, tipSize, viewport, margin) {
    margin = (margin == null) ? MARGIN : margin;
    var placement = 'below';
    var y = anchorRect.bottom + margin;
    if (y + tipSize.h + margin > viewport.h) {
      var above = anchorRect.top - tipSize.h - margin;
      if (above >= margin) { y = above; placement = 'above'; }
    }
    var x = anchorRect.left + (anchorRect.width / 2) - (tipSize.w / 2);
    var maxX = viewport.w - tipSize.w - margin;
    if (x > maxX) x = maxX;
    if (x < margin) x = margin;
    var maxY = viewport.h - tipSize.h - margin;
    if (y > maxY) y = maxY;
    if (y < margin) y = margin;
    return { x: x, y: y, placement: placement };
  }

  // Build the rich tip for a script row: {title, body}, body lines joined with '\n'.
  function buildScriptTip(entry, usage) {
    entry = entry || {};
    var lines = [];
    if (entry.description) lines.push(String(entry.description));
    if (entry.source === 'file') {
      lines.push('File: ' + (entry.path || '(no path)'));
    } else {
      lines.push('Snippet');
      var body = String(entry.body || '');
      if (body) {
        var rows = body.split('\n');
        var preview = rows.slice(0, 5).join('\n');
        if (rows.length > 5) preview += '\n…';
        lines.push(preview);
      }
    }
    if (usage && usage.runCount) {
      lines.push('Run ' + usage.runCount + (usage.runCount === 1 ? ' time' : ' times'));
    }
    return { title: String(entry.name || ''), body: lines.join('\n') };
  }

  return {
    init: function () {}, // replaced by the controller in Task 2
    clampPosition: clampPosition,
    buildScriptTip: buildScriptTip
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCTooltip; }
