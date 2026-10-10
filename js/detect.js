// Finds a printed sudoku in a grayscale photo and cuts out the digits.
// Pure functions on { data: Uint8Array, width, height }, so they run in the
// worker and in node tests alike.

export const CELL = 48; // side of a cell in the rectified grid
export const FEAT = 24; // side of the normalised digit image fed to the net
const DETECT_SIDE = 640; // grid search runs on a downscaled copy

export function grayFromRGBA(rgba, width, height) {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return { data, width, height };
}

export function downscale(img, maxSide) {
  const f = Math.max(img.width, img.height) / maxSide;
  if (f <= 1) return { img, scale: 1 };
  const W = img.width,
    H = img.height,
    src = img.data;
  const w = Math.round(W / f),
    h = Math.round(H / f);
  const xs = new Int32Array(w + 1);
  for (let x = 0; x <= w; x++) xs[x] = Math.min(W, Math.floor(x * f));
  const out = new Uint8Array(w * h);
  // box filter over the source footprint of each target pixel
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * f),
      y1 = Math.min(H, Math.max(y0 + 1, Math.floor((y + 1) * f)));
    for (let x = 0; x < w; x++) {
      const x0 = xs[x],
        x1 = Math.max(x0 + 1, xs[x + 1]);
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * W;
        for (let xx = x0; xx < x1; xx++) sum += src[row + xx];
      }
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { img: { data: out, width: w, height: h }, scale: f };
}

function integral(img) {
  const { data, width: w, height: h } = img;
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
    }
  }
  return ii;
}

/** 1 where a pixel is darker than its neighbourhood mean by more than c(mean). */
export function adaptiveThreshold(img, radius, c) {
  const { data, width: w, height: h } = img;
  const ii = integral(img);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius),
      y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius),
        x1 = Math.min(w, x + radius + 1);
      const sum =
        ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      out[y * w + x] = data[y * w + x] < mean - c(mean) ? 1 : 0;
    }
  }
  return out;
}

/** 8-connected components of the 1-pixels. Returns labels (0 = none) and stats. */
export function components(bin, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const comps = [null];
  for (let start = 0; start < w * h; start++) {
    if (!bin[start] || labels[start]) continue;
    const id = comps.length;
    let sp = 0,
      n = 0,
      x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w,
        y = (p - x) / w;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (bin[q] && !labels[q]) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push({ id, n, x0, y0, x1, y1 });
  }
  return { labels, comps };
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower = [],
    upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const polyArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};

/** Largest-area quadrilateral with corners on the hull. */
function maxQuad(hull) {
  let h = hull;
  // thin out long hulls; the corners we want are sharp and survive this
  while (h.length > 48) h = h.filter((_, i) => i % 2 === 0);
  const n = h.length;
  if (n < 4) return null;
  let best = null,
    bestA = 0;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const q = [h[a], h[b], h[c], h[d]];
          const ar = polyArea(q);
          if (ar > bestA) {
            bestA = ar;
            best = q;
          }
        }
  return best;
}

