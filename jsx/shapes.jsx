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

// Captures the selected shape layers into a self-contained .aep in
// Assets/<category>/ plus a PNG thumbnail sidecar. Rides the Library stash
// dance: save -> save-as-temp -> copy layers into a throwaway comp ->
// reduceProject -> save -> copy out -> reopen the original (in finally).
function addShapeFromSelection(libraryPath, categoryName) {
    var originalProjectFile = app.project ? app.project.file : null;
    var tempAEP = null;
    var movedAway = false;
    var undoing = false;
    var sidecarFile = null;
    var wrote = false;
    try {
        if (!app.project) return jerr('Please open a project first.');
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return jerr('Select shape layers in an open composition first.');
        }
        if (!originalProjectFile) return jerr('Save your project once before saving shapes.');
        var shapes = selectedShapeLayers(comp);
        if (!shapes.length) return jerr('Select one or more shape layers first.');
        var skipped = comp.selectedLayers.length - shapes.length;
        var displayName = shapes[0].name;
        var srcCompId = comp.id;

        // record indices now: layer objects may not survive the save dance,
        // but indices are stable while the project stays open
        var indices = [];
        for (var i = 0; i < shapes.length; i++) indices.push(shapes[i].index);
        indices.sort(function (a, b) { return a - b; });

        var root = new Folder(libraryPath + '/Assets');
        if (!root.exists && !root.create()) return jerr('Could not create the Assets folder.');
        var catFolder = new Folder(root.fsName + '/' + categoryName);
        if (!catFolder.exists && !catFolder.create()) return jerr('Could not create the category folder.');

        var finalAep = uniqueAssetTarget(catFolder, safeNameJsx(displayName) + '.aep');
        if (!finalAep) return jerr('Could not find a free file name.');
        var finalAepName = decodeURI(finalAep.name);

        // The finally block reopens originalProjectFile from disk, so any
        // edits made since the user's last manual save must be persisted first.
        app.project.save();

        var ts = new Date().getTime();
        app.beginUndoGroup('DropComp Save Shape');
        undoing = true;
        tempAEP = new File(Folder.temp.fsName + '/dropcomp_shape_' + ts + '.aep');
        app.project.save(tempAEP);
        movedAway = true;

        var srcComp = null;
        for (var k = 1; k <= app.project.numItems; k++) {
            if (app.project.item(k).id === srcCompId) { srcComp = app.project.item(k); break; }
        }
        if (!srcComp) throw new Error('Could not find the composition in the temp project.');

        var shapeComp = app.project.items.addComp(displayName, srcComp.width, srcComp.height,
            srcComp.pixelAspect, 1, srcComp.frameRate);
        // copyToComp inserts at the TOP: copy bottom-most first (highest index)
        // so the original stacking order survives
        for (i = indices.length - 1; i >= 0; i--) {
            srcComp.layer(indices[i]).copyToComp(shapeComp);
        }
        // rebase so the earliest layer starts at 0 (import shifts to playhead)
        var minStart = null;
        var maxOut = 1;
        for (i = 1; i <= shapeComp.numLayers; i++) {
            var st = shapeComp.layer(i).startTime;
            if (minStart === null || st < minStart) minStart = st;
        }
        for (i = 1; i <= shapeComp.numLayers; i++) {
            var ly = shapeComp.layer(i);
            // setting startTime DRAGS the layer: outPoint shifts with it, so
            // the post-shift outPoint is already in rebased time
            ly.startTime = ly.startTime - minStart;
            if (ly.outPoint > maxOut) maxOut = ly.outPoint;
        }
        shapeComp.duration = maxOut;

        sidecarFile = new File(catFolder.fsName + '/' + shapeThumbSidecarName(finalAepName));
        var thumbOk = saveVerifiedThumb(shapeComp, sidecarFile);

        app.project.reduceProject([shapeComp]);
        app.project.save(tempAEP);
        if (!tempAEP.copy(finalAep)) {
            throw new Error('Could not copy the shape project into the library.');
        }
        app.endUndoGroup();
        undoing = false;
        wrote = true;

        var assets = loadAssetsIndex(libraryPath) || [];
        var entry = assetEntryFromFile(categoryName, new File(finalAep.fsName));
        if (entry) {
            entry.addedAt = ts;
            // drop any stale index entry with this id (file was deleted on disk)
            for (var x = assets.length - 1; x >= 0; x--) {
                if (assets[x].uniqueId === entry.uniqueId) assets.splice(x, 1);
            }
            assets.push(entry);
        }
        saveAssetsIndex(libraryPath, assets);

        return '{"ok":true,"name":"' + jsonEscape(displayName) + '","count":' + shapes.length +
            ',"skipped":' + skipped + ',"thumbOk":' + (thumbOk ? 'true' : 'false') + '}';
    } catch (e) {
        try { if (undoing) app.endUndoGroup(); } catch (e2) { }
        // a failed capture must not leave an orphan sidecar behind
        try { if (!wrote && sidecarFile && sidecarFile.exists) sidecarFile.remove(); } catch (e3) { }
        return jerr(e.toString());
    } finally {
        if (movedAway && originalProjectFile && originalProjectFile.exists) {
            app.open(originalProjectFile);
        }
        if (tempAEP && tempAEP.exists) tempAEP.remove();
    }
}

