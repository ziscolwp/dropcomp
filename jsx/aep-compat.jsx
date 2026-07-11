// DropComp AEP compatibility module (ExtendScript, ES3 only)
// Loaded by hostscript.jsx loadHostModules() via $.evalFile. evalFile runs in
// the caller's LOCAL scope, so every public function must be exported to
// $.global explicitly or it is undefined at call time.
//
// Purpose: before importing an external .aep/.aet, read WHICH After Effects
// last saved it from the XMP packet embedded in the RIFX container, and turn
// the guaranteed failure case (file saved by a NEWER AE than the one running)
// into a clear human message instead of a raw AE exception. Older-or-equal
// files always import; AE converts them on the fly.
//
// Marker choice: xmp:CreatorTool keeps the ORIGINAL creating app forever,
// even after newer versions re-save the file. The xmpMM history's LAST
// stEvt:softwareAgent entry reflects the most recent save, so the agent wins
// and CreatorTool is only a fallback (verified against a real Envato file).

var DC_AEP_SCAN_CHUNK = 524288; // bytes per read
var DC_AEP_SCAN_OVERLAP = 4096; // catches markers straddling chunk borders

// last capture-group hit of a /g regex in text, or null
function dcLastMatch(re, text) {
    var out = null;
    var m;
    while ((m = re.exec(text)) !== null) {
        out = m[1].replace(/\s+$/, '');
        if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
}

// last softwareAgent + last CreatorTool in a text chunk (element or
// attribute XMP serialization), restricted to After Effects entries
function aepScanSavedBy(text) {
    var s = String(text || '');
    return {
        agent: dcLastMatch(/stEvt:softwareAgent\s*(?:>|=\s*")\s*(Adobe After Effects[^<"]*)/g, s),
        creator: dcLastMatch(/xmp:CreatorTool\s*(?:>|=\s*")\s*(Adobe After Effects[^<"]*)/g, s)
    };
}

// comparable major version from a savedBy string, or null when unknown.
// Precision below CC-era does not matter (everything old imports fine);
// accuracy near the running version is what the verdict depends on.
function aeMajorFromSavedBy(savedBy) {
    if (!savedBy) return null;
    var s = String(savedBy);
    if (!/Adobe After Effects/.test(s)) return null;
    var m = /After Effects\s+CS(\d+(?:\.\d+)?)/i.exec(s);
    if (m) return parseFloat(m[1]) + 5; // CS6 = 11, CS5.5 = 10.5
    m = /After Effects\s+CC\s+(\d{4})/i.exec(s);
    if (m) {
        var ccMap = { 2014: 13, 2015: 13.5, 2016: 13.8, 2017: 14, 2018: 15, 2019: 16 };
        var ccYear = parseInt(m[1], 10);
        return ccMap.hasOwnProperty(ccYear) ? ccMap[ccYear] : null;
    }
    if (/After Effects\s+CC(\s|\(|$)/i.test(s)) return 12;
    m = /After Effects\s+(\d{4})(?:\.\d+)?/.exec(s);
    if (m) {
        var year = parseInt(m[1], 10);
        if (year === 2020) return 17;
        if (year === 2021) return 18;
        if (year >= 2022) return year - 2000; // 2022+ majors track the year
        return null;
    }
    m = /After Effects\s+(\d{1,2}(?:\.\d+)?)/.exec(s);
    if (m) return parseFloat(m[1]);
    return null;
}

function aeRunningMajor() {
    try {
        var v = parseFloat(app.version);
        return isNaN(v) ? null : v;
    } catch (e) {
        return null;
    }
}

// .aep and .aet are RIFX containers (big-endian RIFF); anything else is a
// renamed/corrupt file that AE would reject with a cryptic error
function aepIsRifx(aepPath) {
    var f = new File(aepPath);
    if (!f.exists) return false;
    f.encoding = 'BINARY';
    if (!f.open('r')) return false;
    var head = f.read(4);
    f.close();
    return head === 'RIFX' || head === 'RIFF';
}

// which AE last saved this project, e.g. "Adobe After Effects 2024 (Windows)".
// Scans BACKWARD from EOF in chunks: the XMP packet sits near the end of real
// projects, and the first agent hit walking backward is the last save in the
// file - typically one read even on 100 MB templates.
function aepReadSavedBy(aepPath) {
    var f = new File(aepPath);
    if (!f.exists) return null;
    f.encoding = 'BINARY';
    if (!f.open('r')) return null;
    var agent = null;
    var creator = null;
    var pos = f.length - DC_AEP_SCAN_CHUNK;
    if (pos < 0) pos = 0;
    while (true) {
        f.seek(pos, 0);
        var hit = aepScanSavedBy(f.read(DC_AEP_SCAN_CHUNK + DC_AEP_SCAN_OVERLAP));
        if (hit.agent) { agent = hit.agent; break; }
        if (hit.creator && !creator) creator = hit.creator;
        if (pos === 0) break;
        pos -= DC_AEP_SCAN_CHUNK;
        if (pos < 0) pos = 0;
    }
    f.close();
    return agent || creator;
}

// verdict before any import/copy. ok:false only for the guaranteed-failure
// cases; an unparseable version stays ok:true and lets AE try (best effort).
function aepPreflight(aepPath) {
    var res = { ok: true, reason: null, savedBy: null, fileMajor: null, runningMajor: aeRunningMajor(), message: null };
    var f = new File(aepPath);
    if (!f.exists) {
        res.ok = false;
        res.reason = 'missing';
        res.message = 'Project file not found: ' + aepPath;
        return res;
    }
    if (!aepIsRifx(aepPath)) {
        res.ok = false;
        res.reason = 'not-aep';
        res.message = '"' + decodeURI(f.name) + '" is not a valid After Effects project (.aep/.aet). The download may be incomplete, or the file was renamed from another format.';
        return res;
    }
    res.savedBy = aepReadSavedBy(aepPath);
    res.fileMajor = aeMajorFromSavedBy(res.savedBy);
    if (res.fileMajor !== null && res.runningMajor !== null &&
        Math.floor(res.fileMajor) > Math.floor(res.runningMajor)) {
        res.ok = false;
        res.reason = 'newer';
        res.message = 'This project was saved by "' + res.savedBy + '", which is newer than this After Effects (v' + app.version + '). Newer project files cannot be opened by older versions. Open it in that After Effects and use File > Save As > Save a Copy As... to target your version, or update After Effects.';
    }
    return res;
}

// friendlier wrapper for a failed importFile: names the file and, when the
// version is readable, says who saved it so "why" is obvious from the toast
function aepImportFailureMessage(aepPath, errText) {
    var name = 'project';
    try { name = '"' + decodeURI(new File(aepPath).name) + '"'; } catch (e1) { }
    var hint = '';
    try {
        var savedBy = aepReadSavedBy(aepPath);
        if (savedBy) hint = ' (saved by ' + savedBy + ', this After Effects is v' + app.version + ')';
    } catch (e2) { }
    return 'Could not import ' + name + hint + '. ' + String(errText);
}

// ---- exports (see header comment) ----
$.global.dcLastMatch = dcLastMatch;
$.global.aepScanSavedBy = aepScanSavedBy;
$.global.aeMajorFromSavedBy = aeMajorFromSavedBy;
$.global.aeRunningMajor = aeRunningMajor;
$.global.aepIsRifx = aepIsRifx;
$.global.aepReadSavedBy = aepReadSavedBy;
$.global.aepPreflight = aepPreflight;
$.global.aepImportFailureMessage = aepImportFailureMessage;
