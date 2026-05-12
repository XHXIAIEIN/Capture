import { CONSTANTS, loadImage, sortFiles, formatDate, deriveFilenameParts, deriveOrientation, groupDescriptors, flattenGroups } from './utils.js';

function applyGrouping(descs, groupBy) {
  if (!groupBy || groupBy === 'none') return descs;
  return flattenGroups(groupDescriptors(descs, groupBy));
}

async function buildFileDescriptor(file) {
  const img = await loadImage(file);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const { ext, basename } = deriveFilenameParts(file.name);
  return {
    name: file.name,
    basename,
    ext,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    width,
    height,
    aspectRatio: parseFloat((width / height).toFixed(2)),
    resolution: width * height,
    orientation: deriveOrientation(width, height),
    file,
  };
}

export function buildPhotoElement(desc, onDragStart) {
  const img = new Image();
  img.src = URL.createObjectURL(desc.file);
  img.className = 'photo';
  img.alt = desc.name;
  img.title = desc.name;
  img.draggable = false;
  img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });

  const container = document.createElement('div');
  container.className = 'photo-container';
  container.dataset.name = desc.name;
  container.dataset.basename = desc.basename ?? desc.name;
  container.dataset.ext = desc.ext ?? '';
  container.dataset.size = String(desc.size);
  container.dataset.type = desc.type;
  container.dataset.lastModified = String(desc.lastModified);
  container.dataset.width = String(desc.width);
  container.dataset.height = String(desc.height);
  container.dataset.aspectRatio = String(desc.aspectRatio);
  container.dataset.resolution = String(desc.resolution);
  container.dataset.orientation = String(desc.orientation ?? 0);
  container.appendChild(img);

  if (onDragStart) onDragStart(container);
  return container;
}

function readDescriptorFromElement(el) {
  return {
    name: el.dataset.name,
    basename: el.dataset.basename ?? el.dataset.name,
    ext: el.dataset.ext ?? '',
    size: parseInt(el.dataset.size, 10),
    type: el.dataset.type,
    lastModified: parseInt(el.dataset.lastModified, 10),
    width: parseInt(el.dataset.width, 10),
    height: parseInt(el.dataset.height, 10),
    aspectRatio: parseFloat(el.dataset.aspectRatio),
    resolution: parseInt(el.dataset.resolution, 10),
    orientation: parseInt(el.dataset.orientation ?? '0', 10),
    element: el,
  };
}

export class FileImporter {
  constructor({ photoWall, onDragStart, onProgress, onComplete }) {
    this.photoWall = photoWall;
    this.onDragStart = onDragStart;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.descriptors = [];
    this.worker = null;
    this.initWorker();
  }

  initWorker() {
    try {
      this.worker = new Worker('./worker.js');
      this.worker.onmessage = (e) => this.handleWorkerMessage(e);
      this.worker.onerror = (err) => {
        console.error('Worker error:', err);
        this.worker = null;
      };
    } catch (err) {
      console.warn('Worker unavailable, using main thread:', err);
      this.worker = null;
    }
  }

  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  insertElement(el) {
    this.photoWall.appendChild(el);
  }

  clearDom() {
    [...this.photoWall.querySelectorAll('.photo-container')].forEach((el) => el.remove());
  }

  syncDescriptorsFromDOM() {
    this.descriptors = [...this.photoWall.querySelectorAll('.photo-container')].map(readDescriptorFromElement);
  }

  async renderChunked(descriptors, append) {
    if (!append) this.clearDom();
    const chunkSize = CONSTANTS.CHUNK_SIZE_RENDER;
    let rendered = 0;
    for (let i = 0; i < descriptors.length; i += chunkSize) {
      const chunk = descriptors.slice(i, i + chunkSize);
      await new Promise((resolve) => setTimeout(() => {
        for (const desc of chunk) {
          const el = buildPhotoElement(desc, this.onDragStart);
          desc.element = el;
          this.insertElement(el);
        }
        rendered = Math.min(i + chunkSize, descriptors.length);
        this.onProgress?.(rendered / descriptors.length);
        resolve();
      }, 0));
    }
  }

  async handleFiles(fileList, { isAppend, appendMode, sortOrder, groupBy }) {
    const images = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      this.onComplete?.({ added: 0, total: this.descriptors.length, empty: true });
      return;
    }

