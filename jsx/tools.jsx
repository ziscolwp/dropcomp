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
