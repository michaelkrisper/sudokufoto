import { conflicts, solve } from './solver.js';

const $ = (id) => document.getElementById(id);
const STORE = 'sudokufoto-v1';
const UNSURE = 0.9;

const S = {
  givens: new Array(81).fill(0),
  hand: new Array(81).fill(0), // handwritten entries, not part of the puzzle
  unsure: new Set(),
  photo: null, // data URL of the rectified photo
  solution: null,
  count: 0,
  sel: -1,
};

// --- no scrolling, no zooming, also on iOS which ignores user-scalable=no ---
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);
let lastTouch = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouch < 350) e.preventDefault();
    lastTouch = now;
  },
  { passive: false },
);
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

// --- worker ---
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let jobId = 0;
const jobs = new Map();
worker.onmessage = ({ data }) => {
  jobs.get(data.id)?.(data);
  jobs.delete(data.id);
};
function recognise(imageData) {
  const id = ++jobId;
  return new Promise((resolve) => {
    jobs.set(id, resolve);
    worker.postMessage(
      { id, rgba: imageData.data.buffer, width: imageData.width, height: imageData.height },
      [imageData.data.buffer],
    );
  });
}

// --- screens ---
function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== name;
  if (name === 'cam') startCamera();
  else stopCamera();
}

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]')?.dataset.go;
  if (go) show(go);
});

// --- camera ---
const video = $('video');
const overlay = $('overlay');
let stream = null;
let live = false;
let busyFrame = false;
let streak = { key: '', n: 0 };

async function startCamera() {
  $('still').hidden = true;
  $('last').hidden = !localStorage.getItem(STORE);
  setHint('Sudoku ins Bild halten');
  if (stream) {
    live = true;
    loop();
    return;
  }
  const msg = $('cam-msg');
  if (!navigator.mediaDevices?.getUserMedia) {
    msg.innerHTML = '<b>Keine Kamera verfügbar</b>Wähle unten links ein Foto aus der Galerie.';
    msg.hidden = false;
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    msg.hidden = true;
    live = true;
    streak = { key: '', n: 0 };
    loop();
  } catch {
    msg.innerHTML =
      '<b>Kein Zugriff auf die Kamera</b>Erlaube den Kamerazugriff in den Einstellungen oder wähle unten links ein Foto aus der Galerie.';
    msg.hidden = false;
  }
}

function stopCamera() {
  live = false;
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
  video.srcObject = null;
  clearOverlay();
}

function setHint(text, ok = false) {
  const h = $('cam-hint');
  h.textContent = text;
  h.classList.toggle('ok', ok);
}

function frame(maxSide) {
  const w = video.videoWidth,
    h = video.videoHeight;
  const f = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * f);
  c.height = Math.round(h * f);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(video, 0, 0, c.width, c.height);
  return { canvas: c, data: g.getImageData(0, 0, c.width, c.height), f };
}

async function loop() {
  if (!live || busyFrame) return;
  if (!video.videoWidth) {
    requestAnimationFrame(loop);
    return;
  }
  busyFrame = true;
  const { data, f } = frame(960);
  const r = await recognise(data);
  busyFrame = false;
  if (!live) return;
  if (r.found) {
    drawQuad(
      r.corners.map(([x, y]) => [x / f, y / f]),
      r.count === 1,
    );
    const key = r.digits.join('');
    streak = key === streak.key ? { key, n: streak.n + 1 } : { key, n: 1 };
    if (r.count === 1) {
      setHint('Erkannt – stillhalten', true);
      // the same unique puzzle in consecutive frames: take it
      if (streak.n >= 2) {
        navigator.vibrate?.(40);
        live = false;
        accept(r);
        return;
      }
    } else setHint(r.count === 0 ? 'Raster gefunden – näher ran' : 'Raster gefunden – ruhig halten');
  } else {
    clearOverlay();
    streak = { key: '', n: 0 };
    setHint('Sudoku ins Bild halten');
  }
  setTimeout(loop, 60);
}

function overlayGeometry() {
  const rect = overlay.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  if (overlay.width !== Math.round(rect.width * dpr)) {
    overlay.width = Math.round(rect.width * dpr);
    overlay.height = Math.round(rect.height * dpr);
  }
  // video is shown with object-fit: cover
  const s = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  return {
    dpr,
    s,
    ox: (rect.width - video.videoWidth * s) / 2,
    oy: (rect.height - video.videoHeight * s) / 2,
  };
}

