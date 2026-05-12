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

export const SORT_PRESET_TO_EXPRESSION = {
  nameAsc: 'name ASC',
  nameDesc: 'name DESC',
  dateAsc: 'date ASC',
  dateDesc: 'date DESC',
  sizeAsc: 'size ASC',
  sizeDesc: 'size DESC',
  typeAsc: 'type ASC',
  typeDesc: 'type DESC',
  widthAsc: 'width ASC',
  widthDesc: 'width DESC',
  heightAsc: 'height ASC',
  heightDesc: 'height DESC',
  aspectRatioAsc: 'aspect ASC',
  aspectRatioDesc: 'aspect DESC',
  resolutionAsc: 'resolution ASC',
  resolutionDesc: 'resolution DESC',
};

export const SORT_FIELD_ALIASES = {
  name: 'name',
  size: 'size',
  type: 'type',
  date: 'lastModified', modified: 'lastModified', lastmodified: 'lastModified',
  width: 'width', w: 'width',
  height: 'height', h: 'height',
  aspect: 'aspectRatio', aspectratio: 'aspectRatio', ratio: 'aspectRatio',
  resolution: 'resolution', pixels: 'resolution', res: 'resolution',
};

export function parseSortExpression(expr) {
  const steps = [];
  const errors = [];
  if (!expr || typeof expr !== 'string') return { steps, errors };
  const body = expr.trim().replace(/^order\s+by\s+/i, '');
  for (const raw of body.split(/[,;]+/)) {
    let token = raw.trim();
    if (!token) continue;
    let desc = false;
    if (/^[-+]/.test(token)) {
      desc = token.startsWith('-');
      token = token.slice(1).trim();
    }
    const tail = token.match(/^(\S+)\s+(asc|desc)$/i);
    let name;
    if (tail) {
      name = tail[1];
      desc = /^desc$/i.test(tail[2]);
    } else {
      name = token;
    }
    const field = SORT_FIELD_ALIASES[name.toLowerCase()];
    if (!field) {
      errors.push(name);
      continue;
    }
    steps.push({ field, desc });
  }
  return { steps, errors };
}

function compareBySteps(a, b, steps) {
  for (const { field, desc } of steps) {
    const va = a[field];
    const vb = b[field];
    let r;
    if (typeof va === 'string' || typeof vb === 'string') {
      r = String(va ?? '').localeCompare(String(vb ?? ''));
    } else {
      r = (va || 0) - (vb || 0);
    }
    if (r !== 0) return desc ? -r : r;
  }
  return 0;
}

export function sortFiles(files, criteria) {
  if (typeof criteria === 'string' && SORT_COMPARATORS[criteria]) {
    return [...files].sort(SORT_COMPARATORS[criteria]);
  }
  const steps = Array.isArray(criteria?.steps) ? criteria.steps : [];
  if (steps.length === 0) return [...files];
  return [...files].sort((a, b) => compareBySteps(a, b, steps));
}
