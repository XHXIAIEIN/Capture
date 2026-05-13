// Justified row layout (Flickr / Google Photos style).
// - Each row: all images share the same height; row total width == contentWidth.
// - Pages: rows are packed top-to-bottom until targetPageHeight is exceeded.
// - "Reorder freedom" optionally allows local swaps via simulated annealing
//   to reduce the cost of pages where strict order produces awkward rows.

const DEFAULT_MAX_ITEMS_PER_ROW = 8;
const DEFAULT_MIN_ITEMS_PER_ROW = 1;
const LAST_ROW_HEIGHT_CAP_RATIO = 1.6;

function aspectsFromItems(items) {
  return items.map((it) => {
    const w = Number(it.width) || 1;
    const h = Number(it.height) || 1;
    return w / h;
  });
}

function rowHeightFor(sumAspect, count, contentWidth, columnGap) {
  const usable = contentWidth - (count - 1) * columnGap;
  if (usable <= 0 || sumAspect <= 0) return 0;
  return usable / sumAspect;
}

function rowCost(rowHeight, targetRowHeight) {
  if (rowHeight <= 0) return Number.POSITIVE_INFINITY;
  const d = rowHeight - targetRowHeight;
  return d * d;
}

// Strict-order DP: minimum total cost of partitioning items[0..N-1] into rows.
// Returns cut points [0, c1, c2, ..., N].
function partitionRowsStrict(aspects, contentWidth, columnGap, targetRowHeight, opts) {
  const N = aspects.length;
  const maxK = Math.max(1, opts?.maxItemsPerRow ?? DEFAULT_MAX_ITEMS_PER_ROW);
  const minK = Math.max(1, opts?.minItemsPerRow ?? DEFAULT_MIN_ITEMS_PER_ROW);

  const dp = new Array(N + 1).fill(Number.POSITIVE_INFINITY);
  const back = new Array(N + 1).fill(-1);
  dp[0] = 0;

  for (let i = 1; i <= N; i++) {
    let sumA = 0;
    for (let k = 1; k <= maxK; k++) {
      const idx = i - k;
      if (idx < 0) break;
      sumA += aspects[idx];
      if (k < minK && i !== N) continue;
      const h = rowHeightFor(sumA, k, contentWidth, columnGap);
      // Final row: don't penalize for being short, but cap the cost
      // when it would otherwise blow up (single ultrawide etc).
      const isLast = i === N;
      let cost;
      if (isLast) {
        const capped = Math.min(h, targetRowHeight * LAST_ROW_HEIGHT_CAP_RATIO);
        cost = rowCost(capped, targetRowHeight);
      } else {
        cost = rowCost(h, targetRowHeight);
      }
      const total = dp[idx] + cost;
      if (total < dp[i]) {
        dp[i] = total;
        back[i] = idx;
      }
    }
  }

  const cuts = [N];
  let p = N;
  while (p > 0 && back[p] >= 0) {
    p = back[p];
    cuts.push(p);
  }
  cuts.reverse();
  if (cuts[0] !== 0) cuts.unshift(0);
  return { cuts, cost: dp[N] };
}

function buildRowsFromCuts(items, cuts, contentWidth, columnGap, opts) {
  const rows = [];
  const targetRowHeight = opts.targetRowHeight;
  for (let r = 0; r < cuts.length - 1; r++) {
    const from = cuts[r];
    const to = cuts[r + 1];
    const slice = items.slice(from, to);
    const sumA = slice.reduce((s, it) => s + (it.width / it.height), 0);
    let h = rowHeightFor(sumA, slice.length, contentWidth, columnGap);
    const isLast = r === cuts.length - 2;
    if (isLast && h > targetRowHeight * LAST_ROW_HEIGHT_CAP_RATIO) {
      // Don't blow up the last row: cap and let it be left-aligned (won't fill width).
      h = targetRowHeight;
    }
    const rowItems = slice.map((it, k) => {
      const w = h * (it.width / it.height);
      return { source: it, sourceIndex: from + k, width: w, height: h };
    });
    rows.push({ items: rowItems, height: h, isLast });
  }
  return rows;
}

function packPages(rows, maxRowsPerShot, rowGap) {
  if (rows.length === 0) return [];
  const limit = Number.isFinite(maxRowsPerShot) && maxRowsPerShot > 0 ? maxRowsPerShot : rows.length;
  const pages = [];
  for (let i = 0; i < rows.length; i += limit) {
    const slice = rows.slice(i, i + limit);
    const height = slice.reduce((s, r) => s + r.height, 0) + (slice.length - 1) * rowGap;
    pages.push({ rows: slice, height });
  }
  return pages;
}

