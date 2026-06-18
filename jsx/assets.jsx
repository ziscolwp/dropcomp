// DropComp assets module (ExtendScript, ES3 only)
// Loaded by hostscript.jsx loadHostModules() via $.evalFile. evalFile runs in
// the caller's LOCAL scope, so every public function must be exported to
// $.global explicitly or it is undefined at call time.
// Uses hostscript globals: readJson, writeJson, jerr, jsonEscape.

var DC_ASSET_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, tif: 1, tiff: 1, tga: 1, psd: 1, ai: 1, eps: 1, svg: 1 };

function assetExt(fileName) {
    var m = /\.([a-z0-9]+)$/i.exec(String(fileName));
    return m ? m[1].toLowerCase() : '';
}

function isSupportedAsset(fileName) {
    return DC_ASSET_EXTS[assetExt(fileName)] === 1;
}

function assetsRoot(libraryPath) {
    return new Folder(libraryPath + '/Assets');
}

function getAssetsIndexFile(libraryPath) {
    return new File(libraryPath + '/Assets/.dropcomp_assets_index.json');
}

function assetEntryFromFile(categoryName, file) {
    var fileName = decodeURI(file.name);
    if (fileName.charAt(0) === '.') return null;
    if (!isSupportedAsset(fileName)) return null;
    return {
        name: fileName.replace(/\.[a-z0-9]+$/i, ''),
        category: categoryName,
        uniqueId: categoryName + '/' + fileName,
        filePath: file.fsName,
        ext: assetExt(fileName),
        sizeBytes: file.length,
        addedAt: file.modified ? file.modified.getTime() : 0
    };
}

function loadAssetsIndex(libraryPath) {
    var idx = readJson(getAssetsIndexFile(libraryPath));
    return (idx && idx.version === 1 && idx.assets) ? idx.assets : null;
}

function saveAssetsIndex(libraryPath, assets) {
    return writeJson(getAssetsIndexFile(libraryPath), {
        version: 1,
        lastUpdated: new Date().getTime(),
        assets: assets
    });
}

function rebuildAssetsIndex(libraryPath) {
    var root = assetsRoot(libraryPath);
    if (!root.exists) return '[]';
    var assets = [];
    var isFolder = function (f) { return f instanceof Folder; };
    var cats = root.getFiles(isFolder);
    for (var i = 0; i < cats.length; i++) {
        var files = cats[i].getFiles();
        for (var j = 0; j < files.length; j++) {
            if (!(files[j] instanceof File)) continue;
            var entry = assetEntryFromFile(decodeURI(cats[i].name), files[j]);
            if (entry) assets.push(entry);
        }
    }
    saveAssetsIndex(libraryPath, assets);
    return JSON.stringify(assets);
}

function getAssets(libraryPath) {
    if (!assetsRoot(libraryPath).exists) return '[]';
    var assets = loadAssetsIndex(libraryPath);
    if (assets) return JSON.stringify(assets);
    return rebuildAssetsIndex(libraryPath);
}

function pickAssetFiles() {
    var files = File.openDialog('Select image or vector files', undefined, true);
    if (!files) return '{"ok":false,"cancelled":true}';
    if (!(files instanceof Array)) files = [files];
    var out = [];
    for (var i = 0; i < files.length; i++) {
        out.push('"' + jsonEscape(files[i].fsName) + '"');
    }
    return '{"ok":true,"paths":[' + out.join(',') + ']}';
}

function uniqueAssetTarget(catFolder, fileName) {
    var target = new File(catFolder.fsName + '/' + fileName);
    if (!target.exists) return target;
    var m = /^(.*?)(\.[a-z0-9]+)$/i.exec(fileName);
    var base = m ? m[1] : fileName;
    var ext = m ? m[2] : '';
    for (var n = 2; n < 1000; n++) {
        target = new File(catFolder.fsName + '/' + base + '_' + n + ext);
        if (!target.exists) return target;
    }
    return null;
}

