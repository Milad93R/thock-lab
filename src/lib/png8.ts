/**
 * Tiny palette-PNG (8-bit indexed) encoder.
 * Median-cut quantisation over a 5-bit/channel histogram + light Floyd–Steinberg
 * dithering, deflated with the browser's native CompressionStream.
 * A 1080×1080 product snapshot drops from ~1 MB (RGBA PNG) to a few hundred KB.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

interface Box {
  idx: number[]; // histogram bin ids
  count: number;
}

/** Median-cut palette from a 15-bit histogram. Returns RGB palette (flat array). */
function buildPalette(data: Uint8ClampedArray, maxColors: number): Uint8Array {
  const counts = new Uint32Array(32768);
  const sumR = new Float64Array(32768);
  const sumG = new Float64Array(32768);
  const sumB = new Float64Array(32768);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    counts[key]++;
    sumR[key] += r;
    sumG[key] += g;
    sumB[key] += b;
  }
  const bins: number[] = [];
  for (let k = 0; k < 32768; k++) if (counts[k]) bins.push(k);

  const comp = (k: number, ch: number) => (ch === 0 ? k >> 10 : ch === 1 ? (k >> 5) & 31 : k & 31);
  const boxes: Box[] = [{ idx: bins, count: bins.reduce((s, k) => s + counts[k], 0) }];

  const rangeOf = (box: Box) => {
    let best = 0;
    let bestCh = 0;
    for (let ch = 0; ch < 3; ch++) {
      let lo = 31;
      let hi = 0;
      for (const k of box.idx) {
        const v = comp(k, ch);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > best) {
        best = hi - lo;
        bestCh = ch;
      }
    }
    return { range: best, ch: bestCh };
  };

  while (boxes.length < maxColors) {
    // split the box with the largest (range × population) score
    let pick = -1;
    let pickScore = 0;
    let pickCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].idx.length < 2) continue;
      const { range, ch } = rangeOf(boxes[i]);
      const score = range * Math.sqrt(boxes[i].count);
      if (score > pickScore) {
        pickScore = score;
        pick = i;
        pickCh = ch;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick];
    box.idx.sort((a, b) => comp(a, pickCh) - comp(b, pickCh));
    const half = box.count / 2;
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.idx.length; i++) {
      acc += counts[box.idx[i]];
      if (acc >= half) {
        cut = Math.min(box.idx.length - 1, Math.max(1, i + 1));
        break;
      }
    }
    const a = box.idx.slice(0, cut);
    const b = box.idx.slice(cut);
    boxes.splice(
      pick,
      1,
      { idx: a, count: a.reduce((s, k) => s + counts[k], 0) },
      { idx: b, count: b.reduce((s, k) => s + counts[k], 0) }
    );
  }

  const palette = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    let n = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const k of box.idx) {
      n += counts[k];
      r += sumR[k];
      g += sumG[k];
      b += sumB[k];
    }
    palette[i * 3] = Math.round(r / Math.max(1, n));
    palette[i * 3 + 1] = Math.round(g / Math.max(1, n));
    palette[i * 3 + 2] = Math.round(b / Math.max(1, n));
  });
  return palette;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function canEncodePng8(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/** Encodes an opaque canvas as an indexed PNG. Throws if unsupported. */
export async function encodePng8(canvas: HTMLCanvasElement, maxColors = 256, dither = 0.6): Promise<Blob> {
  const w = canvas.width;
  const h = canvas.height;
  const img = canvas.getContext('2d')!.getImageData(0, 0, w, h);
  const data = img.data;
  const palette = buildPalette(data, maxColors);
  const nColors = palette.length / 3;

  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache[key];
    if (hit >= 0) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nColors; i++) {
      const dr = palette[i * 3] - r;
      const dg = palette[i * 3 + 1] - g;
      const db = palette[i * 3 + 2] - b;
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };

  // Error buffers for two rows (RGB)
  let errCur = new Float32Array((w + 2) * 3);
  let errNext = new Float32Array((w + 2) * 3);
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none (best for indexed data)
    errNext.fill(0);
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const e = (x + 1) * 3;
      const r = Math.max(0, Math.min(255, data[p] + errCur[e]));
      const g = Math.max(0, Math.min(255, data[p + 1] + errCur[e + 1]));
      const b = Math.max(0, Math.min(255, data[p + 2] + errCur[e + 2]));
      const idx = nearest(r | 0, g | 0, b | 0);
      raw[y * (w + 1) + 1 + x] = idx;
      if (dither > 0) {
        const er = (r - palette[idx * 3]) * dither;
        const eg = (g - palette[idx * 3 + 1]) * dither;
        const eb = (b - palette[idx * 3 + 2]) * dither;
        // Floyd–Steinberg weights
        errCur[e + 3] += (er * 7) / 16;
        errCur[e + 4] += (eg * 7) / 16;
        errCur[e + 5] += (eb * 7) / 16;
        errNext[e - 3] += (er * 3) / 16;
        errNext[e - 2] += (eg * 3) / 16;
        errNext[e - 1] += (eb * 3) / 16;
        errNext[e] += (er * 5) / 16;
        errNext[e + 1] += (eg * 5) / 16;
        errNext[e + 2] += (eb * 5) / 16;
        errNext[e + 3] += er / 16;
        errNext[e + 4] += eg / 16;
        errNext[e + 5] += eb / 16;
      }
    }
    const t = errCur;
    errCur = errNext;
    errNext = t;
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = await deflate(raw);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('PLTE', palette),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}
