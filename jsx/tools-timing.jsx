// DropComp Tools timing module (ExtendScript, ES3 only). Loaded after
// tools.jsx; every function exports to $.global for hostscript verification.

// The mode is chosen by what's selected when the button is pressed:
//   1. selected keyframes -> adjust keys, leave the layers put.
//   2. selected layers    -> adjust layer start times.
//   3. one layer sequence -> duplicate it down the timeline and select the
//      last copy, preserving the old Sequence behavior.

function tlCollectSelectedKeys(comp) {
    var res = { order: [], byIndex: {}, total: 0, propertyCount: 0, noKeyPropertyCount: 0 };
    var props = comp.selectedProperties;
    if (!props) return res;
    res.propertyCount = props.length;
    for (var i = 0; i < props.length; i++) {
        var p = props[i];
        var sel = null, noKeys = false;
        try { noKeys = typeof p.numKeys !== 'undefined' && p.numKeys === 0; } catch (e0) {}
        try { sel = p.selectedKeys; } catch (e1) { sel = null; noKeys = true; }
        if (noKeys) res.noKeyPropertyCount++;
        if (!sel || sel.length === 0) continue;
        var layer = p.propertyGroup(p.propertyDepth);
        var li = layer.index;
        if (!res.byIndex.hasOwnProperty(li)) {
            res.byIndex[li] = { layer: layer, props: [] };
            res.order.push(li);
        }
        var times = [];
        for (var k = 0; k < sel.length; k++) times.push(p.keyTime(sel[k]));
        times.sort(function (a, b) { return a - b; });
        res.byIndex[li].props.push({ prop: p, times: times });
        res.total += sel.length;
    }
    res.order.sort(function (a, b) { return a - b; });
    return res;
}
$.global.tlCollectSelectedKeys = tlCollectSelectedKeys;

function tlReadKeyframe(prop, index) {
    var k = { value: prop.keyValue(index), selected: true };
    try { k.selected = prop.keySelected(index); } catch (e0) {}
    try {
        k.inType = prop.keyInInterpolationType(index);
        k.outType = prop.keyOutInterpolationType(index);
    } catch (e1) {}
    try {
        k.inEase = prop.keyInTemporalEase(index);
        k.outEase = prop.keyOutTemporalEase(index);
    } catch (e2) {}
    try { k.temporalContinuous = prop.keyTemporalContinuous(index); } catch (e3) {}
    try { k.temporalAuto = prop.keyTemporalAutoBezier(index); } catch (e4) {}
    try {
        k.inSpatial = prop.keyInSpatialTangent(index);
        k.outSpatial = prop.keyOutSpatialTangent(index);
    } catch (e5) {}
    try { k.spatialContinuous = prop.keySpatialContinuous(index); } catch (e6) {}
    try { k.spatialAuto = prop.keySpatialAutoBezier(index); } catch (e7) {}
    try { k.roving = prop.keyRoving(index); } catch (e8) {}
    try { k.label = prop.keyLabel(index); } catch (e9) {}
    return k;
}
$.global.tlReadKeyframe = tlReadKeyframe;

function tlRestoreKeyframe(prop, index, k) {
    prop.setValueAtKey(index, k.value);
    try {
        if (typeof k.temporalContinuous !== 'undefined') prop.setTemporalContinuousAtKey(index, k.temporalContinuous);
    } catch (e0) {}
    try {
        if (typeof k.temporalAuto !== 'undefined') prop.setTemporalAutoBezierAtKey(index, k.temporalAuto);
    } catch (e1) {}
    // ease BEFORE interpolation type: AE converts a key to BEZIER whenever
    // setTemporalEaseAtKey runs, so the type restore must come last or every
    // sequenced LINEAR/HOLD key silently turns bezier (bug-014)
    try {
        if (typeof k.inEase !== 'undefined') prop.setTemporalEaseAtKey(index, k.inEase, k.outEase);
    } catch (e3) {}
    try {
        if (typeof k.inType !== 'undefined') prop.setInterpolationTypeAtKey(index, k.inType, k.outType);
    } catch (e2) {}
    try {
        if (typeof k.spatialContinuous !== 'undefined') prop.setSpatialContinuousAtKey(index, k.spatialContinuous);
    } catch (e4) {}
    try {
        if (typeof k.spatialAuto !== 'undefined') prop.setSpatialAutoBezierAtKey(index, k.spatialAuto);
    } catch (e5) {}
    try {
        if (typeof k.inSpatial !== 'undefined') prop.setSpatialTangentsAtKey(index, k.inSpatial, k.outSpatial);
    } catch (e6) {}
    try {
        if (typeof k.roving !== 'undefined') prop.setRovingAtKey(index, k.roving);
    } catch (e7) {}
    try {
        if (typeof k.label !== 'undefined') prop.setLabelAtKey(index, k.label);
    } catch (e8) {}
    try { prop.setSelectedAtKey(index, k.selected); } catch (e9) {}
}
$.global.tlRestoreKeyframe = tlRestoreKeyframe;

