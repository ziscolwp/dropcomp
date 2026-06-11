var DCRender = (function () {
  'use strict';

  var ICONS = {
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
    starFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="m18.5 2.5 3 3L14 14l-4 1 1-4 7.5-7.5z"></path></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    photoOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="3" x2="21" y2="21"></line><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L9 17"></path></svg>',
    chevron: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>'
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function iconBtn(action, title, svg, extraClass) {
    var b = el('button', 'card-action' + (extraClass ? ' ' + extraClass : ''));
    b.dataset.action = action;
    b.title = title;
    b.innerHTML = svg;
    return b;
  }

  // encodeURI leaves # and ? alone, but either would truncate a file:// URL
  function thumbUrl(path, bust) {
    var encoded = encodeURI(String(path).replace(/\\/g, '/'))
      .replace(/#/g, '%23').replace(/\?/g, '%3F');
    return 'file:///' + encoded + (bust ? '?t=' + bust : '');
  }

  function buildCard(comp, usage, prefs, bust) {
    var card = el('article', 'card' + (usage.isFavorite ? ' has-fav' : ''));
    card.dataset.uniqueId = comp.uniqueId;
    card.dataset.category = comp.category;
    card.title = comp.name + '\nDouble-click to import';

    var thumbWrap = el('div', 'card-thumb');
    if (comp.thumbPath) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = thumbUrl(comp.thumbPath, bust);
      img.onerror = function () { img.style.display = 'none'; };
      thumbWrap.appendChild(img);
    } else {
      var ph = el('div', 'thumb-placeholder');
      ph.innerHTML = ICONS.photoOff;
      var gen = el('button', 'generate-chip', 'Generate');
      gen.dataset.action = 'generate';
      gen.title = 'Generate thumbnail automatically';
      ph.appendChild(gen);
      thumbWrap.appendChild(ph);
    }

    var actions = el('div', 'card-actions');
    actions.appendChild(iconBtn('favorite', 'Favorite',
      usage.isFavorite ? ICONS.starFilled : ICONS.star,
      usage.isFavorite ? 'fav-on' : ''));
    actions.appendChild(iconBtn('rename', 'Rename', ICONS.pencil));
    actions.appendChild(iconBtn('setThumb', 'Set thumbnail from current frame', ICONS.camera));
    actions.appendChild(iconBtn('reveal', 'Reveal in Finder', ICONS.folder));
    actions.appendChild(iconBtn('delete', 'Delete', ICONS.trash));
    thumbWrap.appendChild(actions);

    var importBar = el('button', 'import-bar');
    importBar.dataset.action = 'import';
    importBar.innerHTML = ICONS.download;
    importBar.appendChild(el('span', null, 'Import'));
    thumbWrap.appendChild(importBar);

    card.appendChild(thumbWrap);

    if (prefs.showNames || prefs.showMeta) {
      var info = el('div', 'card-info');
      if (prefs.showNames) info.appendChild(el('div', 'card-name', comp.name));
      if (prefs.showMeta) {
        var meta = DCState.formatMetaLine(comp);
        if (meta) info.appendChild(el('div', 'card-meta', meta));
      }
      if (info.childNodes.length) card.appendChild(info);
    }
    return card;
  }

  var RENDERABLE_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1 };

  function buildAssetCard(asset, usage, prefs) {
    var card = el('article', 'card card--asset' + (usage.isFavorite ? ' has-fav' : ''));
    card.dataset.uniqueId = asset.uniqueId;
    card.dataset.category = asset.category;
    card.title = asset.name + '\nDouble-click to import';

    var thumbWrap = el('div', 'card-thumb');
    if (RENDERABLE_EXTS[asset.ext]) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      // addedAt changes when the same filename is re-added, busting the stale cache
      img.src = thumbUrl(asset.filePath, asset.addedAt || null);
      img.onerror = function () { img.style.display = 'none'; };
      thumbWrap.appendChild(img);
    } else {
      var ph = el('div', 'thumb-placeholder');
      ph.appendChild(el('span', 'ext-badge', String(asset.ext || '?').toUpperCase()));
      thumbWrap.appendChild(ph);
    }

    var actions = el('div', 'card-actions');
    actions.appendChild(iconBtn('favorite', 'Favorite',
      usage.isFavorite ? ICONS.starFilled : ICONS.star,
      usage.isFavorite ? 'fav-on' : ''));
    actions.appendChild(iconBtn('rename', 'Rename', ICONS.pencil));
    actions.appendChild(iconBtn('reveal', 'Reveal in Finder', ICONS.folder));
    actions.appendChild(iconBtn('delete', 'Delete', ICONS.trash));
    thumbWrap.appendChild(actions);

    var importBar = el('button', 'import-bar');
    importBar.dataset.action = 'import';
    importBar.innerHTML = ICONS.download;
    importBar.appendChild(el('span', null, 'Import'));
    thumbWrap.appendChild(importBar);
    card.appendChild(thumbWrap);

    if (prefs.showNames || prefs.showMeta) {
      var info = el('div', 'card-info');
      if (prefs.showNames) info.appendChild(el('div', 'card-name', asset.name));
      if (prefs.showMeta) {
        var meta = DCState.formatAssetMetaLine(asset);
        if (meta) info.appendChild(el('div', 'card-meta', meta));
      }
      if (info.childNodes.length) card.appendChild(info);
    }
    return card;
  }

  function buildSection(group, prefs, usageMeta, busts, kind) {
    var collapsedList = kind === 'asset' ? prefs.collapsedAssets : prefs.collapsed;
    var collapsed = collapsedList.indexOf(group.category) !== -1;
    var section = el('section', 'category' + (collapsed ? ' collapsed' : ''));
    section.dataset.category = group.category;

    var header = el('header', 'category-header');
    header.dataset.action = 'toggleSection';
    header.innerHTML = ICONS.chevron;
    header.appendChild(el('span', 'category-name', group.category));
    header.appendChild(el('span', 'category-count', String(group.items.length)));
    section.appendChild(header);

    var grid = el('div', 'grid');
    group.items.forEach(function (item) {
      var usage = DCState.getUsage(usageMeta, item.uniqueId);
      grid.appendChild(kind === 'asset'
        ? buildAssetCard(item, usage, prefs)
        : buildCard(item, usage, prefs, busts[item.uniqueId]));
    });
    section.appendChild(grid);
    return section;
  }

  function render(container, groups, prefs, usageMeta, busts, emptyMessage, kind) {
    container.innerHTML = '';
    if (groups.length === 0) {
      container.appendChild(el('div', 'placeholder', emptyMessage));
      return;
    }
    groups.forEach(function (g) {
      container.appendChild(buildSection(g, prefs, usageMeta, busts, kind));
    });
  }

  return { render: render };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCRender; }
