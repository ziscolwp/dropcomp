const test = require('node:test');
const assert = require('node:assert/strict');

global.DCState = require('../panel/js/state.js');
global.DCIcons = {
  chevron: '<svg></svg>',
  photoOff: '<svg class="photo-off"></svg>',
  star: '<svg></svg>',
  starFilled: '<svg></svg>',
  pencil: '<svg></svg>',
  camera: '<svg></svg>',
  folder: '<svg></svg>',
  trash: '<svg></svg>',
  download: '<svg></svg>'
};

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    dataset: {},
    attributes: {},
    childNodes: [],
    children: [],
    parentNode: null,
    textContent: '',
    title: '',
    appendChild(child) {
      child.parentNode = node;
      node.childNodes.push(child);
      node.children.push(child);
      return child;
    },
    replaceChild(newChild, oldChild) {
      const i = node.childNodes.indexOf(oldChild);
      if (i !== -1) {
        newChild.parentNode = node;
        node.childNodes[i] = newChild;
        node.children[i] = newChild;
      }
      return oldChild;
    },
    setAttribute(k, v) { node.attributes[k] = String(v); }
  };
  let html = '';
  Object.defineProperty(node, 'innerHTML', {
    get() { return html; },
    set(v) {
      html = String(v);
      if (html === '') {
        node.childNodes = [];
        node.children = [];
      }
    }
  });
  return node;
}

global.document = { createElement: makeNode };
const DCRender = require('../panel/js/render.js');

function prefs(overrides) {
  return Object.assign(DCState.defaultPrefs(), {
    showNames: false,
    showMeta: false,
    collapsed: [],
    collapsedAssets: [],
    folderColumns: false
  }, overrides || {});
}

function assetGroups(asset) {
  return [{ category: 'Icons', items: [asset] }];
}

function findByTag(node, tagName, out) {
  out = out || [];
  if (node.tagName === tagName) out.push(node);
  (node.childNodes || []).forEach((c) => findByTag(c, tagName, out));
  return out;
}

function findByClass(node, cls, out) {
  out = out || [];
  if (String(node.className).split(' ').indexOf(cls) !== -1) out.push(node);
  (node.childNodes || []).forEach((c) => findByClass(c, cls, out));
  return out;
}

test('svg assets render an <img> preview in the grid', () => {
  const container = makeNode('main');
  const asset = { uniqueId: 's1', category: 'Icons', name: 'logo.svg', ext: 'svg', filePath: '/lib/assets/logo.svg', addedAt: 5 };
  DCRender.render(container, assetGroups(asset), prefs(), {}, {}, 'empty', 'asset');

  const imgs = findByTag(container, 'IMG');
  assert.equal(imgs.length, 1, 'svg asset card must contain an img preview');
  assert.match(imgs[0].src, /^file:\/\/\/.*logo\.svg\?t=5$/, 'img points at the svg file with a cache-bust');
  assert.equal(findByClass(container, 'ext-badge').length, 0, 'no ext badge when the preview renders');
});

test('a failing svg preview falls back to the SVG extension badge', () => {
  const container = makeNode('main');
  const asset = { uniqueId: 's2', category: 'Icons', name: 'broken.svg', ext: 'svg', filePath: '/lib/assets/broken.svg' };
  DCRender.render(container, assetGroups(asset), prefs(), {}, {}, 'empty', 'asset');

  const img = findByTag(container, 'IMG')[0];
  assert.ok(img, 'svg asset starts as an img preview');
  img.onerror();

  assert.equal(findByTag(container, 'IMG').length, 0, 'broken img is replaced');
  const badges = findByClass(container, 'ext-badge');
  assert.equal(badges.length, 1, 'fallback shows the extension badge');
  assert.equal(badges[0].textContent, 'SVG');
});