    if (this.worker) {
      const existing = isAppend
        ? this.descriptors.map(({ element, ...rest }) => rest)
        : [];
      this.worker.postMessage({
        type: 'processFiles',
        data: {
          files: images,
          sortOrder,
          isAppend,
          appendMode,
          existingFiles: existing,
        },
      });
      this._pendingAppend = isAppend;
      this._pendingAppendMode = appendMode;
      this._pendingAddedCount = images.length;
      this._pendingGroupBy = groupBy;
    } else {
      await this.handleFilesMainThread(images, { isAppend, appendMode, sortOrder, groupBy });
    }
  }

  async handleFilesMainThread(images, { isAppend, appendMode, sortOrder, groupBy }) {
    const newDescs = [];
    for (let i = 0; i < images.length; i++) {
      try {
        newDescs.push(await buildFileDescriptor(images[i]));
      } catch (err) {
        console.error('加载图片失败:', images[i].name, err);
      }
      this.onProgress?.((i + 1) / images.length, 'metadata');
    }

    let finalDescs;
    let renderAppendOnly = false;
    if (isAppend && this.descriptors.length > 0) {
      if (appendMode === 'append' && (!groupBy || groupBy === 'none')) {
        const sortedNew = sortFiles(newDescs, sortOrder);
        finalDescs = [...this.descriptors, ...sortedNew];
        renderAppendOnly = true;
      } else {
        finalDescs = applyGrouping(sortFiles([...this.descriptors, ...newDescs], sortOrder), groupBy);
      }
    } else {
      finalDescs = applyGrouping(sortFiles(newDescs, sortOrder), groupBy);
    }

    if (renderAppendOnly) {
      const onlyNew = finalDescs.slice(this.descriptors.length);
      this.descriptors = finalDescs;
      await this.renderChunked(onlyNew, true);
    } else {
      this.descriptors = finalDescs;
      await this.renderChunked(finalDescs, false);
    }
    this.onComplete?.({ added: newDescs.length, total: this.descriptors.length });
  }

  handleWorkerMessage(e) {
    const msg = e.data;
    if (msg.type === 'zipCreated' && this._zipResolver) {
      this._zipResolver(msg.data);
      this._zipResolver = null;
      return;
    }
    if (msg.type === 'error' && this._zipResolver) {
      this._zipRejector(new Error(msg.error));
      this._zipResolver = null;
      this._zipRejector = null;
      return;
    }
    switch (msg.type) {
      case 'progress':
        this.onProgress?.(msg.percentage / 100, msg.phase, msg);
        break;
      case 'filesProcessed': {
        const sorted = msg.data;
        const wasAppend = msg.isAppend;
        const groupBy = this._pendingGroupBy;
        const appendOnly = wasAppend && this._pendingAppendMode === 'append' && (!groupBy || groupBy === 'none');
        const previousCount = this.descriptors.length;
        const finalDescs = appendOnly ? sorted : applyGrouping(sorted, groupBy);
        this.descriptors = finalDescs;
        if (appendOnly) {
          this.renderChunked(finalDescs.slice(previousCount), true)
            .then(() => this.onComplete?.({ added: this._pendingAddedCount, total: this.descriptors.length }));
        } else {
          this.renderChunked(finalDescs, false)
            .then(() => this.onComplete?.({ added: this._pendingAddedCount, total: this.descriptors.length }));
        }
        break;
      }
      case 'filesSorted': {
        const grouped = applyGrouping(msg.data, this._pendingGroupBy);
        this.descriptors = grouped;
        this.renderChunked(grouped, false)
          .then(() => this.onComplete?.({ added: 0, total: this.descriptors.length, sortedOnly: true }));
        break;
      }
      case 'error':
        console.error(`Worker error (${msg.phase}):`, msg.error);
        this.onComplete?.({ error: msg.error });
        break;
    }
  }

  resort(order, groupBy) {
    if (this.descriptors.length === 0) return;
    this._pendingGroupBy = groupBy;
    // Sort + group in main thread, then reorder existing DOM nodes.
    // Avoids re-building photo elements and the cost of round-tripping File
    // objects through the worker just to change order.
    this.descriptors = applyGrouping(sortFiles(this.descriptors, order), groupBy);
    this.reorderDom();
    this.onComplete?.({ added: 0, total: this.descriptors.length, sortedOnly: true });
  }

  reorderDom() {
    for (const desc of this.descriptors) {
      if (desc.element) this.photoWall.appendChild(desc.element);
    }
  }

  getPhotoElements() {
    return [...this.photoWall.querySelectorAll('.photo-container')];
  }

  createZipInWorker(imageDataArray, format) {
    if (!this.worker) return Promise.reject(new Error('worker unavailable'));
    return new Promise((resolve, reject) => {
      this._zipResolver = resolve;
      this._zipRejector = reject;
      this.worker.postMessage({ type: 'createZip', data: { imageDataArray, format } });
    });
  }
}
