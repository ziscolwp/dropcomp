// DropComp shape-assets module (ExtendScript, ES3 only)
// Loaded by hostscript.jsx loadHostModules() via $.evalFile. evalFile runs in
// the caller's LOCAL scope, so every public function must be exported to
// $.global explicitly or it is undefined at call time.
// Uses hostscript globals: jerr, jsonEscape, safeNameJsx, collectComps,
// saveVerifiedThumb. Uses assets.jsx globals (loads before this file):
// assetEntryFromFile, loadAssetsIndex, saveAssetsIndex, uniqueAssetTarget,
// shapeThumbSidecarName. Uses aep-compat globals: aepPreflight.

// Shape and text layers fail "instanceof AVLayer" checks in ExtendScript -
// matchName is the reliable discriminator.
function isShapeLayer(layer) {
    return !!layer && layer.matchName === 'ADBE Vector Layer';
}

function selectedShapeLayers(comp) {
    var out = [];
    var sel = comp.selectedLayers;
    for (var i = 0; i < sel.length; i++) {
        if (isShapeLayer(sel[i])) out.push(sel[i]);
    }
    return out;
}

// Fast pre-modal validation so the user sees a specific error before picking
// a category. JSON protocol.
function getShapeSelectionInfo() {
    try {
        if (!app.project) return jerr('Please open a project first.');
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return jerr('Select shape layers in an open composition first.');
        }
        var shapes = selectedShapeLayers(comp);
        if (!shapes.length) return jerr('Select one or more shape layers first.');
        if (!app.project.file) return jerr('Save your project once before saving shapes.');
        return '{"ok":true,"count":' + shapes.length +
            ',"skipped":' + (comp.selectedLayers.length - shapes.length) +
            ',"name":"' + jsonEscape(shapes[0].name) + '"}';
    } catch (e) {
        return jerr(e.toString());
    }
}

// ---- exports (see header comment) ----
$.global.isShapeLayer = isShapeLayer;
$.global.selectedShapeLayers = selectedShapeLayers;
$.global.getShapeSelectionInfo = getShapeSelectionInfo;
