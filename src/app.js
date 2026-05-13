import { CONSTANTS, parseSortExpression, SORT_PRESET_TO_EXPRESSION, groupDescriptors, groupKeyLabel } from './utils.js';
import { FileImporter } from './importer.js';
import { DragSort } from './dragSort.js';
import { captureAll, createZipMainThread, downloadZip } from './capture.js';
import { computeAutoLayout, suggestTargetRowHeight } from './layoutAuto.js';

const DOM_IDS = [
  'dropArea', 'fileInput', 'captureButton', 'sortOrder', 'maxWidth',
  'columns', 'rows', 'columnGap', 'rowGap', 'paddingX', 'paddingY',
  'bgColor', 'photoWall', 'downloadMode', 'progressContainer', 'progressText',
  'photoWallContainer', 'linksContainer', 'imageBorderRadius', 'pageBorderRadius',
  'imageFormat', 'imageQuality', 'imageAlignment', 'addMoreHint', 'appendMode',
  'sortExpression', 'sortExpressionHint', 'sortExpressionHelp', 'groupBy', 'groupTabs',
  'sortExpressionPopover', 'sortExpressionPopoverClose', 'sortExpressionPopoverHeader',
  'layoutMode', 'maxItemsPerRow', 'maxRowsPerShot', 'reorderFreedom',
  'rowsLandscape', 'rowsPortrait', 'rowsSquare',
  'maxRowsPerShotLandscape', 'maxRowsPerShotPortrait', 'maxRowsPerShotSquare',
];

const ORIENTATION_KEYS = ['landscape', 'portrait', 'square'];

function effectiveRows(s, groupKey) {
  if (s.groupBy === 'orientation' && ORIENTATION_KEYS.includes(groupKey)) {
    return s.rowsByOrientation[groupKey] || s.rows;
  }
  return s.rows;
}

function effectiveMaxRowsPerShot(s, groupKey) {
  if (s.groupBy === 'orientation' && ORIENTATION_KEYS.includes(groupKey)) {
    const v = s.maxRowsPerShotByOrientation[groupKey];
    return v > 0 ? v : s.maxRowsPerShot;
  }
  return s.maxRowsPerShot;
}

function collectDOM() {
  const ui = {};
  for (const id of DOM_IDS) ui[id] = document.getElementById(id);
  return ui;
}

function readSettings(ui) {
  return {
    layoutMode: ui.layoutMode.value,
    groupBy: ui.groupBy.value,
    columns: parseInt(ui.columns.value, 10),
    rows: parseInt(ui.rows.value, 10),
    rowsByOrientation: {
      landscape: parseInt(ui.rowsLandscape.value, 10) || parseInt(ui.rows.value, 10),
      portrait: parseInt(ui.rowsPortrait.value, 10) || parseInt(ui.rows.value, 10),
      square: parseInt(ui.rowsSquare.value, 10) || parseInt(ui.rows.value, 10),
    },
    maxItemsPerRow: parseInt(ui.maxItemsPerRow.value, 10) || 4,
    maxRowsPerShot: parseInt(ui.maxRowsPerShot.value, 10) || 0,
    maxRowsPerShotByOrientation: {
      landscape: parseInt(ui.maxRowsPerShotLandscape.value, 10) || 0,
      portrait: parseInt(ui.maxRowsPerShotPortrait.value, 10) || 0,
      square: parseInt(ui.maxRowsPerShotSquare.value, 10) || 0,
    },
    reorderFreedom: parseInt(ui.reorderFreedom.value, 10) || 0,
    columnGap: parseInt(ui.columnGap.value, 10),
    rowGap: parseInt(ui.rowGap.value, 10),
    paddingX: parseInt(ui.paddingX.value, 10),
    paddingY: parseInt(ui.paddingY.value, 10),
    bgColor: ui.bgColor.value,
    maxWidth: parseInt(ui.maxWidth.value, 10),
    imageBorderRadius: parseInt(ui.imageBorderRadius.value, 10),
    pageBorderRadius: parseInt(ui.pageBorderRadius.value, 10),
    imageAlignment: ui.imageAlignment.value,
  };
}

