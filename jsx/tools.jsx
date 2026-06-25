// DropComp Tools host module (ExtendScript, ES3 only). Loaded by
// loadHostModules in hostscript.jsx; every function exports to $.global.
// Reuses jerr() and jsonEscape() defined in hostscript.jsx (host-global).
// TODO: split by concern - transform helpers + layout tools (anchor/align/
// distribute/sequence) vs pre-comp tools (precomp/decompose/make-unique).

function tlActiveComp() {
    var c = app.project ? app.project.activeItem : null;
    return (c && c instanceof CompItem) ? c : null;
}
$.global.tlActiveComp = tlActiveComp;

function tlSelectOnly(comp, layer) {
    for (var i = 1; i <= comp.numLayers; i++) {
        comp.layer(i).selected = (comp.layer(i) === layer);
    }
}
$.global.tlSelectOnly = tlSelectOnly;

// True for layers we can spatially anchor/move: footage, solid, comp, shape,
// text, null. Excludes cameras and lights (no sourceRect, can't be aligned).
// NOTE: ShapeLayer and TextLayer are NOT instanceof AVLayer in ExtendScript,
// so the old "instanceof AVLayer" filter silently skipped every shape/text
// layer. Exclude by camera/light instead. (Verified in AE 2026.)
function tlMovable(layer) {
    if (layer instanceof CameraLayer) return false;
    if (layer instanceof LightLayer) return false;
    return true;
}
$.global.tlMovable = tlMovable;

// Read Position tolerating Separate Dimensions. Reading the separated leader's
// the leader value happens to read fine, but writing it throws - so we go via the
// X/Y(/Z) separation followers, which is the only reliable write path.
function tlReadPos(layer) {
    var p = layer.property('ADBE Transform Group').property('ADBE Position');
    if (p.dimensionsSeparated) {
        var x = p.getSeparationFollower(0).value;
        var y = p.getSeparationFollower(1).value;
        if (layer.threeDLayer) return [x, y, p.getSeparationFollower(2).value];
        return [x, y];
    }
    return p.value;
}
$.global.tlReadPos = tlReadPos;

function tlCurrentTime(layer) {
    try {
        if (layer && layer.containingComp && typeof layer.containingComp.time !== 'undefined') return layer.containingComp.time;
    } catch (e) {}
    try {
        var c = app.project ? app.project.activeItem : null;
        if (c && typeof c.time !== 'undefined') return c.time;
    } catch (e2) {}
    return 0;
}
$.global.tlCurrentTime = tlCurrentTime;

function tlSetPropertyValue(prop, value, time) {
    if (prop.numKeys && prop.numKeys > 0) prop.setValueAtTime(time, value);
    else prop.setValue(value);
}
$.global.tlSetPropertyValue = tlSetPropertyValue;

// Write Position tolerating Separate Dimensions. z is optional (kept for 3D).
function tlWritePos(layer, x, y, z) {
    var p = layer.property('ADBE Transform Group').property('ADBE Position');
    var time = tlCurrentTime(layer);
    if (p.dimensionsSeparated) {
        tlSetPropertyValue(p.getSeparationFollower(0), x, time);
        tlSetPropertyValue(p.getSeparationFollower(1), y, time);
        if (layer.threeDLayer) {
            var zp = p.getSeparationFollower(2);
            tlSetPropertyValue(zp, (z === undefined || z === null) ? zp.value : z, time);
        }
        return;
    }
    var cur = p.value;
    if (cur.length === 3) tlSetPropertyValue(p, [x, y, (z === undefined || z === null) ? cur[2] : z], time);
    else tlSetPropertyValue(p, [x, y], time);
}
$.global.tlWritePos = tlWritePos;

