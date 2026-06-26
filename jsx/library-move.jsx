// DropComp library item moves (ExtendScript, ES3 only)
// Loaded by hostscript.jsx loadHostModules(); public functions must export to $.global.
// Uses hostscript globals: Folder, File, jerr, jsonEscape, removeFolderRecursive,
// updateIndexPatchComp, rebuildLibraryIndex, ensureHostModules.

function isInvalidMovePathPart(name) {
    return !name || name === '.' || name === '..' || /[<>:"\/\\|?*\x00-\x1F]/.test(name);
}

function copyFolderRecursive(sourceFolder, targetFolder) {
    if (!sourceFolder.exists) return false;
    if (!targetFolder.exists && !targetFolder.create()) return false;
    var items = sourceFolder.getFiles();
    for (var i = 0; i < items.length; i++) {
        if (items[i] instanceof File) {
            var targetFile = new File(targetFolder.fsName + '/' + items[i].name);
            if (!items[i].copy(targetFile)) return false;
        } else if (items[i] instanceof Folder) {
            var childFolder = new Folder(targetFolder.fsName + '/' + items[i].name);
            if (!copyFolderRecursive(items[i], childFolder)) return false;
        }
    }
    return true;
}

function moveStashedComp(libraryPath, category, uniqueId, targetCategory) {
    try {
        category = String(category || '');
        targetCategory = String(targetCategory || '');
        uniqueId = String(uniqueId || '');
        if (!category || !targetCategory || !uniqueId) return jerr('Missing move target.');
        if (isInvalidMovePathPart(category) || isInvalidMovePathPart(targetCategory)) {
            return jerr('Folder name contains invalid characters (< > : " / \\ | ? *).');
        }
        if (isInvalidMovePathPart(uniqueId)) return jerr('Item id contains invalid characters.');
        if (category === targetCategory) return '{"ok":true,"noop":true}';
        if (isReservedCategory(targetCategory)) return jerr('"Assets" is reserved for the Assets tab.');

        var oldFolder = new Folder(libraryPath + '/' + category + '/' + uniqueId);
        if (!oldFolder.exists) return jerr('Item folder not found.');

        var targetRoot = new Folder(libraryPath + '/' + targetCategory);
        if (!targetRoot.exists && !targetRoot.create()) return jerr('Could not create the target folder.');

        var movedFolder = new Folder(targetRoot.fsName + '/' + uniqueId);
        if (movedFolder.exists) return jerr('An item with that name already exists in the target folder.');
        if (!copyFolderRecursive(oldFolder, movedFolder)) {
            if (movedFolder.exists) removeFolderRecursive(movedFolder);
            return jerr('Could not move the item folder.');
        }

        removeFolderRecursive(oldFolder);

        var aeps = movedFolder.getFiles('*.aep');
        var thumb = new File(movedFolder.fsName + '/comp.png');
        var patched = updateIndexPatchComp(libraryPath, category, uniqueId, {
            category: targetCategory,
            aepPath: aeps.length ? aeps[0].fsName : null,
            thumbPath: thumb.exists ? thumb.fsName : null
        });
        if (!patched) rebuildLibraryIndex(libraryPath);

        if (ensureHostModules()) {
            relinkProjectFootage(oldFolder.fsName, movedFolder.fsName);
        }

        return '{"ok":true,"category":"' + jsonEscape(targetCategory) + '"}';
    } catch (e) {
        return jerr(e.toString());
    }
}

$.global.copyFolderRecursive = copyFolderRecursive;
$.global.isInvalidMovePathPart = isInvalidMovePathPart;
$.global.moveStashedComp = moveStashedComp;
