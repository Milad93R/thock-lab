import { ClickerBuild, getBackdropHighlight, getBackdropTint, getSwitchLabel, getColorName } from '../types/build';
import { canEncodePng8, encodePng8 } from './png8';

const DISPLAY_FONT = "'Bricolage Grotesque Variable', 'Plus Jakarta Sans Variable', sans-serif";
const MONO_FONT = "'JetBrains Mono Variable', ui-monospace, monospace";

async function ensureBrandFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`700 40px ${DISPLAY_FONT}`),
        document.fonts.load(`600 24px ${MONO_FONT}`),
      ]),
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ]);
  } catch {
    // fall back to whatever is available
  }
}

/** Studio cyclorama backdrop drawn small then upscaled → smooth, dither-free, compresses well. */
function drawBackdrop(ctx: CanvasRenderingContext2D, size: number, build: ClickerBuild): void {
  const s = 160;
  const small = document.createElement('canvas');
  small.width = s;
  small.height = s;
  const sctx = small.getContext('2d')!;
  const grad = sctx.createRadialGradient(s * 0.5, s * 0.38, s * 0.04, s * 0.5, s * 0.5, s * 0.8);
  const tint = getBackdropTint(build.keycapColor);
  if (build.keycapFinish === 'glow') {
    grad.addColorStop(0, '#F4ECEE');
    grad.addColorStop(0.5, tint);
    grad.addColorStop(1, '#8F8090');
  } else {
    grad.addColorStop(0, getBackdropHighlight(build.baseMaterial));
    grad.addColorStop(0.55, tint);
    grad.addColorStop(1, '#E2D2C4');
  }
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, s, s);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, size, size);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Small vector keycap mark matching the in-app BrandMark. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const k = s / 48;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = '#7E5134';
  roundRectPath(ctx, 5, 30, 38, 12, 3.5);
  ctx.fill();
  ctx.fillStyle = '#C9472B';
  ctx.beginPath();
  ctx.moveTo(13.2, 13.5);
  ctx.lineTo(9.4, 29);
  ctx.quadraticCurveTo(8.8, 33, 12.6, 33);
  ctx.lineTo(35.4, 33);
  ctx.quadraticCurveTo(39.2, 33, 38.6, 29);
  ctx.lineTo(34.8, 13.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#F07A5C';
  roundRectPath(ctx, 12.5, 6, 23, 14.5, 4.6);
  ctx.fill();
  ctx.restore();
}

export async function composeSnapshot(
  source: CanvasImageSource,
  build: ClickerBuild,
  size: number,
  watermark: boolean
): Promise<HTMLCanvasElement> {
  if (watermark) await ensureBrandFonts();
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d')!;
  drawBackdrop(ctx, size, build);
  ctx.drawImage(source, 0, 0, size, size);

  if (watermark) {
    const pad = Math.round(size * 0.05);
    const markSize = Math.round(size * 0.05);
    drawMark(ctx, pad, size - pad - markSize * 0.92, markSize);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(31, 26, 23, 0.86)';
    ctx.font = `700 ${Math.round(size * 0.034)}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('Thock Lab', pad + markSize * 1.18, size - pad - markSize * 0.18);

    const swLabel = getSwitchLabel(build);
    ctx.font = `600 ${Math.round(size * 0.019)}px ${MONO_FONT}`;
    ctx.fillStyle = 'rgba(80, 68, 60, 0.82)';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${getColorName(build.keycapColor).toUpperCase()} · ${swLabel.toUpperCase()}`,
      size - pad,
      size - pad - markSize * 0.18
    );
    ctx.font = `500 ${Math.round(size * 0.016)}px ${MONO_FONT}`;
    ctx.fillStyle = 'rgba(104, 91, 82, 0.7)';
    ctx.fillText('thock.algoty.com', size - pad, size - pad - markSize * 0.18 - size * 0.03);
    ctx.restore();
  }
  return out;
}

/** PNG8 when the browser can deflate natively, otherwise a regular PNG. */
export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (canEncodePng8()) {
    try {
      return await encodePng8(canvas, 256, 0.55);
    } catch {
      // fall through
    }
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
