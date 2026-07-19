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
  download: '<svg></svg>',
  bookmark: '<svg></svg>',
  bookmarkFilled: '<svg></svg>',
  refresh: '<svg class="refresh"></svg>'
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

function findByAction(node, action, out) {
  out = out || [];
  if (node.dataset && node.dataset.action === action) out.push(node);
  (node.childNodes || []).forEach((c) => findByAction(c, action, out));
  return out;
}

function compGroups(comp) {
  return [{ category: 'ClientA', items: [comp] }];
}

test('grid comp cards with a thumbnail get a Regenerate hover action', () => {
  const container = makeNode('main');
  const comp = { uniqueId: 'c1', category: 'ClientA', name: 'UI card', thumbPath: '/lib/ClientA/c1/comp.png' };
  DCRender.render(container, compGroups(comp), prefs(), {}, {}, 'empty');

  const gens = findByAction(container, 'generate');
  assert.equal(gens.length, 1, 'exactly one generate control on a thumbed card');
  assert.equal(gens[0].tagName, 'BUTTON');
  assert.equal(gens[0].title, 'Regenerate thumbnail');
  assert.ok(String(gens[0].className).indexOf('card-action') !== -1, 'lives in the hover action row');
});

test('grid comp cards without a thumbnail keep the chip and gain the hover action', () => {
  const container = makeNode('main');
  const comp = { uniqueId: 'c2', category: 'ClientA', name: 'No thumb', thumbPath: null };
  DCRender.render(container, compGroups(comp), prefs(), {}, {}, 'empty');

  const gens = findByAction(container, 'generate');
  const classes = gens.map((n) => String(n.className));
  assert.ok(classes.some((c) => c.indexOf('generate-chip') !== -1), 'placeholder chip still present');
  assert.ok(classes.some((c) => c.indexOf('card-action') !== -1), 'hover action also present');
});

test('list view comp rows get the Regenerate action', () => {
  const container = makeNode('main');
  const comp = { uniqueId: 'c3', category: 'ClientA', name: 'Rowed', thumbPath: '/lib/ClientA/c3/comp.png' };
  DCRender.render(container, compGroups(comp), prefs({ viewMode: 'list' }), {}, {}, 'empty');

  const gens = findByAction(container, 'generate');
  assert.equal(gens.length, 1, 'list rows expose regenerate');
  assert.equal(gens[0].title, 'Regenerate thumbnail');
});

test('asset cards never get a generate action (grid and list)', () => {
  const grid = makeNode('main');
  const asset = { uniqueId: 'a1', category: 'Icons', name: 'logo.svg', ext: 'svg', filePath: '/lib/assets/logo.svg' };
  DCRender.render(grid, [{ category: 'Icons', items: [asset] }], prefs(), {}, {}, 'empty', 'asset');
  assert.equal(findByAction(grid, 'generate').length, 0, 'no generate on asset grid cards');

  const list = makeNode('main');
  DCRender.render(list, [{ category: 'Icons', items: [asset] }], prefs({ viewModeAssets: 'list' }), {}, {}, 'empty', 'asset');
  assert.equal(findByAction(list, 'generate').length, 0, 'no generate on asset rows');
});
