export const CONSTANTS = {
  DEFAULT_QUALITY: 0.8,
  ZIP_COMPRESSION_LEVEL: 9,
  CHUNK_SIZE_RENDER: 5,
  CHUNK_SIZE_CAPTURE: 2,
  LONG_PRESS_MS: 280,
  DRAG_CANCEL_DISTANCE: 14,
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

const NATURAL = { numeric: true };
const natCmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, NATURAL);
const numCmp = (a, b) => (a || 0) - (b || 0);

export function deriveFilenameParts(filename) {
  const s = String(filename ?? '');
  const i = s.lastIndexOf('.');
  if (i <= 0) return { ext: '', basename: s };
  return { ext: s.slice(i + 1).toLowerCase(), basename: s.slice(0, i) };
}

export function deriveOrientation(width, height) {
  if (width > height) return 1;
  if (width < height) return -1;
  return 0;
}

const SORT_COMPARATORS = {
  nameAsc: (a, b) => natCmp(a.basename ?? a.name, b.basename ?? b.name),
  nameDesc: (a, b) => natCmp(b.basename ?? b.name, a.basename ?? a.name),
  dateAsc: (a, b) => numCmp(a.lastModified, b.lastModified),
  dateDesc: (a, b) => numCmp(b.lastModified, a.lastModified),
  sizeAsc: (a, b) => numCmp(a.size, b.size),
  sizeDesc: (a, b) => numCmp(b.size, a.size),
  extAsc: (a, b) => natCmp(a.ext, b.ext),
  extDesc: (a, b) => natCmp(b.ext, a.ext),
  widthAsc: (a, b) => numCmp(a.width, b.width),
  widthDesc: (a, b) => numCmp(b.width, a.width),
  heightAsc: (a, b) => numCmp(a.height, b.height),
  heightDesc: (a, b) => numCmp(b.height, a.height),
  aspectRatioAsc: (a, b) => numCmp(a.aspectRatio, b.aspectRatio),
  aspectRatioDesc: (a, b) => numCmp(b.aspectRatio, a.aspectRatio),
  resolutionAsc: (a, b) => numCmp(a.resolution, b.resolution),
  resolutionDesc: (a, b) => numCmp(b.resolution, a.resolution),
};

export const SORT_PRESET_TO_EXPRESSION = {
  nameAsc: 'name ASC',
  nameDesc: 'name DESC',
  dateAsc: 'date ASC',
  dateDesc: 'date DESC',
  sizeAsc: 'size ASC',
  sizeDesc: 'size DESC',
  extAsc: 'ext ASC',
  extDesc: 'ext DESC',
  widthAsc: 'width ASC',
  widthDesc: 'width DESC',
  heightAsc: 'height ASC',
  heightDesc: 'height DESC',
  aspectRatioAsc: 'aspect ASC',
  aspectRatioDesc: 'aspect DESC',
  resolutionAsc: 'resolution ASC',
  resolutionDesc: 'resolution DESC',
  orientationLandscape: 'orientation DESC',
  orientationPortrait: 'orientation ASC',
};

export const SORT_FIELD_ALIASES = {
  name: 'basename', basename: 'basename',
  size: 'size',
  ext: 'ext', extension: 'ext',
  date: 'lastModified', modified: 'lastModified', lastmodified: 'lastModified',
  width: 'width', w: 'width',
  height: 'height', h: 'height',
  aspect: 'aspectRatio', aspectratio: 'aspectRatio', ratio: 'aspectRatio',
  resolution: 'resolution', pixels: 'resolution', res: 'resolution',
  orientation: 'orientation', orient: 'orientation',
  random: 'random', shuffle: 'random', rand: 'random',
};

export function parseSortExpression(expr) {
  const steps = [];
  const errors = [];
  if (!expr || typeof expr !== 'string') return { steps, errors };
  for (const raw of expr.split(/[,;]+/)) {
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
    let r;
    if (field === 'random') {
      r = numCmp(a._rand, b._rand);
    } else {
      const va = a[field];
      const vb = b[field];
      if (typeof va === 'string' || typeof vb === 'string') {
        r = natCmp(va, vb);
      } else {
        r = numCmp(va, vb);
      }
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
  if (steps.some((s) => s.field === 'random')) {
    for (const item of files) item._rand = Math.random();
  }
  return [...files].sort((a, b) => compareBySteps(a, b, steps));
}

const ORIENTATION_LABEL = { '-1': 'portrait', '0': 'square', '1': 'landscape' };
const ORIENTATION_ORDER = { landscape: 0, square: 1, portrait: 2 };

function aspectBand(r) {
  if (!r) return 'unknown';
  if (r >= 2) return 'ultrawide';
  if (r >= 1.2) return 'landscape';
  if (r > 0.83) return 'square';
  if (r > 0.5) return 'portrait';
  return 'ultratall';
}
const ASPECT_ORDER = { ultrawide: 0, landscape: 1, square: 2, portrait: 3, ultratall: 4, unknown: 5 };

export const GROUP_OPTIONS = {
  none: {
    label: '无分组',
    key: null,
  },
  orientation: {
    label: '方向',
    key: (d) => ORIENTATION_LABEL[String(d.orientation ?? 0)] ?? 'square',
    order: (k) => ORIENTATION_ORDER[k] ?? 99,
  },
  ext: {
    label: '扩展名',
    key: (d) => (d.ext || 'unknown').toLowerCase(),
    order: (k) => k,
  },
  aspect: {
    label: '宽高比',
    key: (d) => aspectBand(d.aspectRatio),
    order: (k) => ASPECT_ORDER[k] ?? 99,
  },
};

export function groupDescriptors(descs, groupBy) {
  const opt = GROUP_OPTIONS[groupBy];
  if (!opt || !opt.key) return [{ key: null, items: [...descs] }];
  const buckets = new Map();
  for (const d of descs) {
    const k = opt.key(d);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(d);
  }
  const orderFn = opt.order ?? ((k) => k);
  return [...buckets.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => {
      const oa = orderFn(a.key);
      const ob = orderFn(b.key);
      if (typeof oa === 'number' && typeof ob === 'number') return oa - ob;
      return String(oa).localeCompare(String(ob), undefined, NATURAL);
    });
}

export function flattenGroups(groups) {
  const out = [];
  for (const g of groups) out.push(...g.items);
  return out;
}

const GROUP_KEY_LABELS = {
  orientation: { landscape: '横图', portrait: '竖图', square: '方图' },
  aspect: {
    ultrawide: '超宽', landscape: '横向', square: '方形', portrait: '竖向', ultratall: '超竖',
  },
};

export function groupKeyLabel(groupBy, key) {
  if (key == null) return '全部';
  return GROUP_KEY_LABELS[groupBy]?.[key] ?? String(key);
}