function clearOverlay() {
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

function drawQuad(corners, ok) {
  const { dpr, s, ox, oy } = overlayGeometry();
  const g = overlay.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, overlay.width, overlay.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.beginPath();
  for (const [i, [x, y]] of corners.entries()) g[i ? 'lineTo' : 'moveTo'](ox + x * s, oy + y * s);
  g.closePath();
  g.lineWidth = 3;
  g.strokeStyle = ok ? '#30d158' : '#ffd60a';
  g.fillStyle = ok ? 'rgb(48 209 88 / 0.15)' : 'rgb(255 214 10 / 0.1)';
  g.fill();
  g.stroke();
}

$('shoot').addEventListener('click', async () => {
  if (!video.videoWidth) {
    $('file').click();
    return;
  }
  live = false;
  const { canvas, data } = frame(1600);
  $('still').src = canvas.toDataURL('image/jpeg', 0.85);
  $('still').hidden = false;
  await analyseImage(data);
});

$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  live = false;
  busy(true);
  try {
    const bmp = await createImageBitmap(file);
    const f = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * f);
    c.height = Math.round(bmp.height * f);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, c.width, c.height);
    $('still').src = c.toDataURL('image/jpeg', 0.85);
    $('still').hidden = false;
    await analyseImage(g.getImageData(0, 0, c.width, c.height));
  } catch {
    busy(false);
    setHint('Foto konnte nicht geladen werden');
  }
});

async function analyseImage(data) {
  busy(true);
  const r = await recognise(data);
  busy(false);
  if (!r.found) {
    setHint('Kein Sudoku gefunden – nochmal versuchen');
    setTimeout(() => {
      if (!$('cam').hidden) startCamera();
    }, 1800);
    return;
  }
  accept(r);
}

function busy(on) {
  $('busy').hidden = !on;
}

/** Takes a recognition result: solved right away if it is unambiguous. */
function accept(r) {
  S.givens = r.digits.slice();
  S.hand = r.hand.slice();
  S.unsure = new Set(r.digits.flatMap((d, i) => (d && r.conf[i] < UNSURE ? [i] : [])));
  const c = document.createElement('canvas');
  c.width = c.height = r.viewSize;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.view), r.viewSize), 0, 0);
  S.photo = c.toDataURL('image/jpeg', 0.8);
  S.sel = -1;
  if (r.count === 1 && !S.unsure.size) {
    computeSolution();
    save();
    showSolution();
  } else {
    save();
    showReview();
  }
}

// --- board ---
function buildBoard(el, onTap) {
  el.textContent = '';
  for (let i = 0; i < 81; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    c.addEventListener('pointerdown', () => onTap(i));
    el.append(c);
  }
}

function peers(i) {
  const r = Math.floor(i / 9),
    c = i % 9,
    b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
  const out = new Set();
  for (let j = 0; j < 81; j++) {
    const rr = Math.floor(j / 9),
      cc = j % 9;
    if (rr === r || cc === c || Math.floor(rr / 3) * 3 + Math.floor(cc / 3) === b) out.add(j);
  }
  return out;
}

// --- review ---
const reviewBoard = $('review-board');
buildBoard(reviewBoard, (i) => {
  S.sel = S.sel === i ? -1 : i;
  renderReview();
});

const pad = $('pad');
for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = d ? String(d) : '⌫';
  b.setAttribute('aria-label', d ? `Ziffer ${d}` : 'Feld leeren');
  b.addEventListener('pointerdown', () => setDigit(d));
  pad.append(b);
}

function setDigit(d) {
  if (S.sel < 0) {
    reviewMsg('Erst ein Feld antippen, dann die Ziffer.', '');
    return;
  }
  S.givens[S.sel] = d;
  S.hand[S.sel] = 0;
  S.unsure.delete(S.sel);
  // jump to the next uncertain cell, which is what one corrects next anyway
  const next = [...S.unsure].sort((a, b) => a - b).find((j) => j > S.sel);
  if (next !== undefined) S.sel = next;
  save();
  renderReview();
}

document.addEventListener('keydown', (e) => {
  if ($('review').hidden) return;
  if (/^[1-9]$/.test(e.key)) setDigit(+e.key);
  else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') setDigit(0);
  else if (e.key.startsWith('Arrow') && S.sel >= 0) {
    const dir = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[e.key];
    S.sel = (S.sel + dir + 81) % 81;
    renderReview();
  }
});

function reviewMsg(text, cls) {
  const m = $('review-msg');
  m.textContent = text;
  m.className = `msg ${cls}`;
}

function badge(cell, d, cls = '') {
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = d;
  cell.append(b);
}

function renderReview() {
  const bad = conflicts(S.givens);
  const near = S.sel >= 0 ? peers(S.sel) : new Set();
  const withPhoto = !!S.photo;
  reviewBoard.classList.toggle('photo', withPhoto);
  reviewBoard.style.backgroundImage = withPhoto ? `url(${S.photo})` : '';
  for (const [i, c] of [...reviewBoard.children].entries()) {
    const d = S.givens[i];
    c.className = 'cell';
    if (i === S.sel) c.classList.add('sel');
    else if (near.has(i)) c.classList.add('peer');
    if (bad.has(i)) c.classList.add('conflict');
    else if (S.unsure.has(i)) c.classList.add('unsure');
    c.textContent = '';
    // the printed digit is visible in the photo; ours goes in the corner
    if (d && withPhoto) badge(c, d);
    else if (d) c.textContent = d;
    else if (S.hand[i]) badge(c, S.hand[i], 'hand');
  }
  reviewMsg(...reviewText(bad, withPhoto));
}

