// DropComp 2.0 - relink module (loaded by hostscript.jsx via $.evalFile)
// missing-footage detection, filename matching, and project relinking (ES3)

// ---------- relink missing footage ----------
function relinkBaseName(p) {
    var s = String(p).replace(/\\/g, '/');
    return s.substring(s.lastIndexOf('/') + 1);
}

// URI-decode + lowercase so encoding/case differences never block a match
function relinkNormName(n) {
    var s = String(n);
    try { s = decodeURI(s); } catch (e) { }
    return s.toLowerCase();
}

// normalized filename -> full path map of every file under a root
// (library/category/item/(Footage) is depth 3; cap at 5 for safety)
function collectFilesRecursive(folder, map, depth) {
    if (depth > 5) return;
    var items = folder.getFiles();
    for (var i = 0; i < items.length; i++) {
        if (items[i] instanceof File) {
            var key = relinkNormName(items[i].name);
            if (!map[key]) map[key] = items[i].fsName;
        } else if (items[i] instanceof Folder) {
            collectFilesRecursive(items[i], map, depth + 1);
        }
    }
}

// missingFootagePath survives placeholder conversion; mainSource.file may not
function missingSourcePath(item) {
    var p = null;
    try { p = item.missingFootagePath; } catch (e) { }
    if (!p) {
        try {
            if (item.mainSource && item.mainSource.file) p = item.mainSource.file.fsName;
        } catch (e2) { }
    }
    return p;
}

function relinkItems(items, map) {
    var relinked = 0;
    var notFound = [];
    var healed = [];
    for (var i = 0; i < items.length; i++) {
        var srcPath = missingSourcePath(items[i]);
        var nm = srcPath ? relinkBaseName(srcPath) : String(items[i].name);
        var found = map[relinkNormName(nm)];
        if (!found) {
            notFound.push(nm);
            continue;
        }
        try {
            var isSequenceImage = items[i].mainSource &&
                items[i].mainSource.isStill === false &&
                /\.(png|jpe?g|tiff?|exr|dpx|tga)$/i.test(nm);
            if (isSequenceImage) {
                items[i].replaceWithSequence(new File(found), false);
            } else {
                items[i].replace(new File(found));
            }
            relinked++;
            healed.push(items[i]);
        } catch (e3) {
            notFound.push(nm);
        }
    }
    return { relinked: relinked, notFound: notFound, healed: healed };
}

// After a heal resolved files from outside this item's folder, copy them into
// the item's (Footage) folder and re-point the imported items at the copies.
// The library item becomes self-contained, so the next import heals instantly
// from the local folder scan instead of re-searching the whole library.
function absorbHealedFootage(healedItems, itemFolderPath) {
    var absorbed = 0;
    if (!healedItems.length) return 0;
    var footageFolder = new Folder(itemFolderPath + '/(Footage)');
    if (!footageFolder.exists && !footageFolder.create()) return 0;
    for (var i = 0; i < healedItems.length; i++) {
        try {
            var it = healedItems[i];
            if (!(it.mainSource && it.mainSource.file)) continue;
            var src = it.mainSource.file;
            var fp = src.fsName;
            if (fp.indexOf(itemFolderPath + '/') === 0 || fp.indexOf(itemFolderPath + '\\') === 0) continue;
            // image sequences are relinked in place only: copying one frame would break the sequence
            if (it.mainSource.isStill === false && /\.(png|jpe?g|tiff?|exr|dpx|tga)$/i.test(src.name)) continue;
            var dest = new File(footageFolder.fsName + '/' + src.name);
            if (!dest.exists && !src.copy(dest)) continue;
            it.replace(dest);
            absorbed++;
        } catch (e) { }
    }
    return absorbed;
}

// missing FootageItems inside one imported folder subtree
function collectMissingFootage(folderItem, out) {
    for (var i = 1; i <= folderItem.numItems; i++) {
        var it = folderItem.item(i);
        if (it instanceof FootageItem && it.footageMissing) out.push(it);
        else if (it instanceof FolderItem) collectMissingFootage(it, out);
    }
}

function relinkMissingFootage(libraryPath) {
    try {
        if (!app.project) return jerr('Open a project first.');
        var missing = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof FootageItem && item.footageMissing) {
                missing.push(item);
            }
        }
        if (missing.length === 0) {
            return JSON.stringify({ ok: true, missing: 0, relinked: 0, notFound: [] });
        }

        var map = {};
        var lib = new Folder(libraryPath);
        if (lib.exists) collectFilesRecursive(lib, map, 0);
        if (app.project.file && app.project.file.parent) {
            collectFilesRecursive(app.project.file.parent, map, 0);
        }

        var res = relinkItems(missing, map);
        return JSON.stringify({ ok: true, missing: missing.length, relinked: res.relinked, notFound: res.notFound });
    } catch (e) {
        return jerr(e.toString());
    }
}

// items imported into the open project keep absolute footage paths into the
// library - after a folder rename those break ("file missing"), so relink them
function relinkProjectFootage(oldPrefix, newPrefix) {
    try {
        if (!app.project || oldPrefix === newPrefix) return;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof FootageItem && item.mainSource && item.mainSource.file) {
                var fp = item.mainSource.file.fsName;
                if (fp.indexOf(oldPrefix + '/') === 0 || fp.indexOf(oldPrefix + '\\') === 0) {
                    var relinked = new File(newPrefix + fp.substring(oldPrefix.length));
                    if (relinked.exists) item.replace(relinked);
                }
            }
        }
    } catch (e) { }
}

// $.evalFile runs inside loadHostModules(), so per ES3 eval semantics every
// declaration above is local to that call and discarded when it returns.
// Exporting to $.global is what actually makes these callable afterwards.
$.global.relinkBaseName = relinkBaseName;
$.global.relinkNormName = relinkNormName;
$.global.collectFilesRecursive = collectFilesRecursive;
$.global.missingSourcePath = missingSourcePath;
$.global.relinkItems = relinkItems;
$.global.absorbHealedFootage = absorbHealedFootage;
$.global.collectMissingFootage = collectMissingFootage;
$.global.relinkMissingFootage = relinkMissingFootage;
$.global.relinkProjectFootage = relinkProjectFootage;