function addAssetFiles(libraryPath, categoryName, pathsJson) {
    try {
        var paths = null;
        try { paths = JSON.parse(pathsJson); } catch (ep) { return jerr('Bad file list.'); }
        if (!paths || !paths.length) return jerr('No files selected.');
        var root = assetsRoot(libraryPath);
        if (!root.exists && !root.create()) return jerr('Could not create the Assets folder.');
        var catFolder = new Folder(root.fsName + '/' + categoryName);
        if (!catFolder.exists && !catFolder.create()) return jerr('Could not create the category folder.');

        var assets = loadAssetsIndex(libraryPath) || [];
        var added = 0;
        var skipped = [];
        var now = new Date().getTime();
        for (var i = 0; i < paths.length; i++) {
            var src = new File(paths[i]);
            var srcName = decodeURI(src.name);
            // dot-files would be copied but never indexed (assetEntryFromFile skips them)
            if (!src.exists || srcName.charAt(0) === '.' || !isSupportedAsset(srcName)) {
                skipped.push(srcName);
                continue;
            }
            var target = uniqueAssetTarget(catFolder, srcName);
            if (!target || !src.copy(target)) { skipped.push(srcName); continue; }
            var entry = assetEntryFromFile(categoryName, new File(target.fsName));
            if (entry) {
                entry.addedAt = now;
                // drop any stale index entry with this id (file was deleted on disk)
                for (var x = assets.length - 1; x >= 0; x--) {
                    if (assets[x].uniqueId === entry.uniqueId) assets.splice(x, 1);
                }
                assets.push(entry);
                added++;
            }
        }
        saveAssetsIndex(libraryPath, assets);
        var skippedJson = [];
        for (var s = 0; s < skipped.length; s++) {
            skippedJson.push('"' + jsonEscape(skipped[s]) + '"');
        }
        return '{"ok":true,"added":' + added + ',"skipped":[' + skippedJson.join(',') + ']}';
    } catch (e) {
        return jerr(e.toString());
    }
}

function renameAsset(libraryPath, category, fileName, newName) {
    try {
        // re-check the name host-side (mirrors panel DCValidate; ES3 - no trim())
        newName = String(newName).replace(/^\s+|\s+$/g, '');
        if (!newName) return jerr('Name cannot be empty.');
        if (newName.length > 200) return jerr('Name is too long (max 200 characters).');
        if (/[<>:"\/\\|?*\x00-\x1F]/.test(newName)) return jerr('Name contains invalid characters (< > : " / \\ | ? *).');
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(newName)) return jerr('Name uses a reserved system name.');

        var catFolder = new Folder(libraryPath + '/Assets/' + category);
        var file = new File(catFolder.fsName + '/' + fileName);
        if (!file.exists) return jerr('Asset not found on disk.');
        var ext = assetExt(fileName);
        var newFileName = newName + (ext ? '.' + ext : '');
        if (newFileName !== fileName) {
            if (new File(catFolder.fsName + '/' + newFileName).exists) {
                return jerr('An asset with that name already exists in this category.');
            }
            if (!file.rename(newFileName)) return jerr('Could not rename the file on disk.');
        }
        var assets = loadAssetsIndex(libraryPath) || [];
        var oldId = category + '/' + fileName;
        var patched = false;
        for (var i = 0; i < assets.length; i++) {
            if (assets[i].uniqueId === oldId) {
                assets[i].name = newName;
                assets[i].uniqueId = category + '/' + newFileName;
                assets[i].filePath = new File(catFolder.fsName + '/' + newFileName).fsName;
                patched = true;
                break;
            }
        }
        if (patched) saveAssetsIndex(libraryPath, assets);
        else rebuildAssetsIndex(libraryPath);
        return '{"ok":true,"newUniqueId":"' + jsonEscape(category + '/' + newFileName) + '"}';
    } catch (e) {
        return jerr(e.toString());
    }
}

