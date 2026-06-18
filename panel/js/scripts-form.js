// DropComp Scripts - form rendering. Builds the editor's "Inputs" builder rows and the
// inline run-form shown under a script row. Pure DOM glue; the typing/serialization logic
// lives in DCScriptsCore (unit-tested).
var DCScriptsForm = (function () {
  'use strict';

  var TYPES = ['text', 'number', 'slider', 'checkbox', 'select'];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function q(root, sel) { return root.querySelector(sel); }
  function mkInput(type, val, ph, cls) {
    var i = document.createElement('input');
    i.type = type; if (val != null) i.value = val; if (ph) i.placeholder = ph; if (cls) i.className = cls;
    return i;
  }

  // ---------- inline run-form ----------
  function controlFor(p) {
    var input;
    if (p.type === 'checkbox') { input = mkInput('checkbox'); input.checked = !!p['default']; }
    else if (p.type === 'select') {
      input = document.createElement('select');
      var opts = p.options || [];
      for (var i = 0; i < opts.length; i++) {
        var o = document.createElement('option'); o.value = opts[i]; o.textContent = opts[i];
        if (opts[i] === p['default']) o.selected = true;
        input.appendChild(o);
      }
    } else if (p.type === 'slider') {
      input = mkInput('range'); if (p.min != null) input.min = p.min; if (p.max != null) input.max = p.max;
      if (p.step != null) input.step = p.step; input.value = (p['default'] != null ? p['default'] : p.min);
    } else if (p.type === 'number') {
      input = mkInput('number'); if (p.min != null) input.min = p.min; if (p.max != null) input.max = p.max;
      if (p.step != null) input.step = p.step; input.value = (p['default'] != null ? p['default'] : '');
    } else {
      input = mkInput('text'); input.value = (p['default'] != null ? p['default'] : '');
    }
    input.className = 'script-control';
    return input;
  }

  function renderRunForm(entry, onApply, onCancel) {
    var params = entry.params || [];
    var wrap = el('div', 'script-form');
    var inputs = {};
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var field = el('label', 'script-field');
      field.appendChild(el('span', 'script-field-label', p.label || p.key));
      var input = controlFor(p);
      inputs[p.key] = input;
      field.appendChild(input);
      wrap.appendChild(field);
    }
    var btns = el('div', 'script-form-btns');
    var cancel = el('button', 'btn-dark', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', function () { if (onCancel) onCancel(); });
    var apply = el('button', 'btn-gold', 'Apply'); apply.type = 'button';
    apply.addEventListener('click', function () {
      var raw = {};
      for (var k in inputs) {
        if (inputs.hasOwnProperty(k)) raw[k] = (inputs[k].type === 'checkbox') ? inputs[k].checked : inputs[k].value;
      }
      onApply(DCScriptsCore.buildValuesJson(params, raw));
    });
    btns.appendChild(cancel); btns.appendChild(apply);
    wrap.appendChild(btns);
    return wrap;
  }

  // ---------- editor builder ----------
  function builderRow(p) {
    p = p || { type: 'text' };
    var row = el('div', 'builder-row');
    row.dataset.type = p.type || 'text';
    row.appendChild(mkInput('text', p.label || '', 'Label', 'builder-label'));
    row.appendChild(mkInput('text', p.key || '', 'key', 'builder-key'));

    var type = document.createElement('select'); type.className = 'builder-type';
    for (var i = 0; i < TYPES.length; i++) {
      var o = document.createElement('option'); o.value = TYPES[i]; o.textContent = TYPES[i];
      if (TYPES[i] === (p.type || 'text')) o.selected = true;
      type.appendChild(o);
    }
    type.addEventListener('change', function () { row.dataset.type = type.value; });
    row.appendChild(type);

    var num = el('div', 'b-num');
    num.appendChild(mkInput('number', p.min != null ? p.min : '', 'min', 'b-min'));
    num.appendChild(mkInput('number', p.max != null ? p.max : '', 'max', 'b-max'));
    num.appendChild(mkInput('number', p.step != null ? p.step : '', 'step', 'b-step'));
    row.appendChild(num);

    row.appendChild(mkInput('text', (p.options || []).join(', '), 'options, comma separated', 'b-opts-input b-opts'));
    row.appendChild(mkInput('text', p['default'] != null ? p['default'] : '', 'default', 'builder-default'));

    var rm = el('button', 'script-action', ''); rm.type = 'button'; rm.textContent = '✕';
    rm.setAttribute('data-tip', 'Remove input');
    rm.addEventListener('click', function () { if (row.parentNode) row.parentNode.removeChild(row); });
    row.appendChild(rm);
    return row;
  }

  function renderBuilder(container, params) {
    container.innerHTML = '';
    var list = params || [];
    for (var i = 0; i < list.length; i++) container.appendChild(builderRow(list[i]));
  }

  function addBuilderRow(container) { container.appendChild(builderRow({ type: 'text' })); }

  function readBuilder(container) {
    var rows = container.querySelectorAll('.builder-row');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var type = q(r, '.builder-type').value;
      var p = { key: q(r, '.builder-key').value.trim(), label: q(r, '.builder-label').value.trim(), type: type };
      if (type === 'number' || type === 'slider') {
        var mn = q(r, '.b-min').value, mx = q(r, '.b-max').value, st = q(r, '.b-step').value;
        if (mn !== '') p.min = parseFloat(mn);
        if (mx !== '') p.max = parseFloat(mx);
        if (st !== '') p.step = parseFloat(st);
      }
      if (type === 'select') {
        var raw = q(r, '.b-opts-input').value.split(','), clean = [];
        for (var j = 0; j < raw.length; j++) { var o = raw[j].trim(); if (o) clean.push(o); }
        p.options = clean;
      }
      p['default'] = q(r, '.builder-default').value;
      out.push(p);
    }
    return out;
  }

  return {
    renderRunForm: renderRunForm,
    renderBuilder: renderBuilder,
    addBuilderRow: addBuilderRow,
    readBuilder: readBuilder
  };
}());