// Simulated annealing on top of the strict-order solution.
// Swaps two items whose index difference is <= window; accepts the swap
// if the resulting partition has lower cost (or, with probability
// exp(-Δ/T), if it's worse). Stops after `iterations` steps.
function annealOrder(items, contentWidth, columnGap, opts) {
  const window = Math.max(0, opts.reorderFreedom | 0);
  if (window <= 0) {
    const order = items.map((_, i) => i);
    return { order, ...partitionRowsStrict(aspectsFromItems(items), contentWidth, columnGap, opts.targetRowHeight, opts) };
  }

  const N = items.length;
  const iterations = Math.min(Math.max(N * 40, 500), opts.maxIterations ?? 4000);
  let order = items.map((_, i) => i);
  let aspects = aspectsFromItems(items);
  let best = partitionRowsStrict(aspects, contentWidth, columnGap, opts.targetRowHeight, opts);
  let bestOrder = order.slice();
  let cur = best.cost;
  const T0 = Math.max(best.cost / Math.max(N, 1), 1);
  const Tend = T0 * 0.01;

  for (let step = 0; step < iterations; step++) {
    const i = Math.floor(Math.random() * N);
    const delta = (Math.floor(Math.random() * window) + 1) * (Math.random() < 0.5 ? -1 : 1);
    const j = i + delta;
    if (j < 0 || j >= N || j === i) continue;
    [order[i], order[j]] = [order[j], order[i]];
    [aspects[i], aspects[j]] = [aspects[j], aspects[i]];
    const trial = partitionRowsStrict(aspects, contentWidth, columnGap, opts.targetRowHeight, opts);
    const T = T0 * Math.pow(Tend / T0, step / iterations);
    const accept = trial.cost < cur || Math.random() < Math.exp((cur - trial.cost) / T);
    if (accept) {
      cur = trial.cost;
      if (trial.cost < best.cost) {
        best = trial;
        bestOrder = order.slice();
      }
    } else {
      [order[i], order[j]] = [order[j], order[i]];
      [aspects[i], aspects[j]] = [aspects[j], aspects[i]];
    }
  }
  return { order: bestOrder, cuts: best.cuts, cost: best.cost };
}

export function computeAutoLayout(items, opts) {
  const {
    contentWidth,
    maxRowsPerShot = Number.POSITIVE_INFINITY,
    targetRowHeight,
    columnGap = 0,
    rowGap = 0,
    maxItemsPerRow = DEFAULT_MAX_ITEMS_PER_ROW,
    minItemsPerRow = DEFAULT_MIN_ITEMS_PER_ROW,
    reorderFreedom = 0,
  } = opts;

  if (!items || items.length === 0) {
    return { pages: [], orderedItems: [], rows: [] };
  }

  const ordered = items.slice();
  let cuts;
  if (reorderFreedom > 0) {
    const result = annealOrder(ordered, contentWidth, columnGap, {
      targetRowHeight, maxItemsPerRow, minItemsPerRow, reorderFreedom,
    });
    const reordered = result.order.map((i) => ordered[i]);
    cuts = result.cuts;
    const rows = buildRowsFromCuts(reordered, cuts, contentWidth, columnGap, { targetRowHeight });
    const pages = packPages(rows, maxRowsPerShot, rowGap);
    return { pages, orderedItems: reordered, rows };
  }
  const aspects = aspectsFromItems(ordered);
  const r = partitionRowsStrict(aspects, contentWidth, columnGap, targetRowHeight, { maxItemsPerRow, minItemsPerRow });
  cuts = r.cuts;
  const rows = buildRowsFromCuts(ordered, cuts, contentWidth, columnGap, { targetRowHeight });
  const pages = packPages(rows, maxRowsPerShot, rowGap);
  return { pages, orderedItems: ordered, rows };
}

// Helper: derive a sensible default target row height from settings.
// Aim for ~4 items per row at the average aspect ratio.
export function suggestTargetRowHeight(items, contentWidth, columnGap, itemsPerRow = 4) {
  if (!items.length) return Math.round(contentWidth / itemsPerRow);
  const avgAspect = items.reduce((s, it) => s + it.width / it.height, 0) / items.length;
  const sumA = avgAspect * itemsPerRow;
  const usable = contentWidth - (itemsPerRow - 1) * columnGap;
  return Math.max(80, Math.round(usable / sumA));
}
