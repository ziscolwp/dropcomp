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
