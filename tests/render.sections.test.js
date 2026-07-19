const test = require('node:test');
const assert = require('node:assert/strict');

global.DCState = require('../panel/js/state.js');
global.DCSections = { collapseKey: (n) => 'sec:' + n };
global.DCIcons = {
  chevron: '<svg></svg>', photoOff: '<svg></svg>', star: '<svg></svg>',
  starFilled: '<svg></svg>', pencil: '<svg></svg>', camera: '<svg></svg>',
  folder: '<svg></svg>', trash: '<svg></svg>', download: '<svg></svg>',
  bookmark: '<svg data-icon="bookmark"></svg>',
  bookmarkFilled: '<svg data-icon="bookmark-filled"></svg>'
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
    showNames: false, showMeta: false, collapsed: [], collapsedAssets: [],
    folderLayout: 'rows', folderColumns: false
  }, overrides || {});
}

function comp(id, cat) {
  return { uniqueId: id, category: cat, name: id, thumbPath: null };
}

function findAll(node, pred, out) {
  out = out || [];
  if (pred(node)) out.push(node);
  (node.children || []).forEach((c) => findAll(c, pred, out));
  return out;
}

function actionsOf(card) {
  return findAll(card, (n) => n.dataset && n.dataset.action).map((n) => n.dataset.action);
}

function renderGroups(groups, p) {
  const container = makeNode('main');
  DCRender.render(container, groups, p || prefs(), {}, {}, 'empty');
  return container;
}

test('virtual sections carry data-section, never data-category', () => {
  const c = renderGroups([{ category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] }]);
  const section = c.children[0];
  assert.equal(section.dataset.section, 'Client X');
  assert.equal(section.dataset.category, undefined);
  assert.match(section.className, /category--virtual/);
});

test('category sections are unchanged and their cards offer addToSection', () => {
  const c = renderGroups([{ category: 'Anims', items: [comp('a_1', 'Anims')] }]);
  const section = c.children[0];
  assert.equal(section.dataset.category, 'Anims');
  assert.equal(section.dataset.section, undefined);
  assert.doesNotMatch(section.className, /category--virtual/);
  const card = findAll(section, (n) => n.dataset && n.dataset.uniqueId)[0];
  assert.equal(card.dataset.section, undefined);
  assert.ok(actionsOf(card).includes('addToSection'));
  assert.ok(!actionsOf(card).includes('removeFromSection'));
});

test('cards inside a virtual section swap to removeFromSection and know their section', () => {
  const c = renderGroups([{ category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] }]);
  const card = findAll(c, (n) => n.dataset && n.dataset.uniqueId)[0];
  assert.equal(card.dataset.section, 'Client X');
  assert.ok(actionsOf(card).includes('removeFromSection'));
  assert.ok(!actionsOf(card).includes('addToSection'));
});

test('virtual headers get badge plus renameSection/deleteSection, not renameCategory', () => {
  const c = renderGroups([{ category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] }]);
  const actions = findAll(c.children[0], (n) => n.dataset && n.dataset.action).map((n) => n.dataset.action);
  assert.ok(actions.includes('renameSection'));
  assert.ok(actions.includes('deleteSection'));
  assert.ok(!actions.includes('renameCategory'));
  assert.equal(findAll(c.children[0], (n) => n.className === 'section-badge').length, 1);
});

test('virtual collapse honors the sec: prefixed key only', () => {
  const groups = [{ category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] }];
  let c = renderGroups(groups, prefs({ collapsed: ['sec:Client X'] }));
  assert.match(c.children[0].className, /collapsed/);
  c = renderGroups(groups, prefs({ collapsed: ['Client X'] }));
  assert.doesNotMatch(c.children[0].className, /collapsed/);
});

test('empty virtual sections render the hint body', () => {
  const c = renderGroups([{ category: 'Client X', virtual: true, items: [] }]);
  const hints = findAll(c, (n) => n.className === 'section-empty');
  assert.equal(hints.length, 1);
  assert.match(hints[0].textContent, /Add to Section/);
});

test('list rows follow the same swap rules', () => {
  const groups = [
    { category: 'Client X', virtual: true, items: [comp('a_1', 'Anims')] },
    { category: 'Anims', items: [comp('a_1', 'Anims')] }
  ];
  const c = renderGroups(groups, prefs({ viewMode: 'list' }));
  const cards = findAll(c, (n) => n.dataset && n.dataset.uniqueId);
  assert.ok(actionsOf(cards[0]).includes('removeFromSection'));
  assert.ok(actionsOf(cards[1]).includes('addToSection'));
});

test('asset cards never get section actions', () => {
  const container = makeNode('main');
  DCRender.render(container,
    [{ category: 'Logos', items: [{ uniqueId: 'l_1', category: 'Logos', name: 'L', ext: 'png', filePath: '/x.png' }] }],
    prefs({}), {}, {}, 'empty', 'asset');
  const card = findAll(container, (n) => n.dataset && n.dataset.uniqueId)[0];
  assert.ok(!actionsOf(card).includes('addToSection'));
  assert.ok(!actionsOf(card).includes('removeFromSection'));
});
