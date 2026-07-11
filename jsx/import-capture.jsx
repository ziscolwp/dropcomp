// DropComp import-and-capture module (ExtendScript, ES3 only)
// Loaded by hostscript.jsx loadHostModules() via $.evalFile. evalFile runs in
// the caller's LOCAL scope, so every public function must be exported to
// $.global explicitly or it is undefined at call time.
// Uses hostscript globals: jerr, jsonEscape, readJson, writeJson, safeNameJsx,
// isReservedCategory, removeFolderRecursive, updateIndexAddComp,
// updateIndexPatchComp, collectComps, pickMainComp, compInfo, waitForFile,
// saveVerifiedThumb, aeProjectFilesIn, aeProjectExt.
// Uses aep-compat globals directly (no ensureHostModules guard needed:
// aep-compat.jsx loads BEFORE this file in DC_MODULE_FILES, so if these
// functions exist, aepPreflight does too): aepPreflight, aepImportFailureMessage.

// ---------- silent import-and-capture engine ----------
// The version verdict is ADVISORY: AE itself stays the arbiter of what it can
// open (a file down-saved for an older AE still carries the newer app's save
// stamp in its XMP, so hard-blocking on 'newer' would reject valid files).
// The preflight fails fast only on definitive junk (missing / not a RIFX
// project) and otherwise explains the failure when AE refuses the import.
// importFailed:true means this AE cannot import the project at all - callers
// use it to clean up, vs. recoverable capture issues (bad thumbnail).
function captureCompInfo(aepPath, targetPngPath, preferredName, preflight) {
    var importedFolder = null;
    var suppressing = false;
    var undoing = false;
    var pf = preflight;
    try {
        if (!app.project) return { ok: false, error: 'Open a project first.' };
        var f = new File(aepPath);
        if (!f.exists) return { ok: false, error: 'AEP not found: ' + aepPath, importFailed: true };
        if (!pf) pf = aepPreflight(f.fsName);
        if (pf.reason === 'missing' || pf.reason === 'not-aep') {
            return { ok: false, error: pf.message, importFailed: true };
        }
        app.beginSuppressDialogs();
        suppressing = true;
        // AE project import can corrupt the undo stack inside an explicit
        // group (the "Undo group mismatch" warning) - import first, then
        // group DropComp's cleanup edits. Mirrors importComp.
        importedFolder = app.project.importFile(new ImportOptions(f));
        app.beginUndoGroup('DropComp Capture');
        undoing = true;
        var comps = [];
        collectComps(importedFolder, comps);
        var main = pickMainComp(comps, preferredName);
        if (!main) {
            importedFolder.remove();
            app.endUndoGroup();
            app.endSuppressDialogs(false);
            return { ok: false, error: 'No composition found in this project.' };
        }
        var info = compInfo(main);
        info.ok = true;
        info.thumbOk = targetPngPath ? saveVerifiedThumb(main, new File(targetPngPath)) : false;
        importedFolder.remove();
        importedFolder = null;
        app.endUndoGroup();
        app.endSuppressDialogs(false);
        return info;
    } catch (e) {
        // importedFolder still null means app.project.importFile itself threw
        var importFailed = importedFolder === null;
        try { if (importedFolder) importedFolder.remove(); } catch (e2) { }
        try { if (undoing) app.endUndoGroup(); } catch (e3) { }
        try { if (suppressing) app.endSuppressDialogs(false); } catch (e4) { }
        return { ok: false, error: aepImportFailureMessage(aepPath, e.toString(), pf), importFailed: importFailed };
    }
}

function pickAepFile() {
    var f = File.openDialog('Select an After Effects project (.aep) or template (.aet)');
    if (!f) return '{"ok":false,"cancelled":true}';
    if (!/\.(aep|aet)$/i.test(f.name)) return jerr('Please choose an .aep or .aet file.');
    return '{"ok":true,"path":"' + jsonEscape(f.fsName) + '"}';
}