// Comp-space [x,y] of a layer's anchor, summing positions up the parent chain.
// Exact when parents have no rotation and 100% scale (a child-space translation
// then equals a comp-space translation, so tlShift on the child still works);
// approximate under parent rotation/scale. tlChainApprox() flags that case.
function tlCompPos(layer) {
    var p = tlReadPos(layer);
    var x = p[0], y = p[1];
    var par = layer.parent;
    while (par) {
        // A child's position is expressed in the parent's space, whose origin is
        // the parent's ANCHOR (not [0,0]). So accumulate (position - anchor) per
        // ancestor, not just position - otherwise an anchor-offset parent (e.g. a
        // null whose anchor was moved) throws the comp-space bounds off.
        var pp = tlReadPos(par);
        var pa = par.property('ADBE Transform Group').property('ADBE Anchor Point').value;
        x += pp[0] - pa[0]; y += pp[1] - pa[1];
        par = par.parent;
    }
    return [x, y];
}
$.global.tlCompPos = tlCompPos;

// True if any ancestor is a camera or light. A 2D layer parented to one becomes
// 3D and follows the camera; its comp-space 2D bounds can't be derived by summing
// positions (a camera's Position is its eye/world location), so tlLayerBounds
// skips these layers rather than aligning them to a garbage location.
function tlHasFixedAncestor(layer) {
    var par = layer.parent;
    while (par) {
        if (par instanceof CameraLayer || par instanceof LightLayer) return true;
        par = par.parent;
    }
    return false;
}
$.global.tlHasFixedAncestor = tlHasFixedAncestor;

// True if any ancestor is rotated or not at 100% scale, making comp-space bounds
// for a parented layer approximate (we still move it, but flag it to the user).
function tlChainApprox(layer) {
    var par = layer.parent;
    while (par) {
        try {
            var t = par.property('ADBE Transform Group');
            var sp = t.property('ADBE Scale');
            if (sp) { var s = sp.value; if (s[0] !== 100 || s[1] !== 100) return true; }
            var rp = t.property('ADBE Rotate Z');
            if (rp && rp.value !== 0) return true;
        } catch (e) {
            return true; // unreadable parent transform - treat as approximate
        }
        par = par.parent;
    }
    return false;
}
$.global.tlChainApprox = tlChainApprox;

