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

  var el = null;      // floating tip element
  var timer = null;
  var current = null; // element currently driving the tip

  function ensureEl() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dc-tooltip';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  }

  function setContent(node, title, body) {
    node.textContent = '';
    if (title) {
      var t = document.createElement('div');
      t.className = 'dc-tip-title';
      t.textContent = title;
      node.appendChild(t);
    }
    var lines = String(body == null ? '' : body).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var ln = document.createElement('div');
      ln.textContent = lines[i];
      node.appendChild(ln);
    }
  }

  function owner(e) {
    return (e.target && e.target.closest) ? e.target.closest('[data-tip], [data-tip-title]') : null;
  }

  function show(target) {
    var title = target.getAttribute('data-tip-title') || '';
    var body = target.getAttribute('data-tip') || '';
    if (!title && !String(body).trim()) return;
    var node = ensureEl();
    setContent(node, title, body);
    var size = { w: node.offsetWidth, h: node.offsetHeight }; // measured while hidden
    var rect = target.getBoundingClientRect();
    var pos = clampPosition(rect, size, { w: window.innerWidth, h: window.innerHeight }, MARGIN);
    node.style.left = Math.round(pos.x) + 'px';
    node.style.top = Math.round(pos.y) + 'px';
    node.setAttribute('data-placement', pos.placement);
    node.classList.add('show');
    node.setAttribute('aria-hidden', 'false');
    current = target;
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    current = null;
    if (!el) return;
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
  }

  function scheduleShow(target, immediate) {
    if (timer) clearTimeout(timer);
    if (immediate) { show(target); return; }
    timer = setTimeout(function () { show(target); }, SHOW_DELAY);
  }

  function onOver(e) { var t = owner(e); if (t && t !== current) scheduleShow(t, false); }
  function onOut(e) {
    var t = owner(e);
    if (!t) return;
    // pointerout also fires when moving parent -> child; only hide when the
    // pointer has actually left the owning [data-tip] element.
    if (!e.relatedTarget || !t.contains(e.relatedTarget)) hide();
  }
  function onFocus(e) { var t = owner(e); if (t) scheduleShow(t, true); }

  function init() {
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); }, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide, true);
  }

  return {
    init: init,
    clampPosition: clampPosition,
    buildScriptTip: buildScriptTip
  };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCTooltip; }
