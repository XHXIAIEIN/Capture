import { CONSTANTS, LOSSY_FORMATS, formatDate, base64ToBlob, createDownloadLink } from './utils.js';

function buildCaptureNode(photos, settings) {
  const node = document.createElement('div');
  Object.assign(node.style, {
    display: 'grid',
    boxSizing: 'border-box',
    backgroundColor: settings.bgColor,
    gridTemplateColumns: `repeat(${settings.columns}, 1fr)`,
    gap: `${settings.rowGap}px ${settings.columnGap}px`,
    padding: `${settings.paddingY}px ${settings.paddingX}px`,
    borderRadius: `${settings.pageBorderRadius}px`,
    width: `${settings.maxWidth}px`,
    position: 'fixed',
    left: '-99999px',
    top: '0',
  });
  for (const photo of photos) node.appendChild(photo.cloneNode(true));
  return node;
}

export async function captureChunk(photos, settings, format, quality) {
  const node = buildCaptureNode(photos, settings);
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

function makeFileName(index, format, prefix = '') {
  const stem = `${String(index + 1).padStart(3, '0')}.${format}`;
  return prefix ? `${prefix}-${stem}` : stem;
}

export async function captureAll({ photos, settings, format, quality, mode, onProgress, linksContainer, fileNamePrefix = '', directoryHandle: providedHandle = null }) {
  const perCapture = settings.columns * settings.rows;
  const totalShots = Math.ceil(photos.length / perCapture);
  const chunkSize = CONSTANTS.CHUNK_SIZE_CAPTURE;
  const results = [];

  const tasks = [];
  for (let shot = 0; shot < totalShots; shot++) {
    const slice = photos.slice(shot * perCapture, (shot + 1) * perCapture);
    tasks.push({ shot, slice });
  }

  let directoryHandle = providedHandle;
  if (mode === 'folder' && !directoryHandle) {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('您的浏览器不支持文件夹保存');
    }
    directoryHandle = await window.showDirectoryPicker();
  }

  let done = 0;
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const batch = tasks.slice(i, i + chunkSize);
    await Promise.all(batch.map(async ({ shot, slice }) => {
      const base64 = await captureChunk(slice, settings, format, quality);
      const fileName = makeFileName(shot, format, fileNamePrefix);

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
        results.push({ data: base64, index: shot, fileName });
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