function deleteAsset(libraryPath, category, fileName) {
    try {
        var file = new File(libraryPath + '/Assets/' + category + '/' + fileName);
        // file already gone: still drop the index entry so the ghost card disappears
        if (file.exists && !file.remove()) return jerr('Could not delete the file.');
        var assets = loadAssetsIndex(libraryPath) || [];
        var out = [];
        var id = category + '/' + fileName;
        for (var i = 0; i < assets.length; i++) {
            if (assets[i].uniqueId !== id) out.push(assets[i]);
        }
        saveAssetsIndex(libraryPath, out);
        return '{"ok":true}';
    } catch (e) {
        return jerr(e.toString());
    }
}

function findProjectFootageByPath(fsPath) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FootageItem && item.mainSource && item.mainSource.file &&
            item.mainSource.file.fsName === fsPath) {
            return item;
        }
    }
    return null;
}

function findOrCreateAssetsBin() {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FolderItem && item.name === 'Assets [DropComp]') return item;
    }
    return app.project.items.addFolder('Assets [DropComp]');
}

// Text protocol (Success:/Error:) to mirror importComp exactly.
function importAsset(filePath) {
    var suppressing = false;
    try {
        if (!app.project) return 'Error: Please open a project first.';
        var file = new File(filePath);
        if (!file.exists) return 'Error: Asset file not found.';
        var assetName = decodeURI(file.name);

        app.beginSuppressDialogs();
        suppressing = true;
        app.beginUndoGroup('DropComp Import Asset');

        var footage = findProjectFootageByPath(file.fsName);
        var reused = footage !== null;
        if (!footage) {
            var io = new ImportOptions(file);
            if (io.canImportAs(ImportAsType.FOOTAGE)) io.importAs = ImportAsType.FOOTAGE;
            footage = app.project.importFile(io);
            footage.parentFolder = findOrCreateAssetsBin();
        }

        var addedToTimeline = false;
        var activeComp = app.project.activeItem;
        if (activeComp && activeComp instanceof CompItem) {
            try {
                var newLayer = activeComp.layers.add(footage);
                newLayer.startTime = activeComp.time;
                newLayer.selected = true;
                for (var k = 1; k <= activeComp.numLayers; k++) {
                    if (activeComp.layer(k) !== newLayer) activeComp.layer(k).selected = false;
                }
                addedToTimeline = true;
            } catch (eL) {
                addedToTimeline = false;
            }
        }
        app.endUndoGroup();
        app.endSuppressDialogs(false);
        return "Success: '" + assetName + "' " + (reused ? 'reused' : 'imported') +
            (addedToTimeline ? ' and added to timeline.' : '.');
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) { }
        try { if (suppressing) app.endSuppressDialogs(false); } catch (e3) { }
        return 'Error: ' + e.toString();
    }
}

// ---- exports (see header comment) ----
$.global.assetExt = assetExt;
$.global.isSupportedAsset = isSupportedAsset;
$.global.assetsRoot = assetsRoot;
$.global.getAssetsIndexFile = getAssetsIndexFile;
$.global.assetEntryFromFile = assetEntryFromFile;
$.global.loadAssetsIndex = loadAssetsIndex;
$.global.saveAssetsIndex = saveAssetsIndex;
$.global.rebuildAssetsIndex = rebuildAssetsIndex;
$.global.getAssets = getAssets;
$.global.pickAssetFiles = pickAssetFiles;
$.global.uniqueAssetTarget = uniqueAssetTarget;
$.global.addAssetFiles = addAssetFiles;
$.global.renameAsset = renameAsset;
$.global.deleteAsset = deleteAsset;
$.global.findProjectFootageByPath = findProjectFootageByPath;
$.global.findOrCreateAssetsBin = findOrCreateAssetsBin;
$.global.importAsset = importAsset;