test('non-renderable asset formats keep the extension badge placeholder', () => {
  const container = makeNode('main');
  const asset = { uniqueId: 'p1', category: 'Icons', name: 'art.psd', ext: 'psd', filePath: '/lib/assets/art.psd' };
  DCRender.render(container, assetGroups(asset), prefs(), {}, {}, 'empty', 'asset');

  assert.equal(findByTag(container, 'IMG').length, 0, 'psd never gets an img preview');
  const badges = findByClass(container, 'ext-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, 'PSD');
});

test('png previews are unchanged (no regression)', () => {
  const container = makeNode('main');
  const asset = { uniqueId: 'g1', category: 'Icons', name: 'pic.png', ext: 'png', filePath: '/lib/assets/pic.png', addedAt: 9 };
  DCRender.render(container, assetGroups(asset), prefs(), {}, {}, 'empty', 'asset');

  const imgs = findByTag(container, 'IMG');
  assert.equal(imgs.length, 1);
  assert.match(imgs[0].src, /pic\.png\?t=9$/);
});

test('svg assets render an <img> preview in list view too', () => {
  const container = makeNode('main');
  const asset = { uniqueId: 's3', category: 'Icons', name: 'logo.svg', ext: 'svg', filePath: '/lib/assets/logo.svg' };
  DCRender.render(container, assetGroups(asset), prefs({ viewModeAssets: 'list' }), {}, {}, 'empty', 'asset');

  const imgs = findByTag(container, 'IMG');
  assert.equal(imgs.length, 1, 'list row must contain an img preview for svg');
  imgs[0].onerror();
  const badges = findByClass(container, 'ext-badge');
  assert.equal(badges.length, 1, 'list-row fallback shows the extension badge');
  assert.equal(badges[0].textContent, 'SVG');
});

test('aep shape assets render their thumbnail sidecar when present', () => {
  const container = makeNode('main');
  const asset = {
    uniqueId: 'Shapes/Star.aep', category: 'Shapes', name: 'Star', ext: 'aep',
    filePath: '/L/Assets/Shapes/Star.aep',
    thumbPath: '/L/Assets/Shapes/.thumb_Star.aep.png', addedAt: 42,
  };
  DCRender.render(container, assetGroups(asset), prefs(), {}, {}, 'empty', 'asset');

  const imgs = findByTag(container, 'IMG');
  assert.equal(imgs.length, 1, 'shape asset card must render its sidecar thumbnail');
  assert.match(imgs[0].src, /\.thumb_Star\.aep\.png\?t=42$/, 'img points at the sidecar with a cache-bust');
});

test('aep shape assets without a thumbnail show a SHAPE badge', () => {
  const container = makeNode('main');
  const asset = {
    uniqueId: 'Shapes/Star.aep', category: 'Shapes', name: 'Star', ext: 'aep',
    filePath: '/L/Assets/Shapes/Star.aep',
  };
  DCRender.render(container, assetGroups(asset), prefs(), {}, {}, 'empty', 'asset');

  assert.equal(findByTag(container, 'IMG').length, 0, 'no img without a sidecar');
  const badges = findByClass(container, 'ext-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, 'SHAPE', 'badge says SHAPE, not AEP');
});

test('a broken shape thumbnail falls back to the SHAPE badge', () => {
  const container = makeNode('main');
  const asset = {
    uniqueId: 'Shapes/Star.aep', category: 'Shapes', name: 'Star', ext: 'aep',
    filePath: '/L/Assets/Shapes/Star.aep',
    thumbPath: '/L/Assets/Shapes/.thumb_Star.aep.png',
  };
  DCRender.render(container, assetGroups(asset), prefs(), {}, {}, 'empty', 'asset');

  const img = findByTag(container, 'IMG')[0];
  assert.ok(img, 'shape asset starts as an img preview');
  img.onerror();
  const badges = findByClass(container, 'ext-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, 'SHAPE');
});

test('aep shape assets render their thumbnail in list view too', () => {
  const container = makeNode('main');
  const asset = {
    uniqueId: 'Shapes/Star.aep', category: 'Shapes', name: 'Star', ext: 'aep',
    filePath: '/L/Assets/Shapes/Star.aep',
    thumbPath: '/L/Assets/Shapes/.thumb_Star.aep.png', addedAt: 7,
  };
  DCRender.render(container, assetGroups(asset), prefs({ viewModeAssets: 'list' }), {}, {}, 'empty', 'asset');

  const imgs = findByTag(container, 'IMG');
  assert.equal(imgs.length, 1);
  assert.match(imgs[0].src, /\.thumb_Star\.aep\.png\?t=7$/);
});
