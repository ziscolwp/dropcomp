var DCRender = (function () {
  'use strict';

  // Icons come from the shared DCIcons registry (one visual language).
  var ICONS = DCIcons;

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
    b.setAttribute('aria-label', title);
    b.innerHTML = svg;
    return b;
  }

  // On a broken thumbnail, swap in a placeholder instead of vanishing: the
  // asset's extension badge when we know it, else the photo-off glyph.
  function showThumbFallback(img, ext) {
    if (!img.parentNode) return;
    var ph = el('div', 'thumb-placeholder');
    if (ext) ph.appendChild(el('span', 'ext-badge', String(ext).toUpperCase()));
    else ph.innerHTML = ICONS.photoOff;
    img.parentNode.replaceChild(ph, img);
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
    card.dataset.dragKind = 'library-card';
    card.draggable = true;
    card.title = comp.name + '\nDouble-click to import';

    var thumbWrap = el('div', 'card-thumb');
    if (comp.thumbPath) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = thumbUrl(comp.thumbPath, bust);
      img.onerror = function () { showThumbFallback(img); };
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

  // Formats the embedded Chromium can paint in an <img>; everything else gets
  // an extension badge. svg renders natively (vector, so it stays crisp).
  var RENDERABLE_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, svg: 1 };

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
      img.onerror = function () { showThumbFallback(img, asset.ext); };
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

  function buildRow(item, usage, prefs, kind, bust) {
    var isAsset = kind === 'asset';
    var card = el('article', 'card card--row' + (usage.isFavorite ? ' has-fav' : ''));
    card.dataset.uniqueId = item.uniqueId;
    card.dataset.category = item.category;
    if (!isAsset) {
      card.dataset.dragKind = 'library-card';
      card.draggable = true;
    }
    card.title = item.name + '\nDouble-click to import';

    var thumbWrap = el('div', 'card-thumb');
    var renderable = isAsset ? RENDERABLE_EXTS[item.ext] : item.thumbPath;
    if (renderable) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = thumbUrl(isAsset ? item.filePath : item.thumbPath,
        isAsset ? (item.addedAt || null) : bust);
      img.onerror = function () { showThumbFallback(img, isAsset ? item.ext : null); };
      thumbWrap.appendChild(img);
    } else {
      var ph = el('div', 'thumb-placeholder');
      if (isAsset) ph.appendChild(el('span', 'ext-badge', String(item.ext || '?').toUpperCase()));
      else ph.innerHTML = ICONS.photoOff;
      thumbWrap.appendChild(ph);
    }
    card.appendChild(thumbWrap);

    var main = el('div', 'row-main');
    main.appendChild(el('div', 'card-name', item.name));
    var meta = isAsset ? DCState.formatAssetMetaLine(item) : DCState.formatMetaLine(item);
    if (meta) main.appendChild(el('div', 'card-meta', meta));
    card.appendChild(main);

    var actions = el('div', 'row-actions');
    actions.appendChild(iconBtn('import', 'Import', ICONS.download));
    actions.appendChild(iconBtn('favorite', 'Favorite',
      usage.isFavorite ? ICONS.starFilled : ICONS.star,
      usage.isFavorite ? 'fav-on' : ''));
    actions.appendChild(iconBtn('rename', 'Rename', ICONS.pencil));
    if (!isAsset) actions.appendChild(iconBtn('setThumb', 'Set thumbnail from current frame', ICONS.camera));
    actions.appendChild(iconBtn('reveal', 'Reveal in Finder', ICONS.folder));
    actions.appendChild(iconBtn('delete', 'Delete', ICONS.trash));
    card.appendChild(actions);
    return card;
  }

  function buildSection(group, prefs, usageMeta, busts, kind, viewMode) {
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

    var isList = viewMode === 'list';
    var container = el('div', isList ? 'list' : 'grid');
    group.items.forEach(function (item) {
      var usage = DCState.getUsage(usageMeta, item.uniqueId);
      if (isList) {
        container.appendChild(buildRow(item, usage, prefs, kind, busts[item.uniqueId]));
      } else {
        container.appendChild(kind === 'asset'
          ? buildAssetCard(item, usage, prefs)
          : buildCard(item, usage, prefs, busts[item.uniqueId]));
      }
    });
    section.appendChild(container);
    return section;
  }

  function render(container, groups, prefs, usageMeta, busts, emptyMessage, kind) {
    container.innerHTML = '';
    if (groups.length === 0) {
      container.appendChild(el('div', 'placeholder', emptyMessage));
      return;
    }
    var viewMode = DCState.normalizeViewMode(
      kind === 'asset' ? prefs.viewModeAssets : prefs.viewMode);
    var parent = container;
    if (DCState.isFolderColumns(prefs) && viewMode !== 'list') {
      parent = el('div', 'category-columns');
      container.appendChild(parent);
    }
    groups.forEach(function (g) {
      parent.appendChild(buildSection(g, prefs, usageMeta, busts, kind, viewMode));
    });
  }

  return { render: render };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCRender; }