/** Corners sorted as top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(q) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4,
    cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const byAngle = q
    .slice()
    .sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // clockwise on screen; top-left is the one furthest up-left
  let k = 0;
  for (let i = 1; i < 4; i++) if (byAngle[i][0] + byAngle[i][1] < byAngle[k][0] + byAngle[k][1]) k = i;
  return [0, 1, 2, 3].map((i) => byAngle[(k + i) % 4]);
}

/** Homography h (row-major 3x3, h[8] = 1) with h * src[i] ~ dst[i]. */
export function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i],
      [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 9; k++) A[r][k] -= f * A[col][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

export function project(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Rectifies the quad into a square of side `size` (bilinear sampling). */
export function warp(img, corners, size) {
  const h = homography(
    [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
    ],
    corners,
  );
  const { data, width: w, height: H } = img;
  const out = new Uint8Array(size * size);
  const [a, b, c, d, e, f, g, k] = h;
  for (let v = 0; v < size; v++) {
    const vv = v + 0.5;
    for (let u = 0; u < size; u++) {
      const uu = u + 0.5;
      const z = g * uu + k * vv + 1;
      const fx = Math.min(w - 1.001, Math.max(0, (a * uu + b * vv + c) / z - 0.5)),
        fy = Math.min(H - 1.001, Math.max(0, (d * uu + e * vv + f) / z - 0.5));
      const x0 = fx | 0,
        y0 = fy | 0,
        ax = fx - x0,
        ay = fy - y0;
      const p = y0 * w + x0;
      out[v * size + u] =
        (data[p] * (1 - ax) + data[p + 1] * ax) * (1 - ay) +
        (data[p + w] * (1 - ax) + data[p + w + 1] * ax) * ay;
    }
  }
  return { data: out, width: size, height: size };
}

/**
 * How much the rectified binary images look like a 9x9 grid: the box lines
 * (every third) must be dark along their whole length in the grid's own
 * component, the thin lines at least in the full threshold image (they often
 * break into dots), and the space between lines must be mostly free.
 */
function gridScore(comp, full, n) {
  const c = n / 9;
  const tol = Math.max(1, Math.round(c * 0.08));
  const lineFrac = (bin, k, vertical) => {
    let best = 0;
    const p0 = Math.round(k * c);
    for (let p = Math.max(0, p0 - tol); p <= Math.min(n - 2, p0 + tol); p++) {
      let s = 0;
      for (let t = 0; t < n; t++) {
        // a line can wobble by a pixel, so accept a hit in the neighbours too
        s += vertical ? bin[t * n + p] | bin[t * n + p + 1] : bin[p * n + t] | bin[(p + 1) * n + t];
      }
      best = Math.max(best, s / n);
    }
    return best;
  };
  let thick = 0,
    thin = 0,
    off = 0;
  for (let k = 0; k <= 9; k++) {
    for (const v of [false, true]) {
      if (k % 3 === 0) thick += Math.max(lineFrac(comp, k, v), lineFrac(full, k, v)) / 8;
      else thin += lineFrac(full, k, v) / 12;
    }
  }
  for (let k = 0; k < 9; k++) {
    const p = Math.round((k + 0.5) * c);
    let s = 0;
    for (let t = 0; t < n; t++) s += comp[p * n + t] + comp[t * n + p];
    off += s / (2 * n) / 9;
  }
  return 0.6 * thick + 0.4 * thin - off;
}

/** Nearest-pixel rectification of the component mask and the threshold image. */
function sampleGrid(labels, bin, w, h, id, corners, N) {
  const H = homography(
    [
      [0, 0],
      [N, 0],
      [N, N],
      [0, N],
    ],
    corners,
  );
  const comp = new Uint8Array(N * N),
    full = new Uint8Array(N * N);
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const [x, y] = project(H, u + 0.5, v + 0.5);
      const x0 = Math.min(w - 2, Math.max(0, Math.floor(x - 0.5))),
        y0 = Math.min(h - 2, Math.max(0, Math.floor(y - 0.5)));
      const p = y0 * w + x0;
      const k = v * N + u;
      comp[k] =
        labels[p] === id || labels[p + 1] === id || labels[p + w] === id || labels[p + w + 1] === id ? 1 : 0;
      full[k] = bin[p] | bin[p + 1] | bin[p + w] | bin[p + w + 1];
    }
  }
  return { comp, full };
}

/**
 * Locates the grid. Returns { corners, score } in the coordinates of `img`,
 * or null.
 */
