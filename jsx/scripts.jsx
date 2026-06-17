// DropComp Scripts host module (ExtendScript, ES3 only). Loaded by
// loadHostModules in hostscript.jsx; every function exports to $.global.
// Reuses jerr(), jsonEscape(), readTextFile(), writeTextFile() (host-global).
//
// Runs the user's own custom scripts on demand: external .jsx/.jsxbin files by
// reference, or pasted snippets via a temp file. ScriptUI 'palette' scripts run
// this way float as windows (verified), so the user keeps them undocked.

var SC_REGISTRY_NAME = '.dropcomp_scripts.json';
var SC_TMP_SEQ = 0;

function scRegistryFile(libPath) {
    return new File(libPath + '/' + SC_REGISTRY_NAME);
}
$.global.scRegistryFile = scRegistryFile;

// Returns the registry JSON ({version,scripts:[...]}), an empty default when the
// file is absent, or jerr on a read error. The panel parses .scripts.
function scLoadRegistry(libPath) {
    try {
        if (!libPath) return jerr('No library folder set.');
        var f = scRegistryFile(libPath);
        if (!f.exists) return '{"version":1,"scripts":[]}';
        var txt = readTextFile(f);
        if (txt === null) return jerr('Could not read the scripts registry.');
        return txt;
    } catch (e) { return jerr(e.toString()); }
}
$.global.scLoadRegistry = scLoadRegistry;

function scSaveRegistry(libPath, jsonStr) {
    try {
        if (!libPath) return jerr('No library folder set.');
        if (!writeTextFile(scRegistryFile(libPath), jsonStr)) {
            return jerr('Could not write the scripts registry.');
        }
        return '{"ok":true}';
    } catch (e) { return jerr(e.toString()); }
}
$.global.scSaveRegistry = scSaveRegistry;

function scErr(e) {
    return jerr(e.toString() + (e.line !== undefined ? ' (line ' + e.line + ')' : ''));
}
$.global.scErr = scErr;

// Run an external script file by absolute path. No undo group is forced - user
// scripts manage their own undo; wrapping them risks conflicting groups.
function scRunFile(path) {
    try {
        var f = new File(path);
        if (!f.exists) return jerr('Script file not found:\n' + path);
        $.evalFile(f);
        return '{"ok":true}';
    } catch (e) { return scErr(e); }
}
$.global.scRunFile = scRunFile;

// Run a pasted snippet by writing it to a temp .jsx and evalFile-ing that. The
// temp file is always cleaned up. Folder.temp is a real path (not /tmp symlink).
function scRunSnippet(body) {
    var tmp = null;
    try {
        if (body === null || body === undefined || String(body) === '') {
            return jerr('Snippet is empty.');
        }
        SC_TMP_SEQ = SC_TMP_SEQ + 1;
        tmp = new File(Folder.temp.fsName + '/dropcomp_run_' + (new Date().getTime()) + '_' + SC_TMP_SEQ + '.jsx');
        if (!writeTextFile(tmp, String(body))) return jerr('Could not write a temporary script file.');
        $.evalFile(tmp);
        try { tmp.remove(); } catch (eR) {}
        return '{"ok":true}';
    } catch (e) {
        if (tmp && tmp.exists) { try { tmp.remove(); } catch (e2) {} }
        return scErr(e);
    }
}
$.global.scRunSnippet = scRunSnippet;

function scBaseName(file) {
    return String(file.name).replace(/\.[^.]+$/, '');
}
$.global.scBaseName = scBaseName;

// Open a file picker for .jsx/.jsxbin and return the chosen path + base name.
function scPickScriptFile() {
    try {
        var isWin = ($.os.indexOf('Windows') !== -1);
        var filter = isWin ? 'Scripts:*.jsx;*.jsxbin' : scMacScriptFilter;
        var f = File.openDialog('Choose a script (.jsx or .jsxbin)', filter, false);
        if (!f) return '{"ok":false,"cancelled":true}';
        return '{"ok":true,"path":"' + jsonEscape(f.fsName) + '","name":"' + jsonEscape(scBaseName(f)) + '"}';
    } catch (e) { return scErr(e); }
}
$.global.scPickScriptFile = scPickScriptFile;

// macOS filter function: allow folders to navigate, and .jsx/.jsxbin files.
function scMacScriptFilter(f) {
    if (f instanceof Folder) return true;
    return /\.jsx(bin)?$/i.test(f.name);
}
$.global.scMacScriptFilter = scMacScriptFilter;

function scFileExists(path) {
    try {
        return (new File(path)).exists ? '{"ok":true,"exists":true}' : '{"ok":true,"exists":false}';
    } catch (e) { return scErr(e); }
}
$.global.scFileExists = scFileExists;

// Reveal a script file's containing folder in Finder/Explorer.
function scRevealFile(path) {
    try {
        var f = new File(path);
        var target = f.exists ? f.parent : f.parent; // folder either way
        if (!target || !target.exists) return jerr('Folder not found for:\n' + path);
        target.execute();
        return '{"ok":true}';
    } catch (e) { return scErr(e); }
}
$.global.scRevealFile = scRevealFile;
