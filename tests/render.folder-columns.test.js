const test = require('node:test');
const assert = require('node:assert/strict');

global.DCState = require('../panel/js/state.js');
global.DCIcons = {
  chevron: '<svg></svg>',
  photoOff: '<svg></svg>',
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
    collapsedAssets: []
  }, overrides || {});
}

function groups() {
  return [
    { category: 'Alex Beck', items: [{ uniqueId: 'a', category: 'Alex Beck', name: 'One' }] },
    { category: 'BG', items: [{ uniqueId: 'b', category: 'BG', name: 'Two' }] }
  ];
}

test('render wraps folder sections for column layout when enabled', () => {
  const container = makeNode('main');
  DCRender.render(container, groups(), prefs({ folderColumns: true }), {}, {}, 'empty');

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].className, 'category-columns');
  assert.equal(container.children[0].children.length, 2);
  assert.equal(container.children[0].children[0].className, 'category');
});

test('render keeps sections direct when folder columns are disabled', () => {
  const container = makeNode('main');
  DCRender.render(container, groups(), prefs({ folderColumns: false }), {}, {}, 'empty');

  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].className, 'category');
});

test('render keeps list view full-width even when folder columns are enabled', () => {
  const container = makeNode('main');
  DCRender.render(container, groups(), prefs({ folderColumns: true, viewMode: 'list' }), {}, {}, 'empty');

  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].className, 'category');
});
