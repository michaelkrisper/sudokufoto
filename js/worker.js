// Recognition off the main thread: RGBA frame in, grid + digits + solution out.
import { grayFromRGBA } from './detect.js';
import { readSudoku } from './read.js';

self.onmessage = ({ data }) => {
  const { id, rgba, width, height } = data;
  const px = new Uint8ClampedArray(rgba);
  const r = readSudoku(grayFromRGBA(px, width, height), px);
  if (!r) {
    self.postMessage({ id, found: false });
    return;
  }
  self.postMessage({ id, found: true, ...r }, [r.view.buffer]);
};