function tlSetKeyTimes(prop, times, newTimes) {
    var entries = [], i, idx;
    for (i = 0; i < times.length; i++) {
        idx = prop.nearestKeyIndex(times[i]);
        entries.push({ index: idx, key: tlReadKeyframe(prop, idx), newTime: newTimes[i] });
    }
    entries.sort(function (a, b) { return b.index - a.index; });
    for (i = 0; i < entries.length; i++) prop.removeKey(entries[i].index);
    entries.sort(function (a, b) { return a.newTime - b.newTime; });
    for (i = 0; i < entries.length; i++) {
        idx = prop.addKey(entries[i].newTime);
        entries[i].newIndex = idx;
        tlRestoreKeyframe(prop, idx, entries[i].key);
    }
    for (i = 0; i < entries.length; i++) {
        try { prop.setSelectedAtKey(entries[i].newIndex, entries[i].key.selected); } catch (e) {}
    }
}
$.global.tlSetKeyTimes = tlSetKeyTimes;

function tlApplyKeyDeltas(prop, times, deltas) {
    var i, changed = false, newTimes = [];
    for (i = 0; i < times.length; i++) {
        newTimes.push(times[i] + deltas[i]);
        if (deltas[i] !== 0) changed = true;
    }
    if (changed) tlSetKeyTimes(prop, times, newTimes);
    return newTimes;
}
$.global.tlApplyKeyDeltas = tlApplyKeyDeltas;

function tlRandomSlots(count, amount) {
    var slotCount = amount + 1;
    if (slotCount < count) slotCount = count;
    var pool = [], slots = [], i, pick;
    for (i = 0; i < slotCount; i++) pool.push(i);
    for (i = 0; i < count; i++) {
        pick = Math.floor(Math.random() * pool.length);
        slots.push(pool[pick]);
        pool.splice(pick, 1);
    }
    return slots;
}
$.global.tlRandomSlots = tlRandomSlots;

function tlAbs(n) {
    return n < 0 ? -n : n;
}
$.global.tlAbs = tlAbs;

function tlClearKeyTimingCache() {
    $.global.TL_TIMING_KEY_CACHE = null;
}
$.global.tlClearKeyTimingCache = tlClearKeyTimingCache;

// The cached key session may only bridge consecutive panel presses (AE can
// drop key/property selection right after our own edit). A stale session must
// never hijack a later, deliberate layer distribution - so it expires fast.
var TL_TIMING_SESSION_MS = 15000;

function tlTimingNow() {
    return new Date().getTime();
}
$.global.tlTimingNow = tlTimingNow;

// evalScript calls can hand us a fresh wrapper object for the same comp, so
// object identity is not a safe comparison - match by the stable item id.
function tlSameComp(a, b) {
    if (!a || !b) return false;
    try {
        if (typeof a.id !== 'undefined' && typeof b.id !== 'undefined') return a.id === b.id;
    } catch (e) {}
    return a === b;
}
$.global.tlSameComp = tlSameComp;

function tlRememberKeyTargets(comp, keys) {
    var cache = { comp: comp, at: tlTimingNow(), order: [], byIndex: {}, total: keys.total };
    var i, j, li, g, pr, saved;
    for (i = 0; i < keys.order.length; i++) {
        li = keys.order[i];
        g = keys.byIndex[li];
        cache.order.push(li);
        cache.byIndex[li] = { layer: g.layer, props: [] };
        for (j = 0; j < g.props.length; j++) {
            pr = g.props[j];
            saved = { prop: pr.prop, times: pr.times.slice(0) };
            cache.byIndex[li].props.push(saved);
        }
    }
    $.global.TL_TIMING_KEY_CACHE = cache;
}
$.global.tlRememberKeyTargets = tlRememberKeyTargets;

