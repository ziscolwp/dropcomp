// DropComp 2.0 host script (ExtendScript, ES3 only)

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

function entryFromFolder(categoryName, compFolder) {
    var aeps = compFolder.getFiles('*.aep');
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
    try {
        if (!app.project) return 'Error: Please open a project first.';
        var fileToImport = new File(aepPath);
        if (!fileToImport.exists) return 'Error: Source AEP file not found.';

        var metadataFile = new File(fileToImport.parent.fsName + '/metadata.json');
        var meta = readJson(metadataFile) || {};
        var compName = meta.displayName || 'Imported Comp';

        app.beginUndoGroup('DropComp Import');
        var importedFolder = app.project.importFile(new ImportOptions(fileToImport));
        importedFolder.name = compName + ' [DropComp]';

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

        if (mainComp) {
            return "Success: '" + compName + "' imported" + (addedToTimeline ? ' and added to timeline.' : '.');
        }
        return 'Success: Project imported, but no composition found to add to timeline.';
    } catch (e) {
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

function saveVerifiedThumb(comp, pngFile) {
    var start = comp.workAreaStart;
    var dur = comp.workAreaDuration;
    var times = [start + dur / 2, start, start + dur * 0.25];
    for (var i = 0; i < times.length; i++) {
        try {
            if (pngFile.exists) pngFile.remove();
            comp.saveFrameToPng(times[i], pngFile);
            if (pngFile.exists && pngFile.length > 1024) return true;
        } catch (e) { }
    }
    return pngFile.exists && pngFile.length > 0;
}

// ---------- stash ----------
function stashSelectedComp(libraryPath, categoryName) {
    var originalProjectFile = app.project ? app.project.file : null;
    var secretTempAEP = null;
    var movedAway = false;
    try {
        if (!app.project) return 'Error: Please open a project first.';
        if (!originalProjectFile) return 'Error: Save your project once before stashing.';

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