function addExternalAep(libraryPath, categoryName, sourceAepPath) {
    try {
        if (isReservedCategory(categoryName)) return jerr('"Assets" is reserved for the Assets tab.');
        var src = new File(sourceAepPath);
        if (!src.exists) return jerr('Source file not found.');
        // preflight BEFORE copying so definitive junk leaves no trace; the
        // result is passed down so the file is only scanned once per add
        var pf = aepPreflight(src.fsName);
        if (pf.reason === 'missing' || pf.reason === 'not-aep') return jerr(pf.message);
        var displayName = decodeURI(src.name).replace(/\.(aep|aet)$/i, '');
        var safe = safeNameJsx(displayName);
        var catFolder = new Folder(libraryPath + '/' + categoryName);
        if (!catFolder.exists) catFolder.create();
        var ts = new Date().getTime();
        var folderName = safe + '_' + ts;
        var compFolder = new Folder(catFolder.fsName + '/' + folderName);
        if (!compFolder.create()) return jerr('Could not create the library folder.');
        var destAep = new File(compFolder.fsName + '/' + safe + aeProjectExt(src.name));
        if (!src.copy(destAep)) {
            compFolder.remove();
            return jerr('Could not copy the project into the library.');
        }
        var thumbPath = compFolder.fsName + '/comp.png';
        var info = captureCompInfo(destAep.fsName, thumbPath, displayName, pf);
        if (!info.ok && info.importFailed) {
            // this AE cannot import the project at all - a library item would
            // be junk, so leave no trace and surface the (version-aware) error
            removeFolderRecursive(compFolder);
            return jerr(info.error);
        }
        writeJson(new File(compFolder.fsName + '/metadata.json'), {
            displayName: displayName,
            mainCompId: null,
            mainCompName: info.ok ? info.compName : null,
            width: info.ok ? info.width : null,
            height: info.ok ? info.height : null,
            duration: info.ok ? info.duration : null,
            frameRate: info.ok ? info.frameRate : null,
            addedAt: ts,
            source: 'external'
        });
        var thumbFile = new File(thumbPath);
        updateIndexAddComp(libraryPath, {
            name: displayName,
            category: categoryName,
            uniqueId: folderName,
            aepPath: destAep.fsName,
            thumbPath: thumbFile.exists ? thumbFile.fsName : null,
            mainCompId: null,
            width: info.ok ? info.width : null,
            height: info.ok ? info.height : null,
            duration: info.ok ? info.duration : null,
            frameRate: info.ok ? info.frameRate : null,
            addedAt: ts
        });
        // capture can fail for recoverable reasons (thumb can be regenerated
        // later) - keep the item but tell the panel why it looks incomplete
        return '{"ok":true,"name":"' + jsonEscape(displayName) + '","thumbOk":' +
            ((info.ok && info.thumbOk) ? 'true' : 'false') +
            (info.ok ? '' : ',"warning":"' + jsonEscape(info.error) + '"') + '}';
    } catch (e) {
        return jerr(e.toString());
    }
}

function generateThumbForItem(libraryPath, category, uniqueId) {
    try {
        var compFolder = new Folder(libraryPath + '/' + category + '/' + uniqueId);
        if (!compFolder.exists) return jerr('Item folder not found.');
        var aeps = aeProjectFilesIn(compFolder);
        if (aeps.length === 0) return jerr('No project file (.aep/.aet) found in this item.');
        var metaFile = new File(compFolder.fsName + '/metadata.json');
        var meta = readJson(metaFile) || {};
        var preferred = meta.mainCompName || meta.displayName || null;
        var thumbPath = compFolder.fsName + '/comp.png';
        var info = captureCompInfo(aeps[0].fsName, thumbPath, preferred);
        if (!info.ok) return jerr(info.error);
        meta.mainCompName = info.compName;
        meta.width = info.width;
        meta.height = info.height;
        meta.duration = info.duration;
        meta.frameRate = info.frameRate;
        if (!meta.addedAt) {
            var m = /_(\d{10,})$/.exec(uniqueId);
            if (m) meta.addedAt = parseInt(m[1], 10);
        }
        writeJson(metaFile, meta);
        var thumbFile = new File(thumbPath);
        updateIndexPatchComp(libraryPath, category, uniqueId, {
            thumbPath: thumbFile.exists ? thumbFile.fsName : null,
            width: info.width,
            height: info.height,
            duration: info.duration,
            frameRate: info.frameRate
        });
        return '{"ok":true,"thumbOk":' + (info.thumbOk ? 'true' : 'false') + '}';
    } catch (e) {
        return jerr(e.toString());
    }
}

function setThumbFromActiveComp(libraryPath, category, uniqueId) {
    try {
        var comp = app.project ? app.project.activeItem : null;
        if (!comp || !(comp instanceof CompItem)) {
            return jerr('Open a composition in the viewer first.');
        }
        var compFolder = new Folder(libraryPath + '/' + category + '/' + uniqueId);
        if (!compFolder.exists) return jerr('Item folder not found.');
        var png = new File(compFolder.fsName + '/comp.png');
        if (png.exists) png.remove();
        comp.saveFrameToPng(comp.time, png);
        if (!waitForFile(png, 2500, 1)) return jerr('Could not save the frame.');
        var metaFile = new File(compFolder.fsName + '/metadata.json');
        var meta = readJson(metaFile) || {};
        meta.width = comp.width;
        meta.height = comp.height;
        meta.duration = comp.duration;
        meta.frameRate = comp.frameRate;
        writeJson(metaFile, meta);
        updateIndexPatchComp(libraryPath, category, uniqueId, {
            thumbPath: png.fsName,
            width: comp.width,
            height: comp.height,
            duration: comp.duration,
            frameRate: comp.frameRate
        });
        return '{"ok":true}';
    } catch (e) {
        return jerr(e.toString());
    }
}

// ---- exports (see header comment) ----
$.global.captureCompInfo = captureCompInfo;
$.global.pickAepFile = pickAepFile;
$.global.addExternalAep = addExternalAep;
$.global.generateThumbForItem = generateThumbForItem;
$.global.setThumbFromActiveComp = setThumbFromActiveComp;