class App {
  constructor() {
    this.ui = collectDOM();
    this.isGenerating = false;
    this.lastClickAt = 0;

    this.checkFolderSupport();

    this.dragSort = new DragSort({
      photoWall: this.ui.photoWall,
      onReorder: () => {
        this.importer.syncDescriptorsFromDOM();
        this.updateLayout();
      },
      onRemove: () => {
        this.importer.syncDescriptorsFromDOM();
        this.updateDropAreaText();
        this.updateLayout();
        this.updateGroupTabs();
      },
    });

    this.importer = new FileImporter({
      photoWall: this.ui.photoWall,
      onDragStart: (el) => this.dragSort.attach(el),
      onProgress: (ratio, phase) => this.handleImportProgress(ratio, phase),
      onComplete: (info) => this.handleImportComplete(info),
    });

    this.bindEvents();
    this.updateLayout();
  }

  checkFolderSupport() {
    if (!('showDirectoryPicker' in window)) {
      const opt = this.ui.downloadMode.querySelector('option[value="folder"]');
      if (opt) {
        opt.disabled = true;
        opt.textContent = '保存到文件夹 (不支持)';
      }
      this.ui.downloadMode.value = 'browser';
    }
  }

  bindEvents() {
    const { dropArea, fileInput, captureButton, sortOrder, photoWallContainer, addMoreHint, appendMode, sortExpression, groupBy, layoutMode } = this.ui;

    const openPicker = () => {
      if (this.dragSort.isDragging) return;
      const now = Date.now();
      if (now - this.lastClickAt < CONSTANTS.CLICK_DEBOUNCE_MS) return;
      this.lastClickAt = now;
      fileInput.click();
    };

    dropArea.addEventListener('click', openPicker);
    addMoreHint.addEventListener('click', (e) => {
      e.stopPropagation();
      openPicker();
    });

    this.bindDropZone(dropArea, false);
    this.bindDropZone(photoWallContainer, true);

    fileInput.addEventListener('change', (e) => {
      const isAppend = this.importer.descriptors.length > 0;
      this.handleFiles(e.target.files, isAppend);
      e.target.value = '';
    });

    captureButton.addEventListener('click', () => this.runCapture());
    sortOrder.addEventListener('change', () => {
      const expr = SORT_PRESET_TO_EXPRESSION[sortOrder.value] || '';
      sortExpression.value = expr;
      this.handleSortExpressionChange();
    });
    appendMode.addEventListener('change', () => this.updateDropAreaText());
    sortExpression.addEventListener('input', () => this.handleSortExpressionChange());
    groupBy.addEventListener('change', () => {
      this.toggleLayoutModeUI();
      this.applySort();
    });
    layoutMode.addEventListener('change', () => {
      this.toggleLayoutModeUI();
      this.updateLayout();
    });
    this.bindGroupTabs();

    this.bindPopover();

    for (const el of Object.values(this.ui)) {
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
        if (el === fileInput || el === sortOrder || el === appendMode || el === sortExpression || el === groupBy || el === layoutMode) continue;
        el.addEventListener('change', () => this.updateLayout());
      }
    }