// Pastes a saved shape asset's layers into the active comp as editable shape
// layers, then removes the imported project items (shape layers carry no
// external footage, so removal is safe). Text protocol mirrors importAsset.
function importShapeAsset(filePath) {
    var suppressing = false;
    var undoing = false;
    var importedFolder = null;
    try {
        if (!app.project) return 'Error: Please open a project first.';
        var activeComp = app.project.activeItem;
        if (!activeComp || !(activeComp instanceof CompItem)) {
            return 'Error: Open a composition first to import a shape.';
        }
        var f = new File(filePath);
        if (!f.exists) return 'Error: Asset file not found.';
        // advisory preflight: block definitive junk, explain version mismatches
        var pf = aepPreflight(f.fsName);
        if (pf.reason === 'missing' || pf.reason === 'not-aep') return 'Error: ' + pf.message;

        app.beginSuppressDialogs();
        suppressing = true;
        // AE project import can corrupt the undo stack inside an explicit
        // group - import first, then group DropComp's edits (mirrors importComp)
        importedFolder = app.project.importFile(new ImportOptions(f));
        app.beginUndoGroup('DropComp Import Shape');
        undoing = true;

        var comps = [];
        collectComps(importedFolder, comps);
        var srcComp = comps.length ? comps[0] : null;
        var copied = 0;
        var skipped = 0;
        if (srcComp) {
            // copyToComp inserts at the TOP: walk bottom-up so stacking survives
            for (var i = srcComp.numLayers; i >= 1; i--) {
                if (isShapeLayer(srcComp.layer(i))) {
                    srcComp.layer(i).copyToComp(activeComp);
                    copied++;
                } else {
                    skipped++;
                }
            }
        }
        if (!copied) {
            importedFolder.remove();
            importedFolder = null;
            app.endUndoGroup();
            undoing = false;
            app.endSuppressDialogs(false);
            suppressing = false;
            return 'Error: No shape layers found in this asset.';
        }

        // the copied layers occupy indices 1..copied (each insert lands on top)
        var minStart = null;
        for (i = 1; i <= copied; i++) {
            var st = activeComp.layer(i).startTime;
            if (minStart === null || st < minStart) minStart = st;
        }
        var shift = activeComp.time - minStart;
        for (i = 1; i <= copied; i++) {
            activeComp.layer(i).startTime = activeComp.layer(i).startTime + shift;
        }
        for (i = 1; i <= activeComp.numLayers; i++) {
            activeComp.layer(i).selected = (i <= copied);
        }

        importedFolder.remove();
        importedFolder = null;
        app.endUndoGroup();
        undoing = false;
        app.endSuppressDialogs(false);
        suppressing = false;

        var assetName = decodeURI(f.name).replace(/\.aep$/i, '');
        return "Success: '" + assetName + "' added to '" + activeComp.name + "'." +
            (skipped ? ' Skipped ' + skipped + ' non-shape layer' + (skipped === 1 ? '' : 's') + '.' : '');
    } catch (e) {
        try { if (importedFolder) importedFolder.remove(); } catch (e2) { }
        try { if (undoing) app.endUndoGroup(); } catch (e3) { }
        try { if (suppressing) app.endSuppressDialogs(false); } catch (e4) { }
        return 'Error: ' + e.toString();
    }
}

// ---- exports (see header comment) ----
$.global.isShapeLayer = isShapeLayer;
$.global.selectedShapeLayers = selectedShapeLayers;
$.global.getShapeSelectionInfo = getShapeSelectionInfo;
$.global.addShapeFromSelection = addShapeFromSelection;
$.global.importShapeAsset = importShapeAsset;
