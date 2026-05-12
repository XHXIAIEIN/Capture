import { CONSTANTS, parseSortExpression, SORT_PRESET_TO_EXPRESSION, groupDescriptors } from './utils.js';
import { FileImporter } from './importer.js';
import { DragSort } from './dragSort.js';
import { captureAll, createZipMainThread, downloadZip } from './capture.js';

const DOM_IDS = [
  'dropArea', 'fileInput', 'captureButton', 'sortOrder', 'maxWidth',
  'columns', 'rows', 'columnGap', 'rowGap', 'paddingX', 'paddingY',
  'bgColor', 'photoWall', 'downloadMode', 'progressContainer', 'progressText',
  'photoWallContainer', 'linksContainer', 'imageBorderRadius', 'pageBorderRadius',
  'imageFormat', 'imageQuality', 'imageAlignment', 'addMoreHint', 'appendMode',
  'sortExpression', 'sortExpressionHint', 'sortExpressionHelp', 'groupBy', 'groupByTabs',
  'sortExpressionPopover', 'sortExpressionPopoverClose', 'sortExpressionPopoverHeader',
];

function collectDOM() {
  const ui = {};
  for (const id of DOM_IDS) ui[id] = document.getElementById(id);
  return ui;
}

function readSettings(ui) {
  return {
    columns: parseInt(ui.columns.value, 10),
    rows: parseInt(ui.rows.value, 10),
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
      onReorder: () => this.importer.syncDescriptorsFromDOM(),
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
    const { dropArea, fileInput, captureButton, sortOrder, photoWallContainer, addMoreHint, appendMode, sortExpression, groupBy } = this.ui;

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
    groupBy.addEventListener('change', () => this.applySort());
    this.bindGroupByTabs();

    this.bindPopover();

    for (const el of Object.values(this.ui)) {
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
        if (el === fileInput || el === sortOrder || el === appendMode || el === sortExpression || el === groupBy) continue;
        el.addEventListener('change', () => this.updateLayout());
      }
    }

    if (!sortExpression.value.trim()) {
      sortExpression.value = SORT_PRESET_TO_EXPRESSION[sortOrder.value] || 'name ASC';
    }
    this.updateSortExpressionState();
  }

  bindGroupByTabs() {
    const { groupByTabs, groupBy } = this.ui;
    if (!groupByTabs) return;
    groupByTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab || !groupByTabs.contains(tab)) return;
      const value = tab.dataset.value;
      if (groupBy.value === value) return;
      for (const t of groupByTabs.querySelectorAll('.tab')) {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      groupBy.value = value;
      groupBy.dispatchEvent(new Event('change'));
    });
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
  }

  updateLayout() {
    const { photoWall, captureButton, photoWallContainer, progressContainer, progressText } = this.ui;
    const count = photoWall.querySelectorAll('.photo-container').length;

    if (count === 0) {
      captureButton.style.display = 'none';
      photoWallContainer.style.display = 'none';
      progressContainer.style.display = 'none';
      this.updateDropAreaText();
      return;
    }

    const s = readSettings(this.ui);
    photoWall.style.padding = `${s.paddingY}px ${s.paddingX}px`;
    photoWall.style.gridTemplateColumns = `repeat(${s.columns}, 1fr)`;
    photoWall.style.rowGap = `${s.rowGap}px`;
    photoWall.style.columnGap = `${s.columnGap}px`;
    photoWall.style.maxWidth = `${s.maxWidth}px`;
    photoWall.style.backgroundColor = s.bgColor;
    photoWall.style.borderRadius = `${s.pageBorderRadius}px`;
    photoWall.style.alignItems = s.imageAlignment;
    photoWall.style.justifyItems = s.imageAlignment;

    for (const c of photoWall.querySelectorAll('.photo-container')) {
      c.style.borderRadius = `${s.imageBorderRadius}px`;
      c.style.alignItems = s.imageAlignment;
      c.style.justifyContent = s.imageAlignment;
    }
    for (const p of photoWall.querySelectorAll('.photo')) {
      p.style.borderRadius = `${s.imageBorderRadius}px`;
    }

    const perCapture = s.columns * s.rows;
    const groups = this.buildCaptureGroups();
    const totalShots = groups.reduce((sum, g) => sum + Math.ceil(g.elements.length / perCapture), 0);
    const groupSuffix = groups.length > 1 ? `（${groups.length} 个分组）` : '';
    progressText.innerText = `文件夹包含 ${count} 个图片，预计生成 ${totalShots} 张截图${groupSuffix}`;
    progressContainer.style.display = 'block';
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

  buildCaptureGroups() {
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
    const perCapture = settings.columns * settings.rows;
    const totalShots = groups.reduce((sum, g) => sum + Math.ceil(g.elements.length / perCapture), 0);

    try {
      let completedShots = 0;
      const allResults = [];
      let directoryHandle = null;
      for (const g of groups) {
        const groupShots = Math.ceil(g.elements.length / perCapture);
        const { results, directoryHandle: handleOut } = await captureAll({
          photos: g.elements,
          settings,
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
