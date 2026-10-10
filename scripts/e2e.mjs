/**
 * End-to-end check in headless Chrome on a phone-sized screen:
 * - live camera: Chrome's fake camera shows a synthetic photo of a known
 *   puzzle; the app must capture it by itself and show the right solution
 * - photo picker: a second photo through the gallery input
 * - review: correcting a digit by hand
 * - nothing may scroll or overflow on any screen
 * Saves screenshots. Needs python3 with Pillow + numpy for the photos.
 *
 *   python3 -m http.server 8792 &   # from the repo root
 *   node scripts/e2e.mjs [http://localhost:8792/] [outdir]
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:8792/';
const out = process.argv[3] ?? join(tmpdir(), 'sudokufoto-shots');
mkdirSync(out, { recursive: true });
const port = 9335;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PUZZLE = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const PUZZLE2 = '000260701680070090190004500820100040004602900050003028009300074040050036703018000';
const SOLUTION2 = '435269781682571493197834562826195347374682915951743628519326874248957136763418259';

const work = mkdtempSync(join(tmpdir(), 'sudokufoto-e2e-'));
for (const [name, puzzle, seed] of [
  ['cam', PUZZLE, '11'],
  ['pick', PUZZLE2, '12'],
]) {
  const r = spawnSync('python3', [
    'tools/synth.py',
    join(work, name),
    '--n',
    '1',
    '--seed',
    seed,
    '--fonts',
    'all',
    '--jpeg',
    '--size',
    '960',
    '--puzzle',
    puzzle,
  ]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}
// fake camera: one frame as YUV 4:2:0 (full-range, as in JPEG)
const camFile = join(work, 'camera.y4m');
const y4m = spawnSync(
  'python3',
  [
    '-c',
    `import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size[0] // 2 * 2, im.size[1] // 2 * 2
y, u, v = im.crop((0, 0, w, h)).convert('YCbCr').split()
u = u.resize((w // 2, h // 2)); v = v.resize((w // 2, h // 2))
sys.stdout.buffer.write(f'YUV4MPEG2 W{w} H{h} F30:1 Ip A1:1 C420jpeg\\nFRAME\\n'.encode() + y.tobytes() + u.tobytes() + v.tobytes())`,
    join(work, 'cam', '0000.jpg'),
  ],
  { maxBuffer: 1 << 26 },
);
writeFileSync(camFile, y4m.stdout);
const photo2 = readFileSync(join(work, 'pick', '0000.jpg')).toString('base64');

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${camFile}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sudokufoto-chrome-'))}`,
    '--window-size=390,844',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws,
  msgId = 0;
const pending = new Map();
const errors = [];
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.data, 'base64'));
}
async function until(expr, ms = 20000) {
  for (let t = 0; t < ms; t += 250) {
    if (await evaluate(expr)) return true;
    await wait(250);
  }
  return false;
}
// nothing on the page may be scrollable or stick out of the screen
const overflow = `(() => {
  const se = document.scrollingElement;
  const bad = [];
  if (se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1) bad.push('page ' + se.scrollWidth + 'x' + se.scrollHeight);
  for (const el of document.querySelectorAll('.screen:not([hidden]) *')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.bottom > innerHeight + 1 || r.right > innerWidth + 1)) bad.push(el.className || el.tagName);
  }
  return bad;
})()`;
const solutionText = `[...document.querySelectorAll('#sol-board .cell')].map((c) => c.textContent).join('')`;

let ok = true;
const check = (cond, what) => {
  console.log(cond ? 'ok  ' : 'FAIL', what);
  if (!cond) ok = false;
};

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await wait(200);
    target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
      .then((r) => r.json())
      .catch(() => null);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result ?? m);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      errors.push(m.params.args.map((a) => a.value).join(' '));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: base });
  await wait(1200);
  await shot('1-camera');
  check((await evaluate(overflow)).length === 0, 'camera screen does not overflow');

  // 1. live camera: automatic capture and solution
  const t0 = Date.now();
  const captured = await until(`!document.getElementById('solution').hidden`, 30000);
  check(captured, `auto capture from live camera (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await wait(400);
  await shot('2-solution');
  check((await evaluate(solutionText)) === SOLUTION, 'solution from camera is right');
  check((await evaluate(overflow)).length === 0, 'solution screen does not overflow');
  for (const v of ['photo', 'hint']) {
    await evaluate(`document.querySelector('[data-view=${v}]').click()`);
    await wait(300);
    await shot(`3-solution-${v}`);
  }
  // hint mode: digits hidden until tapped
  const hidden = await evaluate(`document.querySelectorAll('#sol-board .hidden-sol').length`);
  await evaluate(
    `document.querySelector('#sol-board .hidden-sol').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`,
  );
  const hidden2 = await evaluate(`document.querySelectorAll('#sol-board .hidden-sol').length`);
  check(
    hidden === [...PUZZLE].filter((c) => c === '0').length && hidden2 === hidden - 1,
    `hint mode reveals one cell (${hidden} -> ${hidden2})`,
  );
  await evaluate(`document.querySelector('[data-view=grid]').click()`);

  // 2. review: change a given, the solver must notice
  await evaluate(`document.getElementById('edit').click()`);
  await wait(300);
  await evaluate(`(() => {
    const cells = document.querySelectorAll('#review-board .cell');
    cells[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.querySelectorAll('#pad button')[4].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  })()`);
  await wait(200);
  await shot('4-review-conflict');
  const conflictMsg = await evaluate(`document.getElementById('review-msg').textContent`);
  check(/widersprechen/.test(conflictMsg), `conflict reported: ${conflictMsg}`);
  check((await evaluate(overflow)).length === 0, 'review screen does not overflow');
  await evaluate(
    `document.querySelectorAll('#pad button')[9].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`,
  );

  // 3. gallery photo
  await evaluate(`document.querySelector('[data-go=cam]').click()`);
  await wait(500);
  await evaluate(`(async () => {
    const bytes = Uint8Array.from(atob('${photo2}'), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'sudoku.jpg', { type: 'image/jpeg' }));
    const input = document.getElementById('file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  const picked = await until(
    `!document.getElementById('solution').hidden || !document.getElementById('review').hidden`,
  );
  await wait(400);
  await shot('5-picked');
  const where = await evaluate(`document.getElementById('solution').hidden ? 'review' : 'solution'`);
  check(picked && where === 'solution', `gallery photo goes straight to the solution (${where})`);
  check((await evaluate(solutionText)) === SOLUTION2, 'solution from gallery photo is right');

  // 4. landscape fits too
  await send('Emulation.setDeviceMetricsOverride', {
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await wait(400);
  await shot('6-landscape');
  check((await evaluate(overflow)).length === 0, 'landscape solution does not overflow');

  check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
} finally {
  ws?.close();
  chrome.kill();
}
console.log(ok ? 'E2E OK' : 'E2E FAILED', '- screenshots in', out);
process.exitCode = ok ? 0 : 1;