function tlCachedKeyTargetsForSelection(comp) {
    var cache = $.global.TL_TIMING_KEY_CACHE;
    var sel = comp.selectedLayers;
    var selected = {}, i, li;
    if (!cache || !sel || sel.length === 0) return null;
    // AE/CEP can stop reporting selected keys after a panel action; keep the
    // key-target session alive while the same comp and layer set are active -
    // but only briefly, so selecting the same layers later still means layers.
    if (typeof cache.at !== 'number' || tlTimingNow() - cache.at > TL_TIMING_SESSION_MS) {
        tlClearKeyTimingCache();
        return null;
    }
    if (!tlSameComp(cache.comp, comp)) {
        tlClearKeyTimingCache();
        return null;
    }
    if (sel.length !== cache.order.length) {
        tlClearKeyTimingCache();
        return null;
    }
    for (i = 0; i < sel.length; i++) selected[sel[i].index] = true;
    for (i = 0; i < cache.order.length; i++) {
        li = cache.order[i];
        if (!selected[li]) {
            tlClearKeyTimingCache();
            return null;
        }
    }
    return cache;
}
$.global.tlCachedKeyTargetsForSelection = tlCachedKeyTargetsForSelection;

function tlSequenceKeys(keys, step, fd) {
    var i, j, t, g, pr, deltas, d;
    if (keys.order.length >= 2) {
        for (i = 0; i < keys.order.length; i++) {
            g = keys.byIndex[keys.order[i]];
            d = i * step * fd;
            for (j = 0; j < g.props.length; j++) {
                pr = g.props[j];
                deltas = [];
                for (t = 0; t < pr.times.length; t++) deltas.push(d);
                pr.times = tlApplyKeyDeltas(pr.prop, pr.times, deltas);
            }
        }
        return { count: keys.order.length, unit: 'layer' };
    }
    g = keys.byIndex[keys.order[0]];
    for (j = 0; j < g.props.length; j++) {
        pr = g.props[j];
        deltas = [];
        for (t = 0; t < pr.times.length; t++) deltas.push(t * step * fd);
        pr.times = tlApplyKeyDeltas(pr.prop, pr.times, deltas);
    }
    return { count: keys.total, unit: 'key' };
}
$.global.tlSequenceKeys = tlSequenceKeys;

function tlAlignKeysToTime(keys, playhead) {
    var i, j, t, g, pr, delta, newTimes;
    for (i = 0; i < keys.order.length; i++) {
        g = keys.byIndex[keys.order[i]];
        for (j = 0; j < g.props.length; j++) {
            pr = g.props[j];
            delta = playhead - pr.times[0];
            newTimes = [];
            for (t = 0; t < pr.times.length; t++) newTimes.push(pr.times[t] + delta);
            tlSetKeyTimes(pr.prop, pr.times, newTimes);
            pr.times = newTimes;
        }
    }
    return { count: keys.total, unit: 'key' };
}
$.global.tlAlignKeysToTime = tlAlignKeysToTime;

function tlRandomizeKeys(keys, amount, step, fd) {
    var i, j, t, g, pr, slots, base, newTimes, unitStep;
    unitStep = tlAbs(step) * fd;
    for (i = 0; i < keys.order.length; i++) {
        g = keys.byIndex[keys.order[i]];
        for (j = 0; j < g.props.length; j++) {
            pr = g.props[j];
            base = pr.times[0];
            slots = tlRandomSlots(pr.times.length, amount);
            newTimes = [];
            for (t = 0; t < pr.times.length; t++) newTimes.push(base + slots[t] * unitStep);
            tlSetKeyTimes(pr.prop, pr.times, newTimes);
            pr.times = newTimes;
        }
    }
    return { count: keys.total, unit: 'key' };
}
$.global.tlRandomizeKeys = tlRandomizeKeys;

