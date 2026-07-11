// DropComp 2.0 host script (ExtendScript, ES3 only)
// TODO: split by concern (index/stash/thumbs are separable modules)

// relink helpers live in relink.jsx, aep version preflight in aep-compat.jsx,
// external-aep capture in import-capture.jsx (keeps files under the 800-line limit).
// $.fileName is NOT set when CEP evaluates this file, so the panel must call
// loadHostModules(extensionRoot) once at boot before any relink-dependent call.
var DC_MODULES_LOADED = false;
var DC_MODULE_FILES = ['relink.jsx', 'assets.jsx', 'tools.jsx', 'tools-timing.jsx', 'scripts.jsx', 'library-move.jsx', 'aep-compat.jsx', 'import-capture.jsx'];
var DC_MODULE_MARKERS = ['collectMissingFootage', 'getAssets', 'tlCreateLayer', 'tlAdjustTiming', 'scRunFile', 'moveStashedComp', 'aepPreflight', 'addExternalAep'];

function loadHostModules(extPath) {
    try {
        if (DC_MODULES_LOADED) return 'ok';
        $.global.DC_EXT_PATH = extPath;
        for (var i = 0; i < DC_MODULE_FILES.length; i++) {
            var moduleFile = new File(extPath + '/jsx/' + DC_MODULE_FILES[i]);
            if (!moduleFile.exists) return 'Error: ' + DC_MODULE_FILES[i] + ' not found at ' + moduleFile.fsName;
            $.evalFile(moduleFile);
            // $.evalFile evaluates in THIS function's scope (ES3 eval semantics),
            // so each module must export its functions to $.global itself - verify
            // that actually landed instead of trusting evalFile's silence.
            if (typeof $.global[DC_MODULE_MARKERS[i]] !== 'function') {
                return 'Error: ' + DC_MODULE_FILES[i] + ' loaded but did not export its functions to $.global.';
            }
        }
        DC_MODULES_LOADED = true;
        return 'ok';
    } catch (e) {
        return 'Error: ' + e.toString();
    }
}

// lazy fallback so an import never dies on a missing module
function ensureHostModules() {
    var present = true;
    for (var i = 0; i < DC_MODULE_MARKERS.length; i++) {
        if (typeof $.global[DC_MODULE_MARKERS[i]] !== 'function') { present = false; break; }
    }
    if (present) return true;
    DC_MODULES_LOADED = false;
    return typeof $.global.DC_EXT_PATH === 'string' &&
        loadHostModules($.global.DC_EXT_PATH) === 'ok';
}

