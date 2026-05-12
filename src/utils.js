export const CONSTANTS = {
  DEFAULT_QUALITY: 0.8,
  ZIP_COMPRESSION_LEVEL: 9,
  CHUNK_SIZE_RENDER: 5,
  CHUNK_SIZE_CAPTURE: 2,
  LONG_PRESS_MS: 200,
  DRAG_CANCEL_DISTANCE: 10,
  CLICK_DEBOUNCE_MS: 300,
};

export const LOSSY_FORMATS = new Set(['jpg', 'jpeg', 'avif', 'webp']);

const pad2 = (n) => String(n).padStart(2, '0');

export function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

export function base64ToBlob(base64Data, contentType) {
  const byteCharacters = atob(base64Data);
  const chunks = [];
  for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
    const slice = byteCharacters.slice(offset, offset + 1024);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i);
    chunks.push(bytes);
  }
  return new Blob(chunks, { type: contentType });
}

export function createDownloadLink(base64Data, fileName, format) {
  const link = document.createElement('a');
  link.href = `data:image/${format};base64,${base64Data}`;
  link.download = fileName;
  link.innerText = `Download ${fileName}`;
  link.style.display = 'block';
  return link;
}

const SORT_COMPARATORS = {
  nameAsc: (a, b) => a.name.localeCompare(b.name),
  nameDesc: (a, b) => b.name.localeCompare(a.name),
  dateAsc: (a, b) => a.lastModified - b.lastModified,
  dateDesc: (a, b) => b.lastModified - a.lastModified,
  sizeAsc: (a, b) => a.size - b.size,
  sizeDesc: (a, b) => b.size - a.size,
  typeAsc: (a, b) => a.type.localeCompare(b.type),
  typeDesc: (a, b) => b.type.localeCompare(a.type),
  widthAsc: (a, b) => (a.width || 0) - (b.width || 0),
  widthDesc: (a, b) => (b.width || 0) - (a.width || 0),
  heightAsc: (a, b) => (a.height || 0) - (b.height || 0),
  heightDesc: (a, b) => (b.height || 0) - (a.height || 0),
  aspectRatioAsc: (a, b) => (a.aspectRatio || 0) - (b.aspectRatio || 0),
  aspectRatioDesc: (a, b) => (b.aspectRatio || 0) - (a.aspectRatio || 0),
  resolutionAsc: (a, b) => (a.resolution || (a.width * a.height)) - (b.resolution || (b.width * b.height)),
  resolutionDesc: (a, b) => (b.resolution || (b.width * b.height)) - (a.resolution || (a.width * a.height)),
};

export function sortFiles(files, order) {
  const cmp = SORT_COMPARATORS[order];
  return cmp ? [...files].sort(cmp) : [...files];
}