export function findGrid(img) {
  const { img: small, scale } = downscale(img, DETECT_SIDE);
  const { width: w, height: h } = small;
  const radius = Math.max(5, Math.round(Math.min(w, h) / 40));
  const bin = adaptiveThreshold(small, radius, (m) => 4 + m * 0.06);
  const { labels, comps } = components(bin, w, h);
  const minSide = Math.min(w, h) * 0.15;
  const cands = comps
    .filter((c) => c && c.x1 - c.x0 > minSide && c.y1 - c.y0 > minSide)
    .sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
    .slice(0, 6);
  let best = null;
  for (const c of cands) {
    const pts = [];
    for (let y = c.y0; y <= c.y1; y++) {
      let lo = -1,
        hi = -1;
      for (let x = c.x0; x <= c.x1; x++) {
        if (labels[y * w + x] === c.id) {
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      if (lo >= 0) pts.push([lo, y], [hi + 1, y], [lo, y + 1], [hi + 1, y + 1]);
    }
    const quad = maxQuad(convexHull(pts));
    if (!quad || polyArea(quad) < minSide * minSide) continue;
    const corners = orderCorners(quad);
    // score on the component itself, so clutter around does not count; sample
    // at about native resolution so one-pixel lines stay connected
    const side = Math.sqrt(polyArea(quad));
    const N = 9 * Math.max(12, Math.min(40, Math.round(side / 9)));
    const { comp, full } = sampleGrid(labels, bin, w, h, c.id, corners, N);
    const score = gridScore(comp, full, N);
    if (globalThis.DEBUG_GRID) console.log(c.n, c.x1 - c.x0, c.y1 - c.y0, score.toFixed(3));
    if (!best || score > best.score) best = { corners, score };
  }
  if (!best || best.score < 0.55) return null;
  best.corners = best.corners.map(([x, y]) => [x * scale, y * scale]);
  return best;
}

function localMean(img, radius) {
  const { width: w, height: h } = img;
  const ii = integral(img);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius),
      y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius),
        x1 = Math.min(w, x + radius + 1);
      const sum =
        ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** q-quantile of 8-bit values (array-like), via a histogram. */
function percentile(values, q, count = values.length) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < count; i++) hist[values[i]]++;
  const want = Math.min(count - 1, Math.floor(q * count));
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > want) return v;
  }
  return 255;
}

/**
 * Cuts the digit out of every cell of the rectified grid (side 9*CELL).
 * Returns 81 entries, null for an empty cell, else { feat: Float32Array(FEAT²),
 * box: [x0, y0, x1, y1] in rectified pixels }.
 */
export function extractCells(rect) {
  const n = rect.width,
    S = CELL;
  const m = Math.round(S * 0.1),
    inner = S - 2 * m;
  const mean = localMean(rect, Math.round(S * 0.6));
  // overall contrast, from the grid lines, sets the floor for "this is ink"
  const all = percentile(rect.data, 0.03),
    bright = percentile(rect.data, 0.7);
  const minC = Math.max(10, (bright - all) * 0.1);
  const cell = new Uint8Array(inner * inner);
  const vals = new Uint8Array(inner * inner);
  const core = new Uint8Array(inner * inner);
  const e = Math.round(inner * 0.2);
  const out = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const ox = c * S + m,
        oy = r * S + m;
      let nc = 0;
      for (let y = 0; y < inner; y++) {
        for (let x = 0; x < inner; x++) {
          const v = rect.data[(oy + y) * n + ox + x];
          vals[y * inner + x] = v;
          if (y >= e && y < inner - e && x >= e && x < inner - e) core[nc++] = v;
        }
      }
      // the digit's own darkness against the paper around it
      const ink = percentile(core, 0.02, nc),
        paper = percentile(vals, 0.5);
      const t = Math.max(minC, (paper - ink) * 0.35);
      for (let y = 0; y < inner; y++) {
        for (let x = 0; x < inner; x++) {
          const k = (oy + y) * n + ox + x;
          cell[y * inner + x] = rect.data[k] < Math.min(mean[k], paper) - t ? 1 : 0;
        }
      }
      out.push(paper - ink < minC * 1.5 ? null : cellDigit(cell, inner, ox, oy));
    }
  }
  return out;
}