// ---------- generic helpers ----------
function jsonEscape(s) {
    return String(s)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

function jerr(msg) {
    return '{"ok":false,"error":"' + jsonEscape(msg) + '"}';
}

function readTextFile(file) {
    if (!file.exists) return null;
    file.encoding = 'UTF-8';
    if (!file.open('r')) return null;
    var s = file.read();
    file.close();
    return s;
}

function writeTextFile(file, text) {
    file.encoding = 'UTF-8';
    if (!file.open('w')) return false;
    file.write(text);
    file.close();
    return true;
}

function readJson(file) {
    var s = readTextFile(file);
    if (s === null) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
}

function writeJson(file, obj) {
    try { return writeTextFile(file, JSON.stringify(obj)); } catch (e) { return false; }
}

function safeNameJsx(name) {
    return String(name).replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_');
}

// the top-level Assets folder belongs to the Assets tab, never to comp categories
function isReservedCategory(name) {
    return String(name).toLowerCase() === 'assets';
}

// ---------- settings ----------
function settingsFolder() {
    var f = new Folder(Folder.myDocuments.fsName + '/DropComp');
    if (!f.exists) f.create();
    return f;
}

function getLibraryPath() {
    var s = readTextFile(new File(settingsFolder().fsName + '/library_path.txt'));
    if (s === null) return null;
    s = s.replace(/\r?\n|\r/g, '');
    return s || null;
}

function setLibraryPath(path) {
    var ok = writeTextFile(new File(settingsFolder().fsName + '/library_path.txt'), path);
    return ok ? 'Success' : 'Error: Could not save the library path.';
}

function selectLibraryFolder() {
    var folder = Folder.selectDialog('Select your DropComp Library Folder');
    if (folder) {
        setLibraryPath(folder.fsName);
        return folder.fsName;
    }
    return null;
}

function checkLibraryPath(path) {
    return new Folder(path).exists ? 'ok' : 'missing';
}

function revealInFinder(path) {
    var folder = new Folder(path);
    if (!folder.exists) return 'Error: Folder not found.';
    folder.execute();
    return 'ok';
}

// ---------- index (version 2) ----------
function getIndexFile(libraryPath) {
    return new File(libraryPath + '/.dropcomp_index.json');
}

// library items hold one AE project: .aep, or .aet for marketplace templates
function aeProjectFilesIn(folder) {
    var files = folder.getFiles('*.aep');
    var aets = folder.getFiles('*.aet');
    for (var i = 0; i < aets.length; i++) files.push(aets[i]);
    return files;
}

function aeProjectExt(fileName) {
    return /\.aet$/i.test(String(fileName)) ? '.aet' : '.aep';
}

function entryFromFolder(categoryName, compFolder) {
    var aeps = aeProjectFilesIn(compFolder);
    if (aeps.length === 0) return null;
    var thumb = new File(compFolder.fsName + '/comp.png');
    var meta = readJson(new File(compFolder.fsName + '/metadata.json')) || {};
    var name = meta.displayName ||
        decodeURI(compFolder.name).split('_').slice(0, -1).join(' ');
    var tsMatch = /_(\d{10,})$/.exec(compFolder.name);
    return {
        name: name,
        category: categoryName,
        uniqueId: compFolder.name,
        aepPath: aeps[0].fsName,
        thumbPath: thumb.exists ? thumb.fsName : null,
        mainCompId: meta.mainCompId || null,
        width: meta.width || null,
        height: meta.height || null,
        duration: meta.duration || null,
        frameRate: meta.frameRate || null,
        addedAt: meta.addedAt || (tsMatch ? parseInt(tsMatch[1], 10) : null)
    };
}

function loadIndexComps(libraryPath) {
    var idx = readJson(getIndexFile(libraryPath));
    return (idx && idx.compositions) ? idx.compositions : [];
}

function saveIndexComps(libraryPath, comps) {
    return writeJson(getIndexFile(libraryPath), {
        version: 2,
        lastUpdated: new Date().getTime(),
        compositions: comps
    });
}

function rebuildLibraryIndex(libraryPath) {
    var mainFolder = new Folder(libraryPath);
    if (!mainFolder.exists) return '[]';
    var compsData = [];
    var isFolder = function (f) { return f instanceof Folder; };
    var cats = mainFolder.getFiles(isFolder);
    for (var i = 0; i < cats.length; i++) {
        if (isReservedCategory(decodeURI(cats[i].name))) continue;
        var subs = cats[i].getFiles(isFolder);
        for (var j = 0; j < subs.length; j++) {
            var entry = entryFromFolder(decodeURI(cats[i].name), subs[j]);
            if (entry) compsData.push(entry);
        }
    }
    saveIndexComps(libraryPath, compsData);
    return JSON.stringify(compsData);
}

function getStashedComps(libraryPath) {
    if (!new Folder(libraryPath).exists) return '[]';
    var idx = readJson(getIndexFile(libraryPath));
    if (idx && idx.version === 2 && idx.compositions) {
        return JSON.stringify(idx.compositions);
    }
    return rebuildLibraryIndex(libraryPath);
}

function updateIndexAddComp(libraryPath, comp) {
    var comps = loadIndexComps(libraryPath);
    comps.push(comp);
    saveIndexComps(libraryPath, comps);
}

function updateIndexRemoveComp(libraryPath, category, uniqueId) {
    var comps = loadIndexComps(libraryPath);
    var out = [];
    for (var i = 0; i < comps.length; i++) {
        if (!(comps[i].category === category && comps[i].uniqueId === uniqueId)) {
            out.push(comps[i]);
        }
    }
    saveIndexComps(libraryPath, out);
}

function updateIndexPatchComp(libraryPath, category, uniqueId, patch) {
    var comps = loadIndexComps(libraryPath);
    for (var i = 0; i < comps.length; i++) {
        if (comps[i].category === category && comps[i].uniqueId === uniqueId) {
            for (var k in patch) {
                if (patch.hasOwnProperty(k)) comps[i][k] = patch[k];
            }
            return saveIndexComps(libraryPath, comps);
        }
    }
    return false;
}

// ---------- delete ----------
function removeFolderRecursive(folder) {
    var items = folder.getFiles();
    for (var i = 0; i < items.length; i++) {
        if (items[i] instanceof File) items[i].remove();
        else if (items[i] instanceof Folder) removeFolderRecursive(items[i]);
    }
    folder.remove();
}

function deleteStashedComp(libraryPath, category, uniqueId) {
    try {
        var compFolder = new Folder(libraryPath + '/' + category + '/' + uniqueId);
        if (!compFolder.exists) return 'Error: Folder not found.';
        removeFolderRecursive(compFolder);
        updateIndexRemoveComp(libraryPath, category, uniqueId);
        return 'Success';
    } catch (e) {
        return 'Error: ' + e.toString();
    }
}

// ---------- import into current project ----------
function collectComps(folderItem, out) {
    for (var i = 1; i <= folderItem.numItems; i++) {
        var item = folderItem.item(i);
        if (item instanceof CompItem) out.push(item);
        else if (item instanceof FolderItem) collectComps(item, out);
    }
}

function pickMainComp(comps, preferredName) {
    if (comps.length === 0) return null;
    var i;
    if (preferredName) {
        for (i = 0; i < comps.length; i++) {
            if (comps[i].name === preferredName) return comps[i];
        }
        for (i = 0; i < comps.length; i++) {
            if (comps[i].name.indexOf(preferredName) !== -1) return comps[i];
        }
    }
    return comps[0];
}

function importComp(aepPath) {
    var suppressing = false;
    var undoing = false;
    try {
        if (!app.project) return 'Error: Please open a project first.';
        var fileToImport = new File(aepPath);
        if (!fileToImport.exists) return 'Error: Source AEP file not found.';

        var metadataFile = new File(fileToImport.parent.fsName + '/metadata.json');
        var meta = readJson(metadataFile) || {};
        var compName = meta.displayName || 'Imported Comp';

        // preflight is ADVISORY (see import-capture.jsx): block definitive
        // junk only, and keep the verdict to explain a failed import
        var pf = null;
        var imported = false;
        if (ensureHostModules()) {
            pf = aepPreflight(fileToImport.fsName);
            if (pf.reason === 'missing' || pf.reason === 'not-aep') return 'Error: ' + pf.message;
        }

        app.beginSuppressDialogs();
        suppressing = true;
        // AE project import can corrupt the undo stack inside an explicit group.
        // Import first, then group DropComp's relink/timeline edits.
        var importedFolder = app.project.importFile(new ImportOptions(fileToImport));
        imported = true;
        app.beginUndoGroup('DropComp Import');
        undoing = true;
        importedFolder.name = compName + ' [DropComp]';

        // self-heal: the saved aep keeps absolute footage paths that break when
        // the item folder is renamed or the library moves - relink on every import
        var stillMissing = 0;
        var absorbed = 0;
        if (ensureHostModules()) {
            var missingInImport = [];
            collectMissingFootage(importedFolder, missingInImport);
            if (missingInImport.length) {
                var localMap = {};
                collectFilesRecursive(fileToImport.parent, localMap, 0);
                var localHeal = relinkItems(missingInImport, localMap);
                var healedItems = localHeal.healed;
                if (localHeal.notFound.length) {
                    var libRoot = null;
                    try { libRoot = fileToImport.parent.parent.parent; } catch (eL) { }
                    if (libRoot && libRoot.exists) {
                        var libMap = {};
                        collectFilesRecursive(libRoot, libMap, 0);
                        var leftovers = [];
                        collectMissingFootage(importedFolder, leftovers);
                        var libHeal = relinkItems(leftovers, libMap);
                        healedItems = healedItems.concat(libHeal.healed);
                    }
                }
                // copy the found files into this item's (Footage) folder so the
                // next import resolves locally instead of re-searching the library
                absorbed = absorbHealedFootage(healedItems, fileToImport.parent.fsName);
                var finalCheck = [];
                collectMissingFootage(importedFolder, finalCheck);
                stillMissing = finalCheck.length;
            }
        }

        var allComps = [];
        collectComps(importedFolder, allComps);
        var mainComp = pickMainComp(allComps, compName);
        if (mainComp && mainComp.name !== compName) mainComp.name = compName;

        var addedToTimeline = false;
        if (mainComp && app.project.activeItem && app.project.activeItem instanceof CompItem) {
            try {
                var activeComp = app.project.activeItem;
                var newLayer = activeComp.layers.add(mainComp);
                newLayer.startTime = activeComp.time;
                newLayer.selected = true;
                for (var k = 1; k <= activeComp.numLayers; k++) {
                    if (activeComp.layer(k) !== newLayer) activeComp.layer(k).selected = false;
                }
                addedToTimeline = true;
            } catch (e) {
                addedToTimeline = false;
            }
        }
        app.endUndoGroup();
        undoing = false;
        app.endSuppressDialogs(false);
        suppressing = false;

        var missingNote = stillMissing
            ? ' Warning: ' + stillMissing + ' asset' + (stillMissing === 1 ? '' : 's') + ' missing (not in library).'
            : '';
        var healNote = absorbed
            ? ' ' + absorbed + ' relinked file' + (absorbed === 1 ? '' : 's') + ' saved into the library item.'
            : '';
        if (mainComp) {
            return "Success: '" + compName + "' imported" + (addedToTimeline ? ' and added to timeline.' : '.') + missingNote + healNote;
        }
        return 'Success: Project imported, but no composition found to add to timeline.' + missingNote + healNote;
    } catch (e) {
        try { if (undoing) app.endUndoGroup(); } catch (e2) { }
        try { if (suppressing) app.endSuppressDialogs(false); } catch (e3) { }
        // only dress up failures of the import itself, not post-import edits
        if (!imported && typeof $.global.aepImportFailureMessage === 'function') {
            return 'Error: ' + aepImportFailureMessage(aepPath, e.toString(), pf);
        }
        return 'Error: ' + e.toString();
    }
}

// ---------- thumbnails ----------
function compInfo(comp) {
    return {
        compName: comp.name,
        width: comp.width,
        height: comp.height,
        duration: comp.duration,
        frameRate: comp.frameRate
    };
}

// saveFrameToPng writes asynchronously in recent AE versions - poll until the file lands
function waitForFile(file, timeoutMs, minBytes) {
    var waited = 0;
    while (waited <= timeoutMs) {
        var probe = new File(file.fsName);
        if (probe.exists && probe.length >= minBytes) return true;
        $.sleep(100);
        waited += 100;
    }
    return false;
}

function saveVerifiedThumb(comp, pngFile) {
    var start = comp.workAreaStart;
    var dur = comp.workAreaDuration;
    var times = [start + dur / 2, start, start + dur * 0.25];
    for (var i = 0; i < times.length; i++) {
        try {
            if (pngFile.exists) pngFile.remove();
            comp.saveFrameToPng(times[i], pngFile);
            if (waitForFile(pngFile, 2500, 1024)) return true;
        } catch (e) { }
    }
    return waitForFile(pngFile, 1000, 1);
}

// ---------- stash ----------
function stashSelectedComp(libraryPath, categoryName) {
    var originalProjectFile = app.project ? app.project.file : null;
    var secretTempAEP = null;
    var movedAway = false;
    try {
        if (!app.project) return 'Error: Please open a project first.';
        if (!originalProjectFile) return 'Error: Save your project once before stashing.';
        if (isReservedCategory(categoryName)) return 'Error: "Assets" is reserved for the Assets tab.';

        var compToSave = null;
        var activeComp = app.project.activeItem;
        if (activeComp && activeComp instanceof CompItem) {
            var sel = activeComp.selectedLayers;
            for (var i = 0; i < sel.length; i++) {
                if (sel[i].source && sel[i].source instanceof CompItem) {
                    if (compToSave) return 'Error: Please select only one precomp in the Timeline, or one composition in the Project Panel.';
                    compToSave = sel[i].source;
                }
            }
        }
        if (!compToSave) {
            var selected = app.project.selection;
            if (selected.length !== 1 || !(selected[0] instanceof CompItem)) {
                return 'Error: Please select exactly one composition in the Project Panel or one precomp layer in the Timeline.';
            }
            compToSave = selected[0];
        }
        var compToSaveID = compToSave.id;
        var compToSaveName = compToSave.name;
        var info = compInfo(compToSave);
        var safeCompName = safeNameJsx(compToSaveName);

        var categoryFolder = new Folder(libraryPath + '/' + categoryName);
        if (!categoryFolder.exists) categoryFolder.create();
        var timestamp = new Date().getTime();
        var compFolderName = safeCompName + '_' + timestamp;
        var compFolder = new Folder(categoryFolder.fsName + '/' + compFolderName);
        if (!compFolder.create()) return 'Error: Could not create the item folder.';

        var thumbFile = new File(compFolder.fsName + '/comp.png');
        saveVerifiedThumb(compToSave, thumbFile);

        writeJson(new File(compFolder.fsName + '/metadata.json'), {
            displayName: compToSaveName,
            mainCompId: compToSaveID,
            mainCompName: compToSaveName,
            width: info.width,
            height: info.height,
            duration: info.duration,
            frameRate: info.frameRate,
            addedAt: timestamp,
            source: 'stash'
        });

        // The finally block reopens originalProjectFile from disk, so any edits
        // made since the user's last manual save must be persisted first.
        app.project.save();

        app.beginUndoGroup('DropComp Stash');
        secretTempAEP = new File(Folder.temp.fsName + '/dropcomp_temp_' + timestamp + '.aep');
        app.project.save(secretTempAEP);
        movedAway = true;

        var compInTemp = null;
        for (var k = 1; k <= app.project.numItems; k++) {
            if (app.project.item(k).id === compToSaveID) {
                compInTemp = app.project.item(k);
                break;
            }
        }
        if (!compInTemp) throw new Error('Could not find the composition in the temp project.');
        app.project.reduceProject([compInTemp]);

        var footageSubFolder = new Folder(compFolder.fsName + '/(Footage)');
        footageSubFolder.create();
        for (var n = 1; n <= app.project.numItems; n++) {
            var item = app.project.item(n);
            if (item instanceof FootageItem && item.mainSource && item.mainSource.file) {
                var sourceFile = item.mainSource.file;
                if (sourceFile.fsName.indexOf('Adobe') === -1 && sourceFile.fsName.indexOf('Plug-ins') === -1) {
                    var newFile = new File(footageSubFolder.fsName + '/' + sourceFile.name);
                    if (!newFile.exists) sourceFile.copy(newFile);
                    item.replace(newFile);
                }
            }
        }
        app.project.save(secretTempAEP);

        var finalAEPFile = new File(compFolder.fsName + '/' + safeCompName + '.aep');
        if (!secretTempAEP.copy(finalAEPFile)) {
            throw new Error('Could not copy the temporary project to the library.');
        }
        app.endUndoGroup();

        updateIndexAddComp(libraryPath, {
            name: compToSaveName,
            category: categoryName,
            uniqueId: compFolderName,
            aepPath: finalAEPFile.fsName,
            thumbPath: thumbFile.exists ? thumbFile.fsName : null,
            mainCompId: compToSaveID,
            width: info.width,
            height: info.height,
            duration: info.duration,
            frameRate: info.frameRate,
            addedAt: timestamp
        });

        return "Success! '" + compToSaveName + "' was added to your library.";
    } catch (e) {
        return 'Error: ' + e.toString();
    } finally {
        if (movedAway && originalProjectFile && originalProjectFile.exists) {
            app.open(originalProjectFile);
        }
        if (secretTempAEP && secretTempAEP.exists) {
            secretTempAEP.remove();
        }
    }
}

// ---------- transactional rename ----------
function renameStashedComp(libraryPath, category, uniqueId, newName) {
    try {
        // re-check the name host-side (mirrors panel DCValidate; ES3 - no trim())
        newName = String(newName).replace(/^\s+|\s+$/g, '');
        if (!newName) return jerr('Name cannot be empty.');
        if (newName.length > 200) return jerr('Name is too long (max 200 characters).');
        if (/[<>:"\/\\|?*\x00-\x1F]/.test(newName)) return jerr('Name contains invalid characters (< > : " / \\ | ? *).');
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(newName)) return jerr('Name uses a reserved system name.');

        var m = /_(\d{10,})$/.exec(uniqueId);
        if (!m) return jerr('Cannot parse this item id.');
        var safe = safeNameJsx(newName);
        var newUniqueId = safe + '_' + m[1];
        var catPath = libraryPath + '/' + category;
        var oldFolder = new Folder(catPath + '/' + uniqueId);
        if (!oldFolder.exists) return jerr('Item folder not found.');

        if (newUniqueId !== uniqueId) {
            if (new Folder(catPath + '/' + newUniqueId).exists) {
                return jerr('An item with that name already exists in this category.');
            }
            if (!oldFolder.rename(newUniqueId)) {
                return jerr('Could not rename the folder on disk.');
            }
        }
        var folder = new Folder(catPath + '/' + newUniqueId);

        var aeps = aeProjectFilesIn(folder);
        var oldAepName = aeps.length ? aeps[0].name : null;
        var projExt = aeps.length ? aeProjectExt(aeps[0].name) : '.aep';
        if (aeps.length && aeps[0].name !== safe + projExt) {
            if (!aeps[0].rename(safe + projExt)) {
                if (newUniqueId !== uniqueId) folder.rename(uniqueId);
                return jerr('Could not rename the project file.');
            }
        }

        var metaFile = new File(folder.fsName + '/metadata.json');
        var meta = readJson(metaFile) || {};
        meta.displayName = newName;
        if (!writeJson(metaFile, meta)) {
            var back = aeProjectFilesIn(folder);
            if (back.length && oldAepName) back[0].rename(oldAepName);
            if (newUniqueId !== uniqueId) folder.rename(uniqueId);
            return jerr('Could not update metadata.');
        }

        var aepNow = aeProjectFilesIn(folder);
        var thumb = new File(folder.fsName + '/comp.png');
        var patched = updateIndexPatchComp(libraryPath, category, uniqueId, {
            name: newName,
            uniqueId: newUniqueId,
            aepPath: aepNow.length ? aepNow[0].fsName : null,
            thumbPath: thumb.exists ? thumb.fsName : null
        });
        if (!patched) rebuildLibraryIndex(libraryPath);

        if (ensureHostModules()) {
            relinkProjectFootage(new Folder(catPath + '/' + uniqueId).fsName, folder.fsName);
        }

        return '{"ok":true,"newUniqueId":"' + jsonEscape(newUniqueId) + '"}';
    } catch (e) {
        return jerr(e.toString());
    }
}
