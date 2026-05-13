import { CONSTANTS, LOSSY_FORMATS, formatDate, base64ToBlob, createDownloadLink } from './utils.js';

function basePageStyle(settings) {
  return {
    boxSizing: 'border-box',
    backgroundColor: settings.bgColor,
    padding: `${settings.paddingY}px ${settings.paddingX}px`,
    borderRadius: `${settings.pageBorderRadius}px`,
    width: `${settings.maxWidth}px`,
    position: 'fixed',
    left: '-99999px',
    top: '0',
  };
}

function buildGridCaptureNode(photos, settings) {
  const node = document.createElement('div');
  Object.assign(node.style, basePageStyle(settings), {
    display: 'grid',
    gridTemplateColumns: `repeat(${settings.columns}, 1fr)`,
    gap: `${settings.rowGap}px ${settings.columnGap}px`,
  });
  for (const photo of photos) {
    const clone = photo.cloneNode(true);
    clone.style.removeProperty('display');
    node.appendChild(clone);
  }
  return node;
}

function buildAutoCaptureNode(autoPage, settings) {
  const node = document.createElement('div');
  Object.assign(node.style, basePageStyle(settings), {
    display: 'flex',
    flexDirection: 'column',
  });
  for (let ri = 0; ri < autoPage.rows.length; ri++) {
    const row = autoPage.rows[ri];
    const rowEl = document.createElement('div');
    Object.assign(rowEl.style, {
      display: 'flex',
      height: `${row.height}px`,
      columnGap: `${settings.columnGap}px`,
      marginTop: ri > 0 ? `${settings.rowGap}px` : '0',
      boxSizing: 'border-box',
    });
    for (const item of row.items) {
      const clone = item.source.element.cloneNode(true);
      clone.style.removeProperty('display');
      clone.style.width = `${item.width}px`;
      clone.style.height = `${row.height}px`;
      clone.style.flexShrink = '0';
      clone.style.flexGrow = '0';
      clone.style.borderRadius = `${settings.imageBorderRadius}px`;
      clone.style.overflow = 'hidden';
      const img = clone.querySelector('.photo');
      if (img) {
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
      }
      rowEl.appendChild(clone);
    }
    node.appendChild(rowEl);
  }
  return node;
}

async function rasterize(node, format, quality) {
  document.body.appendChild(node);
  try {
    const canvas = await html2canvas(node, { backgroundColor: null });
    const mime = `image/${format === 'jpg' ? 'jpeg' : format}`;
    const dataUrl = LOSSY_FORMATS.has(format)
      ? canvas.toDataURL(mime, quality)
      : canvas.toDataURL(mime);
    return dataUrl.split(',')[1];
  } finally {
    node.remove();
  }
}

export async function captureChunk(photos, settings, format, quality) {
  return rasterize(buildGridCaptureNode(photos, settings), format, quality);
}

export async function captureAutoPage(autoPage, settings, format, quality) {
  return rasterize(buildAutoCaptureNode(autoPage, settings), format, quality);
}

function makeFileName(index, format, prefix = '') {
  const stem = `${String(index + 1).padStart(3, '0')}.${format}`;
  return prefix ? `${prefix}-${stem}` : stem;
}

export async function captureAll({ photos, autoPages, settings, format, quality, mode, onProgress, linksContainer, fileNamePrefix = '', directoryHandle: providedHandle = null }) {
  const isAuto = settings.layoutMode === 'auto' && Array.isArray(autoPages);
  const chunkSize = CONSTANTS.CHUNK_SIZE_CAPTURE;
  const results = [];

  const tasks = [];
  if (isAuto) {
    for (let shot = 0; shot < autoPages.length; shot++) {
      tasks.push({ shot, kind: 'auto', autoPage: autoPages[shot] });
    }
  } else {
    const perCapture = settings.columns * settings.rows;
    const totalShots = Math.ceil(photos.length / perCapture);
    for (let shot = 0; shot < totalShots; shot++) {
      const slice = photos.slice(shot * perCapture, (shot + 1) * perCapture);
      tasks.push({ shot, kind: 'grid', slice });
    }
  }

  let directoryHandle = providedHandle;
  if (mode === 'folder' && !directoryHandle) {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('您的浏览器不支持文件夹保存');
    }
    directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  }

  let done = 0;
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const batch = tasks.slice(i, i + chunkSize);
    await Promise.all(batch.map(async (task) => {
      const base64 = task.kind === 'auto'
        ? await captureAutoPage(task.autoPage, settings, format, quality)
        : await captureChunk(task.slice, settings, format, quality);
      const fileName = makeFileName(task.shot, format, fileNamePrefix);

      if (mode === 'folder') {
        const blob = base64ToBlob(base64, `image/${format}`);
        const handle = await directoryHandle.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else if (mode === 'browser') {
        const blob = base64ToBlob(base64, `image/${format}`);
        saveAs(blob, fileName);
        if (linksContainer) {
          linksContainer.appendChild(createDownloadLink(base64, fileName, format));
        }
      } else if (mode === 'zip') {
        results.push({ data: base64, index: task.shot, fileName });
      }
    }));
    done += batch.length;
    onProgress?.(done / tasks.length);
  }

  return { results, directoryHandle };
}

export async function createZipMainThread(imageDataArray, format) {
  const zip = new JSZip();
  for (let i = 0; i < imageDataArray.length; i++) {
    const { data, fileName, index } = imageDataArray[i];
    zip.file(fileName ?? makeFileName(index ?? i, format), data, { base64: true });
  }
  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: CONSTANTS.ZIP_COMPRESSION_LEVEL },
  });
}

export function downloadZip(blob) {
  saveAs(blob, `Screenshots_${formatDate(new Date())}.zip`);
}