function tlCreateLayer(kind) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    try {
        var parentTargets = [];
        if (kind === 'null') {
            var selected = comp.selectedLayers;
            if (selected) {
                for (var s = 0; s < selected.length; s++) parentTargets.push(selected[s]);
            }
        }
        app.beginUndoGroup('DropComp Create Layer');
        var layer = null;
        if (kind === 'null') {
            layer = comp.layers.addNull();
            var anchorProp = layer.property('ADBE Transform Group').property('ADBE Anchor Point');
            var anchor = anchorProp.value;
            if (anchor.length === 3) anchorProp.setValue([50, 50, anchor[2]]);
            else anchorProp.setValue([50, 50]);
            for (var p = 0; p < parentTargets.length; p++) parentTargets[p].parent = layer;
        } else if (kind === 'adjustment') {
            // white solid matches AE's native adjustment layer; the color is invisible while adjustmentLayer is true
            layer = comp.layers.addSolid([1, 1, 1], 'Adjustment Layer', comp.width, comp.height, comp.pixelAspect);
            layer.adjustmentLayer = true;
        } else if (kind === 'solid') {
            layer = comp.layers.addSolid([0.5, 0.5, 0.5], 'Solid', comp.width, comp.height, comp.pixelAspect);
        } else if (kind === 'camera') {
            layer = comp.layers.addCamera('Camera 1', [comp.width / 2, comp.height / 2]);
        } else {
            app.endUndoGroup();
            return jerr('Unknown layer type.');
        }
        layer.startTime = comp.time;
        tlSelectOnly(comp, layer);
        app.endUndoGroup();
        return '{"ok":true,"name":"' + jsonEscape(layer.name) + '"}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlCreateLayer = tlCreateLayer;

function tlSetAnchor(fxStr, fyStr) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    var fx = parseFloat(fxStr), fy = parseFloat(fyStr);
    if (isNaN(fx) || isNaN(fy)) return jerr('Bad anchor position.');
    try {
        app.beginUndoGroup('DropComp Set Anchor');
        var count = 0, skippedFixed = 0, skippedEmpty = 0, lastErr = '';
        for (var i = 0; i < sel.length; i++) {
            var layer = sel[i];
            if (!tlMovable(layer)) { skippedFixed++; continue; }
            try {
                var rect = layer.sourceRectAtTime(comp.time, false);
                if (rect.width === 0 && rect.height === 0) { skippedEmpty++; continue; }
                var t = layer.property('ADBE Transform Group');
                var anchorProp = t.property('ADBE Anchor Point');
                var scale = t.property('ADBE Scale').value;
                var oldA = anchorProp.value;
                var newAX = rect.left + rect.width * fx;
                var newAY = rect.top + rect.height * fy;
                var dx = (newAX - oldA[0]) * (scale[0] / 100);
                var dy = (newAY - oldA[1]) * (scale[1] / 100);
                var time = tlCurrentTime(layer);
                if (oldA.length === 3) tlSetPropertyValue(anchorProp, [newAX, newAY, oldA[2]], time);
                else tlSetPropertyValue(anchorProp, [newAX, newAY], time);
                var pos = tlReadPos(layer);
                if (pos.length === 3) tlWritePos(layer, pos[0] + dx, pos[1] + dy, pos[2]);
                else tlWritePos(layer, pos[0] + dx, pos[1] + dy);
                count++;
            } catch (eL) { lastErr = eL.toString(); }
        }
        app.endUndoGroup();
        if (count === 0) {
            if (lastErr) return jerr('Could not set anchor: ' + lastErr);
            if (skippedEmpty > 0 && skippedFixed === 0) return jerr('Layer has no visible bounds (an empty shape?) - nothing to anchor.');
            return jerr('Select a layer with visible bounds. Cameras, lights, and audio layers have no anchor.');
        }
        return '{"ok":true,"count":' + count + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlSetAnchor = tlSetAnchor;

// On-screen bounding box ignoring rotation (common 2D case is exact). Returns
// null for layers with no measurable bounds (cameras/lights/audio throw on
// sourceRectAtTime; empty shapes report a 0x0 rect) so callers can skip them.
// pos is read in PARENT space; parented layers are converted by the caller.
function tlLayerBounds(comp, layer) {
    var rect;
    try { rect = layer.sourceRectAtTime(comp.time, false); } catch (e) { return null; }
    if (rect.width === 0 && rect.height === 0) return null;
    if (tlHasFixedAncestor(layer)) return null;
    var t = layer.property('ADBE Transform Group');
    var pos = tlCompPos(layer);
    var anc = t.property('ADBE Anchor Point').value;
    var scale = t.property('ADBE Scale').value;
    var sx = scale[0] / 100, sy = scale[1] / 100;
    var left = pos[0] + (rect.left - anc[0]) * sx;
    var top = pos[1] + (rect.top - anc[1]) * sy;
    var w = rect.width * sx, h = rect.height * sy;
    return { left: left, top: top, right: left + w, bottom: top + h, w: w, h: h };
}
$.global.tlLayerBounds = tlLayerBounds;

function tlShift(layer, dx, dy) {
    var pos = tlReadPos(layer);
    if (pos.length === 3) tlWritePos(layer, pos[0] + dx, pos[1] + dy, pos[2]);
    else tlWritePos(layer, pos[0] + dx, pos[1] + dy);
}
$.global.tlShift = tlShift;

function tlAlign(mode) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Align');
        var ref, ba;
        if (sel.length >= 2) {
            ref = { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 };
            for (var a = 0; a < sel.length; a++) {
                if (!tlMovable(sel[a])) continue;
                ba = tlLayerBounds(comp, sel[a]);
                if (!ba) continue;
                if (ba.left < ref.left) ref.left = ba.left;
                if (ba.top < ref.top) ref.top = ba.top;
                if (ba.right > ref.right) ref.right = ba.right;
                if (ba.bottom > ref.bottom) ref.bottom = ba.bottom;
            }
            if (ref.right < ref.left) {
                app.endUndoGroup();
                return jerr('Nothing to align to. Cameras, lights, and empty layers have no bounds.');
            }
        } else {
            ref = { left: 0, top: 0, right: comp.width, bottom: comp.height };
        }
        var count = 0, approx = 0;
        for (var i = 0; i < sel.length; i++) {
            if (!tlMovable(sel[i])) continue;
            var b = tlLayerBounds(comp, sel[i]);
            if (!b) continue;
            var dx = 0, dy = 0;
            if (mode === 'left') dx = ref.left - b.left;
            else if (mode === 'right') dx = ref.right - b.right;
            else if (mode === 'center') dx = (ref.left + ref.right) / 2 - (b.left + b.right) / 2;
            else if (mode === 'top') dy = ref.top - b.top;
            else if (mode === 'bottom') dy = ref.bottom - b.bottom;
            else if (mode === 'middle') dy = (ref.top + ref.bottom) / 2 - (b.top + b.bottom) / 2;
            tlShift(sel[i], dx, dy);
            if (tlChainApprox(sel[i])) approx++;
            count++;
        }
        app.endUndoGroup();
        if (count === 0) return jerr('Select a layer with visible bounds to align.');
        return '{"ok":true,"count":' + count + (approx ? ',"approx":' + approx : '') + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlAlign = tlAlign;

function tlDistribute(axis) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length < 3) return jerr('Select 3 or more layers to distribute.');
    var horiz = (axis !== 'vertical');
    try {
        app.beginUndoGroup('DropComp Distribute');
        var items = [];
        for (var i = 0; i < sel.length; i++) {
            if (!tlMovable(sel[i])) continue;
            var b = tlLayerBounds(comp, sel[i]);
            if (!b) continue;
            items.push({ layer: sel[i], c: horiz ? (b.left + b.right) / 2 : (b.top + b.bottom) / 2 });
        }
        if (items.length < 3) { app.endUndoGroup(); return jerr('Select 3 or more layers with visible bounds to distribute.'); }
        items.sort(function (p, q) { return p.c - q.c; });
        var first = items[0].c, last = items[items.length - 1].c;
        var span = last - first;
        var n = items.length - 1;
        for (var k = 1; k < n; k++) {
            var target = first + span * (k / n);
            var d = target - items[k].c;
            if (horiz) tlShift(items[k].layer, d, 0);
            else tlShift(items[k].layer, 0, d);
        }
        var approx = 0;
        for (var m = 0; m < items.length; m++) { if (tlChainApprox(items[m].layer)) approx++; }
        app.endUndoGroup();
        return '{"ok":true,"count":' + items.length + (approx ? ',"approx":' + approx : '') + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlDistribute = tlDistribute;

function tlReset() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Recenter');
        var count = 0, approx = 0;
        for (var i = 0; i < sel.length; i++) {
            if (!tlMovable(sel[i])) continue;
            var b = tlLayerBounds(comp, sel[i]);
            if (!b) continue;
            tlShift(sel[i], comp.width / 2 - (b.left + b.right) / 2, comp.height / 2 - (b.top + b.bottom) / 2);
            if (tlChainApprox(sel[i])) approx++;
            count++;
        }
        app.endUndoGroup();
        if (count === 0) return jerr('Select a layer with visible bounds to recenter.');
        return '{"ok":true,"count":' + count + (approx ? ',"approx":' + approx : '') + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlReset = tlReset;

// --- Sequence -------------------------------------------------------------
// The mode is chosen by what's selected when the button is pressed:
//   1. selected keyframes -> cascade those keys (across layers, or spread a
//      single layer's keys). Shifts are RELATIVE, so pressing again keeps
//      pushing them further out.
//   2. two or more layers -> stagger their start times, also relative.
//   3. one layer          -> duplicate it down the timeline and leave the last
//      copy selected, so repeated presses extend the chain instead of piling
//      copies on top of the original.

// Gather selected keyframes grouped by their layer, ordered top-to-bottom.
// Returns { order:[layerIndex..], byIndex:{ idx:{layer, props:[{prop,times}]} },
// total } where each times array holds the current (ascending) key times.
function tlCollectSelectedKeys(comp) {
    var res = { order: [], byIndex: {}, total: 0 };
    var props = comp.selectedProperties;
    if (!props) return res;
    for (var i = 0; i < props.length; i++) {
        var p = props[i];
        var sel = null;
        try { sel = p.selectedKeys; } catch (e) { sel = null; }
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

// Move a property's keys (located by their current times) by per-key deltas.
// times/deltas are aligned, times ascending. Process from the end that the
// keys are travelling toward so a moved key never lands on an unprocessed one.
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
        if (typeof k.inType !== 'undefined') prop.setInterpolationTypeAtKey(index, k.inType, k.outType);
    } catch (e0) {}
    try {
        if (typeof k.inEase !== 'undefined') prop.setTemporalEaseAtKey(index, k.inEase, k.outEase);
    } catch (e1) {}
    try {
        if (typeof k.temporalContinuous !== 'undefined') prop.setTemporalContinuousAtKey(index, k.temporalContinuous);
    } catch (e2) {}
    try {
        if (typeof k.temporalAuto !== 'undefined') prop.setTemporalAutoBezierAtKey(index, k.temporalAuto);
    } catch (e3) {}
    try {
        if (typeof k.inSpatial !== 'undefined') prop.setSpatialTangentsAtKey(index, k.inSpatial, k.outSpatial);
    } catch (e4) {}
    try {
        if (typeof k.spatialContinuous !== 'undefined') prop.setSpatialContinuousAtKey(index, k.spatialContinuous);
    } catch (e5) {}
    try {
        if (typeof k.spatialAuto !== 'undefined') prop.setSpatialAutoBezierAtKey(index, k.spatialAuto);
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

function tlMoveKeyframe(prop, fromTime, toTime) {
    var oldIndex = prop.nearestKeyIndex(fromTime);
    var k = tlReadKeyframe(prop, oldIndex);
    prop.removeKey(oldIndex);
    var newIndex = prop.addKey(toTime);
    tlRestoreKeyframe(prop, newIndex, k);
}
$.global.tlMoveKeyframe = tlMoveKeyframe;

function tlApplyKeyDeltas(prop, times, deltas, later) {
    var i;
    if (later) {
        for (i = times.length - 1; i >= 0; i--) {
            if (deltas[i] === 0) continue;
            tlMoveKeyframe(prop, times[i], times[i] + deltas[i]);
        }
    } else {
        for (i = 0; i < times.length; i++) {
            if (deltas[i] === 0) continue;
            tlMoveKeyframe(prop, times[i], times[i] + deltas[i]);
        }
    }
}
$.global.tlApplyKeyDeltas = tlApplyKeyDeltas;

// Cascade selected keyframes. 2+ layers: layer at ordinal i shifts by i*step.
// One layer: spread each property's own keys (the k-th key by k*step).
function tlSequenceKeys(keys, step, fd) {
    var later = step >= 0;
    var i, j, t, g, pr, deltas, d;
    if (keys.order.length >= 2) {
        for (i = 0; i < keys.order.length; i++) {
            g = keys.byIndex[keys.order[i]];
            d = i * step * fd;
            for (j = 0; j < g.props.length; j++) {
                pr = g.props[j];
                deltas = [];
                for (t = 0; t < pr.times.length; t++) deltas.push(d);
                tlApplyKeyDeltas(pr.prop, pr.times, deltas, later);
            }
        }
        return { count: keys.order.length, unit: 'layer' };
    }
    g = keys.byIndex[keys.order[0]];
    for (j = 0; j < g.props.length; j++) {
        pr = g.props[j];
        deltas = [];
        for (t = 0; t < pr.times.length; t++) deltas.push(t * step * fd);
        tlApplyKeyDeltas(pr.prop, pr.times, deltas, later);
    }
    return { count: keys.total, unit: 'key' };
}
$.global.tlSequenceKeys = tlSequenceKeys;

function tlSequence(numStr, stepFramesStr) {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var num = parseInt(numStr, 10);
    var step = parseInt(stepFramesStr, 10);
    if (isNaN(num) || isNaN(step)) return jerr('Count and Step must be whole numbers.');
    if (step === 0) return jerr('Step must not be zero.');
    if (num < 1) num = 1;
    var fd = comp.frameDuration;
    try {
        app.beginUndoGroup('DropComp Sequence');

        // 1) Keyframes selected -> sequence the keys, leave the layers put.
        var keys = tlCollectSelectedKeys(comp);
        if (keys.total > 0) {
            var kr = tlSequenceKeys(keys, step, fd);
            app.endUndoGroup();
            return '{"ok":true,"count":' + kr.count + ',"mode":"keys","unit":"' + kr.unit + '"}';
        }

        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) {
            app.endUndoGroup();
            return jerr('Select layers, or keyframes to sequence.');
        }

        // 2) Multiple layers -> stagger start times relative to where they are,
        //    so each press keeps pushing them further apart.
        if (sel.length >= 2) {
            var ordered = sel.slice(0);
            ordered.sort(function (a, b) { return a.index - b.index; });
            for (var i = 0; i < ordered.length; i++) {
                ordered[i].startTime = ordered[i].startTime + i * step * fd;
            }
            app.endUndoGroup();
            return '{"ok":true,"count":' + ordered.length + ',"mode":"layers"}';
        }

        // 3) One layer -> duplicate down the timeline. Each new copy sits Step
        //    frames after the previous one; the last copy stays selected so the
        //    next press continues the chain.
        var cursor = sel[0];
        var made = 0;
        for (var c = 1; c <= num; c++) {
            var dup = cursor.duplicate();
            dup.startTime = cursor.startTime + step * fd;
            cursor = dup;
            made++;
        }
        tlSelectOnly(comp, cursor);
        app.endUndoGroup();
        return '{"ok":true,"count":' + made + ',"mode":"duplicate"}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlSequence = tlSequence;

function tlPreComp() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Pre-compose');
        var idx = [];
        for (var i = 0; i < sel.length; i++) idx.push(sel[i].index);
        var name = sel[0].name + ' Comp';
        // Do NOT openInViewer() - that hijacks the user's viewer/timeline to the
        // new precomp and loses their context. The new precomp layer is already
        // in the source comp's timeline, which stays active.
        var newComp = comp.layers.precompose(idx, name, true);
        app.endUndoGroup();
        return '{"ok":true,"name":"' + jsonEscape(newComp.name) + '","count":' + idx.length + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlPreComp = tlPreComp;

function tlMultiPreComp() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Multi Pre-compose');
        var targets = [];
        for (var i = 0; i < sel.length; i++) targets.push({ index: sel[i].index, name: sel[i].name });
        // precompose highest index first: single-layer precompose with moveAllAttributes
        // replaces the layer in place, but processing top-down keeps the remaining captured
        // indices valid even if a slot ever shifts (matches spec section 4).
        targets.sort(function (a, b) { return b.index - a.index; });
        var made = 0;
        for (var j = 0; j < targets.length; j++) {
            comp.layers.precompose([targets[j].index], targets[j].name + ' Comp', true);
            made++;
        }
        app.endUndoGroup();
        return '{"ok":true,"count":' + made + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlMultiPreComp = tlMultiPreComp;

function tlIndependent() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return jerr('Select at least one layer.');
    try {
        app.beginUndoGroup('DropComp Make Unique');
        var count = 0, ignored = 0;
        for (var i = 0; i < sel.length; i++) {
            var layer = sel[i];
            if (layer.source && layer.source instanceof CompItem) {
                try {
                    var dup = layer.source.duplicate();
                    layer.replaceSource(dup, false);
                    count++;
                } catch (eL) { ignored++; }
            } else {
                ignored++;
            }
        }
        app.endUndoGroup();
        if (count === 0) return jerr('Select at least one precomp layer to make unique.');
        return '{"ok":true,"count":' + count + (ignored ? ',"ignored":' + ignored : '') + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlIndependent = tlIndependent;

function tlCopyProp(fromGroup, toGroup, mn) {
    var pf = fromGroup.property(mn), pt = toGroup.property(mn);
    if (pf && pt) { try { pt.setValue(pf.value); } catch (e) {} }
}
$.global.tlCopyProp = tlCopyProp;

// Copy the GEOMETRIC transform (position/scale/rotation, plus 3D flag and 3D
// rotations) from a precomp layer onto the carrier null. NOTE: opacity is NOT
// copied - opacity does not inherit through parenting, so a value on the null
// would do nothing; tlDecompose applies it to the copied layers instead.
function tlCopyTransform(fromLayer, toLayer) {
    if (fromLayer.threeDLayer) toLayer.threeDLayer = true;
    var f = fromLayer.property('ADBE Transform Group');
    var t = toLayer.property('ADBE Transform Group');
    var p = tlReadPos(fromLayer);
    if (p.length === 3) tlWritePos(toLayer, p[0], p[1], p[2]);
    else tlWritePos(toLayer, p[0], p[1]);
    // Copy the anchor too: the null pivots scale/rotation about its OWN anchor,
    // and a precomp layer's anchor sits at the source-comp centre (not [0,0]).
    // Without this, any rotated/scaled decompose lands the contents off-pivot.
    var a = f.property('ADBE Anchor Point').value;
    if (a.length === 3) t.property('ADBE Anchor Point').setValue([a[0], a[1], a[2]]);
    else t.property('ADBE Anchor Point').setValue([a[0], a[1]]);
    t.property('ADBE Scale').setValue(f.property('ADBE Scale').value);
    t.property('ADBE Rotate Z').setValue(f.property('ADBE Rotate Z').value);
    if (fromLayer.threeDLayer) {
        tlCopyProp(f, t, 'ADBE Orientation');
        tlCopyProp(f, t, 'ADBE Rotate X');
        tlCopyProp(f, t, 'ADBE Rotate Y');
    }
}
$.global.tlCopyTransform = tlCopyTransform;

// A precomp layer needs no carrier null when its transform doesn't alter its
// contents: position equals anchor (so contents map 1:1), no scale/rotation,
// full opacity, no keyframes, and not 3D. (Verified: a fresh precomp layer has
// anchor == position == comp center, NOT [0,0].)
function tlIsIdentityTransform(layer) {
    if (layer.threeDLayer) return false;
    var t = layer.property('ADBE Transform Group');
    var ancP = t.property('ADBE Anchor Point');
    var posP = t.property('ADBE Position');
    var sclP = t.property('ADBE Scale');
    var rotP = t.property('ADBE Rotate Z');
    var opP = t.property('ADBE Opacity');
    if (ancP.numKeys || posP.numKeys || sclP.numKeys || rotP.numKeys || opP.numKeys) return false;
    if (opP.value !== 100 || rotP.value !== 0) return false;
    var s = sclP.value;
    if (s[0] !== 100 || s[1] !== 100) return false;
    var p = tlReadPos(layer), a = ancP.value;
    if (Math.abs(p[0] - a[0]) > 0.001 || Math.abs(p[1] - a[1]) > 0.001) return false;
    return true;
}
$.global.tlIsIdentityTransform = tlIsIdentityTransform;

// Attributes on a precomp layer that decompose cannot faithfully inline (they
// composite the precomp as a group). Returned as a human list for a warning.
function tlDecomposeLossy(layer) {
    var bad = [];
    var op = layer.property('ADBE Transform Group').property('ADBE Opacity');
    if (op.numKeys > 0) bad.push('animated opacity');
    try { if (layer.property('ADBE Effect Parade').numProperties > 0) bad.push('effects'); } catch (e1) {}
    try { if (layer.property('ADBE Mask Parade').numProperties > 0) bad.push('masks'); } catch (e2) {}
    try { if (layer.timeRemapEnabled) bad.push('time remap'); } catch (e3) {}
    try { if (layer.blendingMode !== BlendingMode.NORMAL) bad.push('blend mode'); } catch (e4) {}
    try { if (layer.trackMatteType && layer.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) bad.push('track matte'); } catch (e5) {}
    return bad.join(', ');
}
$.global.tlDecomposeLossy = tlDecomposeLossy;

function tlDecompose() {
    var comp = tlActiveComp();
    if (!comp) return jerr('Open a composition first.');
    var sel = comp.selectedLayers;
    if (!sel || sel.length !== 1) return jerr('Select a single precomp layer.');
    var layer = sel[0];
    if (!(layer.source && layer.source instanceof CompItem)) return jerr('Selected layer is not a precomp.');
    if (parseFloat(app.version) < 22) return jerr('Decompose needs After Effects 2022 or newer.');
    var src = layer.source;
    try {
        app.beginUndoGroup('DropComp Decompose');
        var identity = tlIsIdentityTransform(layer);
        var warn = tlDecomposeLossy(layer);
        var opProp = layer.property('ADBE Transform Group').property('ADBE Opacity');
        // Only bake a static, non-full opacity onto the copies. Animated opacity
        // can't be reproduced this way (it's reported via warn), so leave it off
        // rather than freezing the current-frame value onto every copy.
        var op = (opProp.numKeys === 0) ? opProp.value : 100;
        // Carrier null starts at IDENTITY so parenting doesn't shift the copies;
        // we apply the precomp's transform to it AFTER parenting so the children
        // follow it. (Transforming the null before parenting would be cancelled
        // out by AE's parent-time position preservation.)
        var carrier = null;
        if (!identity) {
            carrier = comp.layers.addNull();
            carrier.startTime = layer.startTime;
            // addNull() places the null at the comp centre. Zero it to TRUE
            // identity before parenting so each copy keeps its precomp-space
            // position; tlCopyTransform then applies the real transform (incl.
            // anchor) and the copies follow it exactly, even under scale/rotation.
            carrier.property('ADBE Transform Group').property('ADBE Position').setValue([0, 0]);
        }
        var copies = [];
        for (var i = src.numLayers; i >= 1; i--) {
            src.layer(i).copyToComp(comp);
            copies.push(comp.layer(1));
        }
        for (var j = 0; j < copies.length; j++) {
            try {
                copies[j].startTime = copies[j].startTime + layer.startTime;
                if (carrier) copies[j].parent = carrier;
                if (op !== 100) {
                    var oprop = copies[j].property('ADBE Transform Group').property('ADBE Opacity');
                    if (oprop.numKeys === 0) oprop.setValue(oprop.value * op / 100);
                }
            } catch (eP) {}
        }
        if (carrier) tlCopyTransform(layer, carrier);
        layer.remove();
        app.endUndoGroup();
        var out = '{"ok":true,"count":' + copies.length + ',"null":' + (carrier ? 'true' : 'false');
        if (warn) out += ',"warn":"' + jsonEscape(warn) + '"';
        return out + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return jerr(e.toString());
    }
}
$.global.tlDecompose = tlDecompose;