function reviewText(bad, withPhoto) {
  const n = S.givens.filter(Boolean).length;
  const h = S.hand.filter(Boolean).length;
  if (bad.size) return ['Rot markierte Ziffern widersprechen sich.', 'bad'];
  if (S.unsure.size)
    return [
      `${S.unsure.size} unsichere Ziffer${S.unsure.size > 1 ? 'n' : ''} (orange) – bitte prüfen.`,
      'warn',
    ];
  if (h) return [`${n} gedruckte Ziffern, ${h} handschriftliche (lila) zählen nicht als Vorgabe.`, ''];
  if (withPhoto) return [`${n} Ziffern erkannt. Stimmen die blauen mit dem Foto?`, ''];
  return [n ? `${n} Ziffern eingegeben.` : 'Feld antippen, dann Ziffer wählen.', ''];
}

function showReview() {
  $('review-title').textContent = S.photo ? 'Ziffern prüfen' : 'Sudoku eingeben';
  show('review');
  renderReview();
}

$('clear-all').addEventListener('click', () => {
  S.givens.fill(0);
  S.hand.fill(0);
  S.unsure.clear();
  S.sel = 0;
  save();
  renderReview();
});

$('manual').addEventListener('click', () => {
  S.givens = new Array(81).fill(0);
  S.hand = new Array(81).fill(0);
  S.unsure = new Set();
  S.photo = null;
  S.sel = 0;
  save();
  showReview();
});

$('solve-btn').addEventListener('click', () => {
  if (conflicts(S.givens).size) {
    reviewMsg('Erst die rot markierten Widersprüche beheben.', 'bad');
    return;
  }
  computeSolution();
  if (!S.count) {
    reviewMsg('Dieses Sudoku hat keine Lösung – stimmt jede Ziffer?', 'bad');
    return;
  }
  S.unsure.clear();
  save();
  showSolution();
});

// --- solution ---
function computeSolution() {
  const r = solve(S.givens);
  S.solution = r.solution;
  S.count = r.count;
}

const solBoard = $('sol-board');
buildBoard(solBoard, () => {});

$('edit').addEventListener('click', () => {
  S.sel = -1;
  showReview();
});

// always drawn into the photo; only typed-in puzzles have none
function renderSolution() {
  const photo = !!S.photo;
  solBoard.classList.toggle('photo', photo);
  solBoard.style.backgroundImage = photo ? `url(${S.photo})` : '';
  for (const [i, c] of [...solBoard.children].entries()) {
    const given = S.givens[i];
    c.className = 'cell';
    if (given) {
      c.textContent = photo ? '' : given;
      continue;
    }
    c.textContent = S.solution[i];
    c.classList.add('sol');
    const mine = S.hand[i];
    if (mine && mine !== S.solution[i]) {
      c.classList.add('wrong');
      badge(c, mine, 'hand');
    }
  }
  const [text, cls] = solutionText();
  const m = $('sol-msg');
  m.textContent = text;
  m.className = `msg ${cls}`;
}

function solutionText() {
  if (S.count > 1) return ['Achtung: mehrere Lösungen möglich – fehlt eine Ziffer?', 'warn'];
  const mine = S.hand.filter(Boolean).length;
  const wrong = S.hand.filter((d, i) => d && d !== S.solution[i]).length;
  if (wrong) return [`${wrong} deiner ${mine} Einträge ${wrong > 1 ? 'sind' : 'ist'} falsch (rot).`, 'bad'];
  if (mine) return [`Deine ${mine} Einträge stimmen alle.`, 'good'];
  return ['Blau: die fehlenden Ziffern.', ''];
}

function showSolution() {
  show('solution');
  renderSolution();
}

// --- persistence ---
function save() {
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        givens: S.givens,
        hand: S.hand,
        unsure: [...S.unsure],
        photo: S.photo,
      }),
    );
  } catch {
    // storage full or disabled: the app still works, it just forgets
  }
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    if (d?.givens?.length !== 81) return false;
    S.givens = d.givens;
    S.hand = d.hand ?? new Array(81).fill(0);
    S.unsure = new Set(d.unsure);
    S.photo = d.photo;
    return true;
  } catch {
    return false;
  }
}

$('last').addEventListener('click', () => {
  if (!load()) return;
  computeSolution();
  if (S.count && !S.unsure.size && !conflicts(S.givens).size) showSolution();
  else showReview();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (!$('cam').hidden) startCamera();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}

show('cam');
