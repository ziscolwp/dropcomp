// DropComp Tools host module (ExtendScript, ES3 only). Loaded by
// loadHostModules in hostscript.jsx; every function exports to $.global.
// Reuses jerr() and jsonEscape() defined in hostscript.jsx (host-global).

function tlActiveComp() {
    var c = app.project ? app.project.activeItem : null;
    return (c && c instanceof CompItem) ? c : null;
}
$.global.tlActiveComp = tlActiveComp;

function tlSelectOnly(comp, layer) {
    for (var i = 1; i <= comp.numLayers; i++) {
        comp.layer(i).selected = (comp.layer(i) === layer);
    }
}
$.global.tlSelectOnly = tlSelectOnly;

function tlCreateLayer(kind) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    try {
        app.beginUndoGroup('DropComp Create Layer');
        var layer = null;
        if (kind === 'null') {
            layer = comp.layers.addNull();
        } else if (kind === 'adjustment') {
            // white solid matches AE's native adjustment layer; the color is invisible while adjustmentLayer is true
            layer = comp.layers.addSolid([1, 1, 1], 'Adjustment Layer', comp.width, comp.height, comp.pixelAspect);
            layer.adjustmentLayer = true;
        } else if (kind === 'solid') {
            layer = comp.layers.addSolid([0.5, 0.5, 0.5], 'Solid', comp.width, comp.height, comp.pixelAspect);
        } else if (kind === 'camera') {
            layer = comp.layers.addCamera('Camera 1', [comp.width / 2, comp.height / 2]);
        } else {
            app.endUndoGroup();
            return jerr('Unknown layer type.');
        }
        layer.startTime = comp.time;
        tlSelectOnly(comp, layer);
        app.endUndoGroup();
        return '{"ok":true,"name":"' + jsonEscape(layer.name) + '"}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlCreateLayer = tlCreateLayer;

function tlSetAnchor(fxStr, fyStr) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    var fx = parseFloat(fxStr), fy = parseFloat(fyStr);
    if (isNaN(fx) || isNaN(fy)) return jerr('Bad anchor position.');
    try {
        app.beginUndoGroup('DropComp Set Anchor');
        var count = 0;
        for (var i = 0; i < sel.length; i++) {
            var layer = sel[i];
            if (!(layer instanceof AVLayer)) continue;
            try {
                var rect = layer.sourceRectAtTime(comp.time, false);
                var t = layer.property('ADBE Transform Group');
                var anchorProp = t.property('ADBE Anchor Point');
                var posProp = t.property('ADBE Position');
                var scale = t.property('ADBE Scale').value;
                var oldA = anchorProp.value;
                var newAX = rect.left + rect.width * fx;
                var newAY = rect.top + rect.height * fy;
                var dx = (newAX - oldA[0]) * (scale[0] / 100);
                var dy = (newAY - oldA[1]) * (scale[1] / 100);
                if (oldA.length === 3) anchorProp.setValue([newAX, newAY, oldA[2]]);
                else anchorProp.setValue([newAX, newAY]);
                var pos = posProp.value;
                if (pos.length === 3) posProp.setValue([pos[0] + dx, pos[1] + dy, pos[2]]);
                else posProp.setValue([pos[0] + dx, pos[1] + dy]);
                count++;
            } catch (eL) {}
        }
        app.endUndoGroup();
        if (count === 0) return jerr('Select a footage, shape, text, or solid layer.');
        return '{"ok":true,"count":' + count + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlSetAnchor = tlSetAnchor;

// On-screen bounding box ignoring rotation (common 2D case is exact).
function tlLayerBounds(comp, layer) {
    var rect = layer.sourceRectAtTime(comp.time, false);
    var t = layer.property('ADBE Transform Group');
    var pos = t.property('ADBE Position').value;
    var anc = t.property('ADBE Anchor Point').value;
    var scale = t.property('ADBE Scale').value;
    var sx = scale[0] / 100, sy = scale[1] / 100;
    var left = pos[0] + (rect.left - anc[0]) * sx;
    var top = pos[1] + (rect.top - anc[1]) * sy;
    var w = rect.width * sx, h = rect.height * sy;
    return { left: left, top: top, right: left + w, bottom: top + h, w: w, h: h };
}
$.global.tlLayerBounds = tlLayerBounds;

function tlShift(layer, dx, dy) {
    var posProp = layer.property('ADBE Transform Group').property('ADBE Position');
    var pos = posProp.value;
    if (pos.length === 3) posProp.setValue([pos[0] + dx, pos[1] + dy, pos[2]]);
    else posProp.setValue([pos[0] + dx, pos[1] + dy]);
}
$.global.tlShift = tlShift;

function tlAlign(mode) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Align');
        var ref;
        if (sel.length >= 2) {
            ref = { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 };
            for (var a = 0; a < sel.length; a++) {
                if (!(sel[a] instanceof AVLayer)) continue;
                var ba = tlLayerBounds(comp, sel[a]);
                if (ba.left < ref.left) ref.left = ba.left;
                if (ba.top < ref.top) ref.top = ba.top;
                if (ba.right > ref.right) ref.right = ba.right;
                if (ba.bottom > ref.bottom) ref.bottom = ba.bottom;
            }
        } else {
            ref = { left: 0, top: 0, right: comp.width, bottom: comp.height };
        }
        var count = 0;
        for (var i = 0; i < sel.length; i++) {
            if (!(sel[i] instanceof AVLayer)) continue;
            var b = tlLayerBounds(comp, sel[i]);
            var dx = 0, dy = 0;
            if (mode === 'left') dx = ref.left - b.left;
            else if (mode === 'right') dx = ref.right - b.right;
            else if (mode === 'center') dx = (ref.left + ref.right) / 2 - (b.left + b.right) / 2;
            else if (mode === 'top') dy = ref.top - b.top;
            else if (mode === 'bottom') dy = ref.bottom - b.bottom;
            else if (mode === 'middle') dy = (ref.top + ref.bottom) / 2 - (b.top + b.bottom) / 2;
            tlShift(sel[i], dx, dy);
            count++;
        }
        app.endUndoGroup();
        if (count === 0) return jerr('Select a layer that can be moved.');
        return '{"ok":true,"count":' + count + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlAlign = tlAlign;

function tlDistribute(axis) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length < 3) return jerr('Select 3 or more layers to distribute.');
    var horiz = (axis !== 'vertical');
    try {
        app.beginUndoGroup('DropComp Distribute');
        var items = [];
        for (var i = 0; i < sel.length; i++) {
            if (!(sel[i] instanceof AVLayer)) continue;
            var b = tlLayerBounds(comp, sel[i]);
            items.push({ layer: sel[i], c: horiz ? (b.left + b.right) / 2 : (b.top + b.bottom) / 2 });
        }
        if (items.length < 3) { app.endUndoGroup(); return jerr('Select 3 or more moveable layers.'); }
        items.sort(function (p, q) { return p.c - q.c; });
        var first = items[0].c, last = items[items.length - 1].c;
        var span = last - first;
        var n = items.length - 1;
        for (var k = 1; k < n; k++) {
            var target = first + span * (k / n);
            var d = target - items[k].c;
            if (horiz) tlShift(items[k].layer, d, 0);
            else tlShift(items[k].layer, 0, d);
        }
        app.endUndoGroup();
        return '{"ok":true,"count":' + items.length + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlDistribute = tlDistribute;

function tlReset() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Recenter');
        var count = 0;
        for (var i = 0; i < sel.length; i++) {
            if (!(sel[i] instanceof AVLayer)) continue;
            var b = tlLayerBounds(comp, sel[i]);
            tlShift(sel[i], comp.width / 2 - (b.left + b.right) / 2, comp.height / 2 - (b.top + b.bottom) / 2);
            count++;
        }
        app.endUndoGroup();
        if (count === 0) return jerr('Select a layer that can be moved.');
        return '{"ok":true,"count":' + count + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlReset = tlReset;

function tlSequence(numStr, stepFramesStr) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    var num = parseInt(numStr, 10);
    var step = parseInt(stepFramesStr, 10);
    if (isNaN(num) || isNaN(step)) return jerr('Num and Step must be whole numbers.');
    if (num < 1) num = 1;
    var fd = comp.frameDuration;
    try {
        app.beginUndoGroup('DropComp Sequence');
        if (sel.length >= 2) {
            var ordered = sel.slice(0);
            ordered.sort(function (a, b) { return a.index - b.index; });
            var base = ordered[0].startTime;
            for (var i = 0; i < ordered.length; i++) {
                ordered[i].startTime = base + i * step * fd;
            }
            app.endUndoGroup();
            return '{"ok":true,"count":' + ordered.length + '}';
        }
        var layer = sel[0];
        var b0 = layer.startTime;
        var made = 0;
        for (var k = 1; k <= num; k++) {
            var dup = layer.duplicate();
            dup.startTime = b0 + k * step * fd;
            made++;
        }
        app.endUndoGroup();
        return '{"ok":true,"count":' + made + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlSequence = tlSequence;

function tlPreComp() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Pre-compose');
        var idx = [];
        for (var i = 0; i < sel.length; i++) idx.push(sel[i].index);
        var name = sel[0].name + ' Comp';
        var newComp = comp.layers.precompose(idx, name, true);
        newComp.openInViewer();
        app.endUndoGroup();
        return '{"ok":true,"name":"' + jsonEscape(name) + '"}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlPreComp = tlPreComp;

function tlMultiPreComp() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Multi Pre-compose');
        var targets = [];
        for (var i = 0; i < sel.length; i++) targets.push({ index: sel[i].index, name: sel[i].name });
        var made = 0;
        for (var j = 0; j < targets.length; j++) {
            comp.layers.precompose([targets[j].index], targets[j].name + ' Comp', true);
            made++;
        }
        app.endUndoGroup();
        return '{"ok":true,"count":' + made + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlMultiPreComp = tlMultiPreComp;

function tlIndependent() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Make Independent');
        var count = 0;
        for (var i = 0; i < sel.length; i++) {
            var layer = sel[i];
            if (layer.source && layer.source instanceof CompItem) {
                try {
                    var dup = layer.source.duplicate();
                    layer.replaceSource(dup, false);
                    count++;
                } catch (eL) {}
            }
        }
        app.endUndoGroup();
        if (count === 0) return jerr('Select at least one precomp layer.');
        return '{"ok":true,"count":' + count + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlIndependent = tlIndependent;