function tlSequenceLayers(sel, amount, step, fd) {
    var ordered = sel.slice(0), i, cursor, dup, made;
    if (ordered.length >= 2) {
        ordered.sort(function (a, b) { return a.index - b.index; });
        for (i = 0; i < ordered.length; i++) ordered[i].startTime = ordered[i].startTime + i * step * fd;
        return { count: ordered.length, mode: 'layers' };
    }
    cursor = ordered[0];
    made = 0;
    for (i = 1; i <= amount; i++) {
        dup = cursor.duplicate();
        dup.startTime = cursor.startTime + step * fd;
        cursor = dup;
        made++;
    }
    return { count: made, mode: 'duplicate', select: cursor };
}
$.global.tlSequenceLayers = tlSequenceLayers;

function tlAlignLayersToTime(sel, playhead) {
    for (var i = 0; i < sel.length; i++) sel[i].startTime = playhead;
    return { count: sel.length, mode: 'align' };
}
$.global.tlAlignLayersToTime = tlAlignLayersToTime;

function tlRandomizeLayers(sel, amount, step, fd) {
    var ordered = sel.slice(0), base = null, i, slots, unitStep;
    ordered.sort(function (a, b) { return a.index - b.index; });
    for (i = 0; i < ordered.length; i++) {
        if (base === null || ordered[i].startTime < base) base = ordered[i].startTime;
    }
    slots = tlRandomSlots(ordered.length, amount);
    unitStep = tlAbs(step) * fd;
    for (i = 0; i < ordered.length; i++) ordered[i].startTime = base + slots[i] * unitStep;
    return { count: ordered.length, mode: 'random' };
}
$.global.tlRandomizeLayers = tlRandomizeLayers;

function tlAdjustTiming(amountStr, stepFramesStr, mode) {
    var comp = $.global.tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var amount = parseInt(amountStr, 10);
    var step = parseInt(stepFramesStr, 10);
    if (isNaN(amount) || isNaN(step)) return jerr('Amount and Step must be whole numbers.');
    if (amount < 1) amount = 1;
    if (!mode) mode = 'sequence';
    if (mode !== 'align' && mode !== 'sequence' && mode !== 'reverse' && mode !== 'random') {
        return jerr('Unknown timing adjustment mode.');
    }
    if (mode !== 'align' && step === 0) return jerr('Step must not be zero.');
    var fd = comp.frameDuration;
    try {
        app.beginUndoGroup('DropComp Adjust Timing');

        var keys = tlCollectSelectedKeys(comp);
        if (keys.total === 0 && keys.noKeyPropertyCount > 0) {
            tlClearKeyTimingCache();
        } else if (keys.total === 0) {
            var cachedKeys = tlCachedKeyTargetsForSelection(comp);
            if (cachedKeys) keys = cachedKeys;
        }
        if (keys.total > 0) {
            var kr;
            if (mode === 'align') kr = tlAlignKeysToTime(keys, comp.time);
            else if (mode === 'random') kr = tlRandomizeKeys(keys, amount, step, fd);
            else kr = tlSequenceKeys(keys, mode === 'reverse' ? -tlAbs(step) : step, fd);
            tlRememberKeyTargets(comp, keys);
            app.endUndoGroup();
            return '{"ok":true,"count":' + kr.count + ',"mode":"' + (mode === 'align' || mode === 'random' ? mode : 'keys') + '","target":"keys","unit":"' + kr.unit + '"}';
        }

        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) {
            app.endUndoGroup();
            return jerr('Select layers, or keyframes to adjust.');
        }

        tlClearKeyTimingCache();
        var lr;
        if (mode === 'align') lr = tlAlignLayersToTime(sel, comp.time);
        else if (mode === 'random') lr = tlRandomizeLayers(sel, amount, step, fd);
        else lr = tlSequenceLayers(sel, amount, mode === 'reverse' ? -tlAbs(step) : step, fd);
        if (lr.select) $.global.tlSelectOnly(comp, lr.select);
        app.endUndoGroup();
        return '{"ok":true,"count":' + lr.count + ',"mode":"' + lr.mode + '","target":"layers"}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlAdjustTiming = tlAdjustTiming;

function tlSequence(numStr, stepFramesStr) {
    return tlAdjustTiming(numStr, stepFramesStr, 'sequence');
}
$.global.tlSequence = tlSequence;