function cellDigit(cell, inner, ox, oy) {
  const { labels, comps } = components(cell, inner, inner);
  // pixels away from the cell edge; remnants of grid lines have almost none
  const core = new Int32Array(comps.length);
  const e = Math.round(inner * 0.15);
  for (let y = e; y < inner - e; y++) for (let x = e; x < inner - e; x++) core[labels[y * inner + x]]++;
  const keep = [];
  for (const c of comps) {
    if (!c || c.n < 4) continue;
    const touches = c.x0 === 0 || c.y0 === 0 || c.x1 === inner - 1 || c.y1 === inner - 1;
    if (touches && core[c.id] < c.n * 0.4) continue;
    keep.push(c);
  }
  // the digit: all blobs near the middle (thin strokes can break apart)
  const parts = new Set();
  let x0 = inner,
    y0 = inner,
    x1 = -1,
    y1 = -1;
  for (const c of keep) {
    const cx = (c.x0 + c.x1) / 2,
      cy = (c.y0 + c.y1) / 2;
    if (Math.abs(cx - inner / 2) > inner * 0.32 || Math.abs(cy - inner / 2) > inner * 0.32) continue;
    parts.add(c.id);
    x0 = Math.min(x0, c.x0);
    y0 = Math.min(y0, c.y0);
    x1 = Math.max(x1, c.x1);
    y1 = Math.max(y1, c.y1);
  }
  if (!parts.size || y1 - y0 + 1 < inner * 0.3) return null;
  const bw = x1 - x0 + 1,
    bh = y1 - y0 + 1;
  // a lone dash or dot is not a digit
  if (bw > bh * 1.6) return null;
  const feat = new Float32Array(FEAT * FEAT);
  const target = FEAT - 4;
  const s = target / Math.max(bh, bw);
  const offX = (FEAT - bw * s) / 2,
    offY = (FEAT - bh * s) / 2;
  // area-weighted resampling of the selected blobs
  const SS = 4;
  for (let fy = 0; fy < FEAT; fy++) {
    for (let fx = 0; fx < FEAT; fx++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        const y = Math.floor(y0 + (fy + (sy + 0.5) / SS - offY) / s);
        if (y < y0 || y > y1) continue;
        for (let sx = 0; sx < SS; sx++) {
          const x = Math.floor(x0 + (fx + (sx + 0.5) / SS - offX) / s);
          if (x < x0 || x > x1) continue;
          if (parts.has(labels[y * inner + x])) hit++;
        }
      }
      feat[fy * FEAT + fx] = hit / (SS * SS);
    }
  }
  const pix = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++)
      if (parts.has(labels[y * inner + x])) pix.push((oy + y) * 9 * CELL + ox + x);
  }
  return { feat, box: [ox + x0, oy + y0, ox + x1 + 1, oy + y1 + 1], pix };
}

/** Whole pipeline up to the cut-out digits. */
export function analyse(img) {
  const grid = findGrid(img);
  if (!grid) return null;
  // shrink with a box filter first: bilinear sampling alone would skip thin strokes
  const q = grid.corners;
  const side = Math.max(...q.map((p, i) => Math.hypot(p[0] - q[(i + 1) % 4][0], p[1] - q[(i + 1) % 4][1])));
  const f = side / (9 * CELL * 1.2);
  let src = img,
    corners = q;
  if (f > 1) {
    src = downscale(img, Math.max(img.width, img.height) / f).img;
    const sx = src.width / img.width;
    corners = q.map(([x, y]) => [x * sx, y * sx]);
  }
  const rect = warp(src, corners, 9 * CELL);
  return { ...grid, rect, cells: extractCells(rect) };
}

/** Colour version of warp for display: RGBA in, RGBA square out. */
export function warpRGBA(rgba, width, height, corners, size) {
  const h = homography(
    [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
    ],
    corners,
  );
  const out = new Uint8ClampedArray(size * size * 4);
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const [x, y] = project(h, u + 0.5, v + 0.5);
      const fx = Math.min(width - 1.001, Math.max(0, x - 0.5)),
        fy = Math.min(height - 1.001, Math.max(0, y - 0.5));
      const x0 = fx | 0,
        y0 = fy | 0,
        ax = fx - x0,
        ay = fy - y0;
      const p = (y0 * width + x0) * 4,
        q = p + width * 4,
        o = (v * size + u) * 4;
      for (let ch = 0; ch < 3; ch++) {
        out[o + ch] =
          (rgba[p + ch] * (1 - ax) + rgba[p + 4 + ch] * ax) * (1 - ay) +
          (rgba[q + ch] * (1 - ax) + rgba[q + 4 + ch] * ax) * ay;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The rectified grid turned by k quarter turns, matching rotateCorners(c, k). */
export function rotateRect(rect, k) {
  let { data } = rect;
  const n = rect.width;
  for (let t = 0; t < ((k % 4) + 4) % 4; t++) {
    const out = new Uint8Array(n * n);
    for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) out[v * n + u] = data[u * n + n - 1 - v];
    data = out;
  }
  return { data, width: n, height: n };
}

/** Corners starting at another one: the grid seen a quarter turn k times further. */
export const rotateCorners = (corners, k) => [0, 1, 2, 3].map((i) => corners[(i + k) % 4]);