    if (!sortExpression.value.trim()) {
      sortExpression.value = SORT_PRESET_TO_EXPRESSION[sortOrder.value] || 'name ASC';
    }
    this.updateSortExpressionState();
    this.toggleLayoutModeUI();
  }

  toggleLayoutModeUI() {
    const mode = this.ui.layoutMode.value;
    const groupScope = this.ui.groupBy.value === 'orientation' ? 'orientation' : 'default';
    for (const el of document.querySelectorAll('[data-mode], [data-group]')) {
      const modeOK = !el.dataset.mode || el.dataset.mode === mode;
      const groupOK = !el.dataset.group || el.dataset.group === groupScope;
      el.style.display = modeOK && groupOK ? '' : 'none';
    }
  }

  bindGroupTabs() {
    const { groupTabs } = this.ui;
    if (!groupTabs) return;
    groupTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab || !groupTabs.contains(tab)) return;
      this.setActiveGroup(tab.dataset.key);
    });
  }

  updateGroupTabs() {
    const { groupTabs, photoWall } = this.ui;
    if (!groupTabs) return;
    const groupBy = this.ui.groupBy.value;
    const groups = this.buildCaptureGroups();

    for (const g of groups) {
      for (const el of g.elements) el.dataset.groupKey = g.key ?? '';
    }

    if (!groupBy || groupBy === 'none' || groups.length <= 1) {
      groupTabs.style.display = 'none';
      groupTabs.innerHTML = '';
      delete photoWall.dataset.activeGroup;
      for (const pageEl of photoWall.querySelectorAll('.auto-page, .grid-page')) {
        pageEl.style.removeProperty('display');
      }
      this._activeGroupKey = '__all__';
      return;
    }

    groupTabs.style.display = 'flex';
    groupTabs.innerHTML = '';
    const total = groups.reduce((s, g) => s + g.elements.length, 0);
    const previousKey = this._activeGroupKey;
    const validKeys = new Set(groups.map((g) => g.key));
    const keepActive = previousKey === '__all__' || validKeys.has(previousKey);
    const initialKey = keepActive ? previousKey : '__all__';

    const allBtn = this._buildTabButton('__all__', `全部 (${total})`);
    groupTabs.appendChild(allBtn);
    for (const g of groups) {
      groupTabs.appendChild(this._buildTabButton(g.key, `${groupKeyLabel(groupBy, g.key)} (${g.elements.length})`));
    }

    this.setActiveGroup(initialKey);
  }

  _buildTabButton(key, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab';
    btn.dataset.key = key;
    btn.textContent = label;
    return btn;
  }

  setActiveGroup(key) {
    const { groupTabs, photoWall } = this.ui;
    if (!groupTabs) return;
    this._activeGroupKey = key;
    for (const t of groupTabs.querySelectorAll('.tab')) {
      t.classList.toggle('active', t.dataset.key === key);
    }
    photoWall.dataset.activeGroup = key;
    for (const pageEl of photoWall.querySelectorAll('.auto-page, .grid-page')) {
      pageEl.style.display = key === '__all__' || pageEl.dataset.groupKey === key ? '' : 'none';
    }
  }

  bindPopover() {
    const { sortExpressionHelp, sortExpressionPopover, sortExpressionPopoverClose, sortExpressionPopoverHeader } = this.ui;
    const hide = () => { sortExpressionPopover.hidden = true; };
    sortExpressionHelp.addEventListener('click', () => {
      sortExpressionPopover.hidden = !sortExpressionPopover.hidden;
    });
    sortExpressionPopoverClose.addEventListener('click', hide);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });
    this.makeDraggable(sortExpressionPopover, sortExpressionPopoverHeader);
  }

  makeDraggable(panel, handle) {
    let startX = 0, startY = 0, origX = 0, origY = 0, activeId = null;
    const onMove = (e) => {
      if (e.pointerId !== activeId) return;
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const x = Math.max(0, Math.min(window.innerWidth - w, origX + e.clientX - startX));
      const y = Math.max(0, Math.min(window.innerHeight - h, origY + e.clientY - startY));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    };
    const onUp = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      handle.classList.remove('dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch {}
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.popover-close')) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      panel.style.right = 'auto';
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      startX = e.clientX;
      startY = e.clientY;
      origX = rect.left;
      origY = rect.top;
      activeId = e.pointerId;
      handle.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  resolveSortCriteria() {
    const raw = this.ui.sortExpression.value.trim();
    if (!raw) return this.ui.sortOrder.value;
    const parsed = parseSortExpression(raw);
    if (parsed.steps.length === 0) return this.ui.sortOrder.value;
    return parsed;
  }

  updateSortExpressionState() {
    const { sortExpression, sortExpressionHint } = this.ui;
    const raw = sortExpression.value.trim();
    sortExpressionHint.classList.remove('error');
    if (!raw) {
      sortExpressionHint.textContent = '使用上方下拉排序';
      return;
    }
    const { steps, errors } = parseSortExpression(raw);
    if (errors.length > 0) {
      sortExpressionHint.classList.add('error');
      sortExpressionHint.textContent = `未知字段: ${errors.join(', ')}`;
    } else if (steps.length === 0) {
      sortExpressionHint.classList.add('error');
      sortExpressionHint.textContent = '表达式无效';
    } else {
      const desc = steps.map(({ field, desc: d }) => `${field} ${d ? 'DESC' : 'ASC'}`).join(' → ');
      sortExpressionHint.textContent = `排序: ${desc}`;
    }
  }

  handleSortExpressionChange() {
    this.updateSortExpressionState();
    if (this.importer.descriptors.length === 0) return;
    this.applySort();
  }

  applySort() {
    this.importer.resort(this.resolveSortCriteria(), this.ui.groupBy.value);
  }

  bindDropZone(zone, forceAppend) {
    zone.addEventListener('dragover', (e) => {
      if (this.dragSort.isDragging) return;
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      zone.classList.add('hover', 'drag-hover');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('hover', 'drag-hover');
    });
    zone.addEventListener('drop', (e) => {
      if (this.dragSort.isDragging) return;
      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      zone.classList.remove('hover', 'drag-hover');
      const isAppend = forceAppend ? this.importer.descriptors.length > 0 : this.importer.descriptors.length > 0;
      this.handleFiles(e.dataTransfer.files, isAppend);
    });
  }

  handleFiles(fileList, isAppend) {
    const { progressContainer, progressText, appendMode } = this.ui;
    progressContainer.style.display = 'block';
    progressText.innerText = isAppend ? '正在添加图片...' : '正在分析图片...';
    this.importer.handleFiles(fileList, {
      isAppend,
      appendMode: isAppend ? appendMode.value : 'append',
      sortOrder: this.resolveSortCriteria(),
      groupBy: this.ui.groupBy.value,
    });
  }

  handleImportProgress(ratio, phase) {
    const { progressText } = this.ui;
    const pct = Math.round(Math.min(ratio, 1) * 100);
    const label = phase === 'metadata' ? '正在分析图片' : '正在渲染';
    progressText.innerText = `${label}... ${pct}%`;
  }

  handleImportComplete(info) {
    const { progressContainer, progressText, captureButton, photoWallContainer } = this.ui;

    if (info.error) {
      progressText.innerText = `处理失败: ${info.error}`;
      return;
    }
    if (info.empty) {
      progressText.innerText = '没有找到图片文件';
      setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);
      return;
    }

    progressText.innerText = info.added > 0 && info.total !== info.added
      ? `已添加 ${info.added} 张图片`
      : '导入完成';

    if (this.importer.descriptors.length > 0) {
      photoWallContainer.style.display = 'block';
      captureButton.style.display = 'block';
    }
    this.updateDropAreaText();
    this.updateLayout();
    this.updateGroupTabs();
  }

  updateLayout() {
    const { photoWall, captureButton, photoWallContainer, progressContainer, progressText } = this.ui;
    const count = photoWall.querySelectorAll('.photo-container').length;

    if (count === 0) {
      // Import in flight: DOM not yet populated, don't hide the progress UI.
      if (this.importer?.isImporting) return;
      captureButton.style.display = 'none';
      photoWallContainer.style.display = 'none';
      progressContainer.style.display = 'none';
      this.updateDropAreaText();
      return;
    }

    const s = readSettings(this.ui);
    photoWall.style.maxWidth = `${s.maxWidth}px`;

    for (const c of photoWall.querySelectorAll('.photo-container')) {
      c.style.borderRadius = `${s.imageBorderRadius}px`;
    }
    for (const p of photoWall.querySelectorAll('.photo')) {
      p.style.borderRadius = `${s.imageBorderRadius}px`;
    }

    if (s.layoutMode === 'auto') {
      photoWall.classList.add('layout-auto');
      this.unwrapGridPages();
      this.applyAutoLayout(s);
    } else {
      photoWall.classList.remove('layout-auto');
      this.unwrapAutoLayout();
      this.applyGridLayout(s);
    }

    const groups = this.buildCaptureGroups();
    let totalShots;
    if (s.layoutMode === 'auto') {
      totalShots = groups.reduce((sum, g) => sum + (g.autoPages?.length || 0), 0);
    } else {
      totalShots = groups.reduce((sum, g) => sum + Math.ceil(g.elements.length / (s.columns * effectiveRows(s, g.key))), 0);
    }
    const groupSuffix = groups.length > 1 ? `（${groups.length} 个分组）` : '';
    progressText.innerText = `文件夹包含 ${count} 个图片，预计生成 ${totalShots} 张截图${groupSuffix}`;
    progressContainer.style.display = 'block';
  }

  unwrapAutoLayout() {
    const { photoWall } = this.ui;
    const containers = [...photoWall.querySelectorAll('.photo-container')];
    for (const el of photoWall.querySelectorAll('.auto-page, .auto-row, .shot-divider')) {
      el.remove();
    }
    for (const el of containers) {
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('flex');
      photoWall.appendChild(el);
    }
    this._autoLayoutCache = null;
  }

  unwrapGridPages() {
    const { photoWall } = this.ui;
    const containers = [...photoWall.querySelectorAll('.photo-container')];
    for (const pageEl of photoWall.querySelectorAll('.grid-page')) {
      pageEl.remove();
    }
    for (const el of containers) {
      el.style.removeProperty('align-items');
      el.style.removeProperty('justify-content');
      photoWall.appendChild(el);
    }
  }

  applyGridLayout(s) {
    const { photoWall } = this.ui;
    // Tear down any existing pages and detach photo containers.
    const allContainers = [...photoWall.querySelectorAll('.photo-container')];
    for (const pageEl of photoWall.querySelectorAll('.grid-page')) {
      pageEl.remove();
    }
    for (const el of allContainers) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    const groups = this.buildCaptureGroupsRaw();
    for (const g of groups) {
      const perCapture = s.columns * Math.max(1, effectiveRows(s, g.key));
      for (let i = 0; i < g.elements.length; i += perCapture) {
        const slice = g.elements.slice(i, i + perCapture);
        const pageEl = document.createElement('div');
        pageEl.className = 'grid-page';
        if (g.key != null) pageEl.dataset.groupKey = g.key;
        pageEl.style.backgroundColor = s.bgColor;
        pageEl.style.padding = `${s.paddingY}px ${s.paddingX}px`;
        pageEl.style.borderRadius = `${s.pageBorderRadius}px`;
        pageEl.style.gridTemplateColumns = `repeat(${s.columns}, 1fr)`;
        pageEl.style.rowGap = `${s.rowGap}px`;
        pageEl.style.columnGap = `${s.columnGap}px`;
        pageEl.style.alignItems = s.imageAlignment;
        pageEl.style.justifyItems = s.imageAlignment;
        for (const el of slice) {
          el.style.alignItems = s.imageAlignment;
          el.style.justifyContent = s.imageAlignment;
          pageEl.appendChild(el);
        }
        photoWall.appendChild(pageEl);
      }
    }

    if (this._activeGroupKey && this._activeGroupKey !== '__all__') {
      for (const pageEl of photoWall.querySelectorAll('.grid-page')) {
        pageEl.style.display = pageEl.dataset.groupKey === this._activeGroupKey ? '' : 'none';
      }
    }
  }

  applyAutoLayout(s) {
    const { photoWall } = this.ui;
    const contentWidth = Math.max(1, s.maxWidth - 2 * s.paddingX);

    // Detach all photo containers; rebuild wrapper hierarchy.
    const allContainers = [...photoWall.querySelectorAll('.photo-container')];
    for (const el of allContainers) {
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('flex');
    }
    for (const el of photoWall.querySelectorAll('.auto-page, .auto-row')) {
      el.remove();
    }
    for (const el of allContainers) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    const groups = this.buildCaptureGroupsRaw();
    this._autoLayoutCache = [];

    for (const g of groups) {
      const groupMaxRows = effectiveMaxRowsPerShot(s, g.key);
      const maxRowsPerShot = groupMaxRows > 0 ? groupMaxRows : Number.POSITIVE_INFINITY;
      const items = g.elements.map((el) => ({
        width: parseFloat(el.dataset.width) || 1,
        height: parseFloat(el.dataset.height) || 1,
        element: el,
      }));
      const targetRowHeight = suggestTargetRowHeight(items, contentWidth, s.columnGap, s.maxItemsPerRow);
      const result = computeAutoLayout(items, {
        contentWidth,
        maxRowsPerShot,
        targetRowHeight,
        columnGap: s.columnGap,
        rowGap: s.rowGap,
        reorderFreedom: s.reorderFreedom,
        maxItemsPerRow: s.maxItemsPerRow,
      });
      this._autoLayoutCache.push({ key: g.key, pages: result.pages });

      for (const page of result.pages) {
        const pageEl = document.createElement('div');
        pageEl.className = 'auto-page';
        if (g.key != null) pageEl.dataset.groupKey = g.key;
        pageEl.style.backgroundColor = s.bgColor;
        pageEl.style.padding = `${s.paddingY}px ${s.paddingX}px`;
        pageEl.style.borderRadius = `${s.pageBorderRadius}px`;
        for (let ri = 0; ri < page.rows.length; ri++) {
          const row = page.rows[ri];
          const rowEl = document.createElement('div');
          rowEl.className = 'auto-row';
          rowEl.style.height = `${row.height}px`;
          rowEl.style.columnGap = `${s.columnGap}px`;
          if (ri > 0) rowEl.style.marginTop = `${s.rowGap}px`;
          for (const item of row.items) {
            const el = item.source.element;
            el.style.width = `${item.width}px`;
            el.style.height = `${row.height}px`;
            rowEl.appendChild(el);
          }
          pageEl.appendChild(rowEl);
        }
        photoWall.appendChild(pageEl);
      }
    }

    // Active group filter (existing tab UI hides whole .photo-container).
    if (this._activeGroupKey && this._activeGroupKey !== '__all__') {
      for (const pageEl of photoWall.querySelectorAll('.auto-page')) {
        const visible = pageEl.dataset.groupKey === this._activeGroupKey;
        pageEl.style.display = visible ? '' : 'none';
      }
    }
  }

  updateDropAreaText() {
    const { dropArea, addMoreHint, appendMode } = this.ui;
    const count = this.importer.descriptors.length;
    if (count > 0) {
      dropArea.textContent = '添加更多图片';
      addMoreHint.style.display = 'flex';
      const modeText = appendMode.value === 'append' ? '添加到末尾' : '按当前排序插入';
      addMoreHint.querySelector('.mode-hint').textContent = `（${modeText}）`;
    } else {
      dropArea.textContent = '点击此处，导入文件夹';
      addMoreHint.style.display = 'none';
    }
  }

  buildCaptureGroupsRaw() {
    const groupBy = this.ui.groupBy.value;
    const descs = this.importer.descriptors;
    if (!groupBy || groupBy === 'none') {
      return [{ key: null, elements: descs.map((d) => d.element).filter(Boolean) }];
    }
    const grouped = groupDescriptors(descs, groupBy);
    return grouped.map(({ key, items }) => ({
      key,
      elements: items.map((d) => d.element).filter(Boolean),
    })).filter((g) => g.elements.length > 0);
  }

  buildCaptureGroups() {
    const groups = this.buildCaptureGroupsRaw();
    const cache = this._autoLayoutCache;
    if (cache && this.ui.layoutMode.value === 'auto') {
      for (let i = 0; i < groups.length; i++) {
        const entry = cache.find((c) => c.key === groups[i].key);
        if (entry) groups[i].autoPages = entry.pages;
      }
    }
    return groups;
  }

  async runCapture() {
    if (this.isGenerating) return;
    const { captureButton, linksContainer, progressContainer, progressText, downloadMode, imageFormat, imageQuality } = this.ui;

    const photos = this.importer.getPhotoElements();
    if (photos.length === 0) return;

    this.isGenerating = true;
    captureButton.style.display = 'none';
    linksContainer.innerHTML = '';
    progressContainer.style.display = 'block';
    progressText.innerText = '正在截图...';

    const settings = readSettings(this.ui);
    const format = imageFormat.value;
    const quality = parseInt(imageQuality.value, 10) / 100;
    const mode = downloadMode.value;
    const groups = this.buildCaptureGroups(photos);
    const shotsFor = (g) =>
      settings.layoutMode === 'auto'
        ? (g.autoPages?.length || 0)
        : Math.ceil(g.elements.length / (settings.columns * effectiveRows(settings, g.key)));
    const totalShots = groups.reduce((sum, g) => sum + shotsFor(g), 0);

    try {
      let completedShots = 0;
      const allResults = [];
      let directoryHandle = null;
      for (const g of groups) {
        const groupShots = shotsFor(g);
        const groupSettings = { ...settings, rows: effectiveRows(settings, g.key) };
        const { results, directoryHandle: handleOut } = await captureAll({
          photos: g.elements,
          autoPages: g.autoPages,
          settings: groupSettings,
          format,
          quality,
          mode,
          linksContainer: mode === 'browser' ? linksContainer : null,
          fileNamePrefix: g.key ?? '',
          directoryHandle,
          onProgress: (ratio) => {
            const overall = totalShots === 0 ? 1 : (completedShots + ratio * groupShots) / totalShots;
            progressText.innerText = `正在截图... ${Math.round(overall * 100)}%`;
          },
        });
        directoryHandle = handleOut;
        completedShots += groupShots;
        allResults.push(...results);
      }

      if (mode === 'zip') {
        progressText.innerText = '正在生成压缩包...';
        if (this.importer.worker) {
          const { content, fileName } = await this.importer.createZipInWorker(allResults, format);
          saveAs(content, fileName);
        } else {
          const blob = await createZipMainThread(allResults, format);
          downloadZip(blob);
        }
        progressText.innerText = '完成';
      } else {
        progressText.innerText = mode === 'folder' ? '所有文件已保存到文件夹' : '截图完成';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        progressText.innerText = '已取消';
      } else {
        console.error('生成截图出错:', err);
        progressText.innerText = `生成失败: ${err.message || err}`;
      }
    } finally {
      this.finishCapture();
    }
  }

  finishCapture() {
    this.isGenerating = false;
    this.ui.captureButton.style.display = 'block';
    setTimeout(() => {
      if (!this.isGenerating) this.ui.progressContainer.style.display = 'none';
    }, 2000);
  }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new App();
});
window.addEventListener('beforeunload', () => app?.importer?.destroy());
