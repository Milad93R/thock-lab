import {
  CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import walnutUrl from '../assets/textures/walnut.webp';
import aluminumUrl from '../assets/textures/brushed-aluminum.webp';
import { darken, lighten, mix } from '../lib/color';
import { ClickerBuild, getDailyVariant, KeycapShape, SWITCH_MAP } from '../types/build';
import { CharmArt } from './CharmArt';
import type { StageFrame } from '../scene/ClickerScene';

/**
 * 2D studio clicker used when WebGL is unavailable (blocked GPU, old drivers,
 * enterprise policy, lost context). Same build, same sounds, same press feel —
 * drawn as a crafted SVG product illustration.
 */

export interface FallbackClickerHandle {
  pressKey: (combo?: number) => void;
  releaseKey: () => void;
  triggerMilestoneBurst: (milestone: number) => void;
  renderSquare: (size: number) => Promise<HTMLCanvasElement>;
}

interface Props {
  build: ClickerBuild;
  reducedMotion: boolean;
  frame: StageFrame | null;
  onKeyDown: () => void;
  onKeyUp: () => void;
}

interface CapDims {
  bw: number;
  bd: number;
  tw: number;
  td: number;
  h: number;
  brx: number;
  bry: number;
  trx: number;
  try: number;
  dish: number; // >0 concave, <0 dome
}

const CAP: Record<KeycapShape, CapDims> = {
  square: { bw: 168, bd: 60, tw: 128, td: 46, h: 68, brx: 24, bry: 15, trx: 17, try: 12, dish: 1 },
  'low-profile': { bw: 176, bd: 60, tw: 154, td: 52, h: 34, brx: 22, bry: 14, trx: 18, try: 12, dish: 0.5 },
  'tall-artisan': { bw: 160, bd: 58, tw: 132, td: 46, h: 92, brx: 40, bry: 22, trx: 38, try: 20, dish: -1 },
  pill: { bw: 210, bd: 56, tw: 170, td: 42, h: 60, brx: 66, bry: 28, trx: 54, try: 21, dish: 0.8 },
  round: { bw: 170, bd: 60, tw: 138, td: 50, h: 64, brx: 85, bry: 30, trx: 69, try: 25, dish: 1 },
};

const CX = 200;
const CAP_BASE_Y = 240; // centre line of the keycap's bottom outline
const VIEW = { x: 16, y: 92, w: 376, h: 300 };
const SNAP_VIEWBOX = '16 54 376 376';
const EYE_X = 344;
const EYE_Y = 252;

/** Rounded rectangle centred at (cx, cy) with independent x/y corner radii. */
function rr(cx: number, cy: number, w: number, h: number, rx: number, ry: number): string {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const ax = Math.min(rx, w / 2);
  const ay = Math.min(ry, h / 2);
  return [
    `M${x + ax},${y}`,
    `H${x + w - ax}`,
    `A${ax},${ay} 0 0 1 ${x + w},${y + ay}`,
    `V${y + h - ay}`,
    `A${ax},${ay} 0 0 1 ${x + w - ax},${y + h}`,
    `H${x + ax}`,
    `A${ax},${ay} 0 0 1 ${x},${y + h - ay}`,
    `V${y + ay}`,
    `A${ax},${ay} 0 0 1 ${x + ax},${y}`,
    'Z',
  ].join(' ');
}

/** Block (plinth-like) shape: top outline + front thickness, as one path for the side. */
function blockSide(cx: number, topCy: number, w: number, d: number, thick: number, rx: number, ry: number): string {
  return `${rr(cx, topCy + thick, w, d, rx, ry)} M${cx - w / 2},${topCy} H${cx + w / 2} V${topCy + thick} H${cx - w / 2} Z`;
}

const dataUrlCache = new Map<string, Promise<string>>();
function toDataUrl(url: string): Promise<string> {
  let p = dataUrlCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          })
      )
      .catch(() => url);
    dataUrlCache.set(url, p);
  }
  return p;
}

interface Burst {
  id: number;
  parts: { dx: number; dy: number; size: number; color: string; delay: number }[];
}

export const FallbackClicker = forwardRef<FallbackClickerHandle, Props>(
  ({ build, reducedMotion, frame, onKeyDown, onKeyUp }, ref) => {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [pressed, setPressed] = useState(false);
    const [swingKey, setSwingKey] = useState(0);
    const [ringKey, setRingKey] = useState(0);
    const [bursts, setBursts] = useState<Burst[]>([]);
    const burstId = useRef(0);
    const pointerActive = useRef<number | null>(null);
    const keyboardKey = useRef<string | null>(null);
    const timers = useRef<number[]>([]);

    useEffect(
      () => () => {
        timers.current.forEach((t) => window.clearTimeout(t));
      },
      []
    );

    const spec = SWITCH_MAP[build.switchType];
    const travel = Math.round(spec.travelUnits * 72);
    const color = build.keycapColor;
    const cap = CAP[build.keycapShape];
    const finish = build.keycapFinish;
    const stemColor = getDailyVariant(build.dailyVariantId)?.accentColor ?? spec.stemColor;

    const spawn = useCallback(
      (count: number, celebration: boolean) => {
        if (reducedMotion) return;
        const palette = celebration
          ? ['#E85D3F', '#F5C451', '#6CC7B8', '#A996E8', '#F2A7B3', '#4B7BF5']
          : [color, '#FFF8F0', '#F5C451'];
        const id = ++burstId.current;
        const parts = Array.from({ length: count }, (_, i) => {
          const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
          const dist = celebration ? 90 + Math.random() * 80 : 40 + Math.random() * 40;
          return {
            dx: Math.cos(a) * dist,
            dy: Math.sin(a) * dist * 0.55 - (celebration ? 50 : 26),
            size: celebration ? 9 + Math.random() * 6 : 5 + Math.random() * 4,
            color: palette[i % palette.length],
            delay: Math.random() * 40,
          };
        });
        setBursts((prev) => [...prev.slice(-5), { id, parts }]);
        timers.current.push(
          window.setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), celebration ? 1200 : 750)
        );
      },
      [reducedMotion, color]
    );

    const pressedRef = useRef(false);
    const press = useCallback(
      (combo = 1) => {
        if (pressedRef.current && !reducedMotion) {
          // already down (rapid previews): pop up and travel again on the next frame
          setPressed(false);
          requestAnimationFrame(() => setPressed(true));
        } else {
          setPressed(true);
        }
        pressedRef.current = true;
        if (!reducedMotion) {
          setSwingKey((k) => k + 1);
          setRingKey((k) => k + 1);
          spawn(combo >= 20 ? 10 : combo >= 10 ? 8 : 6, false);
        }
      },
      [reducedMotion, spawn]
    );

    const release = useCallback(() => {
      pressedRef.current = false;
      setPressed(false);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        pressKey: (combo = 1) => press(combo),
        releaseKey: () => release(),
        triggerMilestoneBurst: (m: number) => {
          spawn(m >= 100 ? 34 : m >= 50 ? 28 : 22, true);
          if (!reducedMotion) setRingKey((k) => k + 1);
        },
        renderSquare: async (size: number) => {
          const svg = svgRef.current;
          const out = document.createElement('canvas');
          out.width = size;
          out.height = size;
          if (!svg) return out;
          // Import into a detached document so the image hrefs cannot begin
          // loading before they are replaced with self-contained data URLs.
          const detached = document.implementation.createDocument(svg.namespaceURI, '');
          const clone = detached.importNode(svg, true);
          clone.setAttribute('width', String(size));
          clone.setAttribute('height', String(size));
          clone.setAttribute('viewBox', SNAP_VIEWBOX);
          clone.querySelectorAll<SVGGElement>('[data-anim]').forEach((g) => g.removeAttribute('style'));
          const images = Array.from(clone.querySelectorAll('image'));
          await Promise.all(
            images.map(async (img) => {
              const href = img.getAttribute('href');
              if (href && !href.startsWith('data:')) img.setAttribute('href', await toDataUrl(href));
            })
          );
          const markup = new XMLSerializer().serializeToString(clone);
          const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
          await new Promise<void>((resolve) => {
            const im = new Image();
            im.onload = () => {
              out.getContext('2d')!.drawImage(im, 0, 0, size, size);
              resolve();
            };
            im.onerror = () => resolve();
            im.src = url;
          });
          return out;
        },
      }),
      [press, release, spawn, reducedMotion]
    );

    // Pointer handling on the gadget itself
    const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || pointerActive.current !== null) return;
      pointerActive.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      onKeyDown();
    };
    const endPointer = (e: React.PointerEvent) => {
      if (pointerActive.current !== e.pointerId) return;
      pointerActive.current = null;
      onKeyUp();
    };
    const releaseKeyboardKey = () => {
      if (keyboardKey.current === null) return;
      keyboardKey.current = null;
      onKeyUp();
    };

    // ── colours per finish ──
    const top = finish === 'glow' ? lighten(color, 0.28) : lighten(color, 0.1);
    const sideTop = finish === 'glow' ? lighten(color, 0.05) : darken(color, 0.1);
    const sideBot = finish === 'glow' ? darken(color, 0.1) : darken(color, 0.32);
    const capOpacity = finish === 'frosted' ? 0.74 : 1;

    // ── base material fills ──
    const base = build.baseMaterial;
    const baseRx = base === 'plastic' ? 56 : base === 'aluminum' ? 30 : 42;
    const baseRy = base === 'plastic' ? 34 : base === 'aluminum' ? 20 : 26;
    const plateFill =
      base === 'wood' ? 'url(#fb-brass)' : base === 'aluminum' ? '#2B2E34' : base === 'acrylic' ? '#F6F9FC' : '#E5D3C9';
    const metal = base === 'wood' ? '#D6AF66' : '#C8CDD6';

    const frameStyle: CSSProperties = frame
      ? (() => {
          const aspect = VIEW.w / VIEW.h;
          const w = Math.min(frame.w * 0.96, frame.h * 0.96 * aspect);
          const h = w / aspect;
          return {
            position: 'absolute',
            left: frame.x + (frame.w - w) / 2,
            top: frame.y + (frame.h - h) / 2,
            width: w,
            height: h,
          };
        })()
      : { position: 'absolute', inset: 0, margin: 'auto', width: 'min(92vw, 88vh)', aspectRatio: `${VIEW.w} / ${VIEW.h}` };

    const capTopY = CAP_BASE_Y - cap.h;
    const capTransition = reducedMotion
      ? 'none'
      : pressed
        ? 'transform 45ms cubic-bezier(.55,0,.9,.4)'
        : `transform ${Math.round(220 + 60 / spec.reboundKick)}ms cubic-bezier(.3,${(1.4 + spec.reboundKick * 0.45).toFixed(2)},.45,1)`;

    return (
      <div className="fallback-stage" data-testid="fallback-stage" style={frameStyle}>
        <button
          type="button"
          className="fallback-key-button"
          aria-label="Thock Lab clicker (2D mode). Press to click."
          aria-keyshortcuts="Space Enter"
          data-testid="fallback-clicker"
          onPointerDown={onPointerDown}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
          onKeyDown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            if (event.repeat || keyboardKey.current !== null) return;
            keyboardKey.current = event.key;
            onKeyDown();
          }}
          onKeyUp={(event) => {
            if (event.key !== keyboardKey.current) return;
            event.preventDefault();
            releaseKeyboardKey();
          }}
          onBlur={releaseKeyboardKey}
          onClick={(event) => {
            // Pointer activation already played the down/up stroke.
            if (event.detail !== 0) return;
            onKeyDown();
            onKeyUp();
          }}
        />
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
          width="100%"
          height="100%"
          className={`fallback-svg ${finish === 'glow' ? 'is-glow' : ''}`}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="fb-floor" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#2A1A10" stopOpacity="0.32" />
              <stop offset="0.7" stopColor="#2A1A10" stopOpacity="0.1" />
              <stop offset="1" stopColor="#2A1A10" stopOpacity="0" />
            </radialGradient>
            <pattern id="fb-wood" patternUnits="userSpaceOnUse" x="40" y="150" width="340" height="340">
              <rect width="340" height="340" fill="#5A3822" />
              <image href={walnutUrl} width="340" height="340" preserveAspectRatio="none" />
            </pattern>
            <pattern id="fb-alu" patternUnits="userSpaceOnUse" x="40" y="150" width="340" height="340">
              <rect width="340" height="340" fill="#B8BEC7" />
              <image href={aluminumUrl} width="340" height="340" preserveAspectRatio="none" />
            </pattern>
            <linearGradient id="fb-brass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#E9C77F" />
              <stop offset="0.5" stopColor="#C8994F" />
              <stop offset="1" stopColor="#A87A3A" />
            </linearGradient>
            <linearGradient id="fb-side-shade" gradientUnits="userSpaceOnUse" x1="0" y1="246" x2="0" y2="366">
              <stop offset="0" stopColor="#1a0f08" stopOpacity="0.22" />
              <stop offset="1" stopColor="#1a0f08" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="fb-top-sheen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
              <stop offset="0.65" stopColor="#fff" stopOpacity="0.06" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="fb-side-light" gradientUnits="userSpaceOnUse" x1="62" y1="0" x2="338" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.16" />
            </linearGradient>
            <linearGradient id="fb-alu-sheen" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0.05" />
              <stop offset="0.3" stopColor="#fff" stopOpacity="0.45" />
              <stop offset="0.55" stopColor="#000" stopOpacity="0.08" />
              <stop offset="0.8" stopColor="#fff" stopOpacity="0.3" />
              <stop offset="1" stopColor="#000" stopOpacity="0.12" />
            </linearGradient>
            <linearGradient id="fb-cap-side" gradientUnits="userSpaceOnUse" x1="0" y1={capTopY} x2="0" y2={CAP_BASE_Y + cap.bd / 2}>
              <stop offset="0" stopColor={sideTop} />
              <stop offset="1" stopColor={sideBot} />
            </linearGradient>
            <linearGradient id="fb-cap-shade" gradientUnits="userSpaceOnUse" x1={CX - cap.bw / 2} y1="0" x2={CX + cap.bw / 2} y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
              <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="fb-cap-metal" gradientUnits="userSpaceOnUse" x1={CX - cap.bw / 2} y1="0" x2={CX + cap.bw / 2} y2="0">
              <stop offset="0" stopColor={darken(color, 0.35)} />
              <stop offset="0.18" stopColor={lighten(color, 0.45)} />
              <stop offset="0.38" stopColor={darken(color, 0.2)} />
              <stop offset="0.62" stopColor={lighten(color, 0.25)} />
              <stop offset="0.82" stopColor={darken(color, 0.4)} />
              <stop offset="1" stopColor={darken(color, 0.15)} />
            </linearGradient>
            <linearGradient id="fb-cap-top" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={lighten(top, finish === 'metallic' ? 0.35 : 0.12)} />
              <stop offset="1" stopColor={finish === 'metallic' ? darken(color, 0.1) : top} />
            </linearGradient>
            <radialGradient id="fb-dish" cx="0.5" cy="0.42" r="0.55">
              <stop offset="0" stopColor={darken(color, 0.25)} stopOpacity="0.45" />
              <stop offset="0.7" stopColor={darken(color, 0.1)} stopOpacity="0.12" />
              <stop offset="1" stopColor={darken(color, 0.1)} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="fb-glow-pool" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor={color} stopOpacity="0.75" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </radialGradient>
            <filter id="fb-glow" x="-40%" y="-60%" width="180%" height="220%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* floor + pulse ring */}
          <ellipse cx="200" cy="356" rx="176" ry="28" fill="url(#fb-floor)" />
          {!reducedMotion && ringKey > 0 && (
            <ellipse
              key={ringKey}
              className="fb-ring"
              cx="200"
              cy="352"
              rx="150"
              ry="22"
              fill="none"
              stroke={color}
              strokeWidth="3"
            />
          )}

          {/* feet */}
          <ellipse cx="98" cy="356" rx="16" ry="5" fill="#2B2522" />
          <ellipse cx="302" cy="356" rx="16" ry="5" fill="#2B2522" />

          {/* base block */}
          {base === 'acrylic' ? (
            <g>
              {[0, 1].map((i) => (
                <rect key={`bs${i}`} x={i ? 300 : 92} y="214" width="11" height="120" rx="5" fill="url(#fb-alu-sheen)" stroke="#AEB5BF" strokeWidth="1" />
              ))}
              {[0, 1, 2]
                .map((i) => {
                  const y = 246 + i * 26;
                  return (
                    <g key={`slab${i}`}>
                      <path d={blockSide(200, y, 280, 96, 14, baseRx, baseRy)} fill="#C9DDEC" opacity="0.8" />
                      <path d={rr(200, y, 280, 96, baseRx, baseRy)} fill="#EDF5FB" opacity="0.82" stroke="#fff" strokeWidth="2" />
                    </g>
                  );
                })
                .reverse()}
              {[0, 1].map((i) => (
                <rect key={`bf${i}`} x={i ? 296 : 96} y="262" width="11" height="92" rx="5" fill="#CDD3DB" stroke="#9AA3AE" strokeWidth="1" />
              ))}
            </g>
          ) : (
            <g>
              <path
                d={blockSide(200, 246, 276, 100, 66, baseRx, baseRy)}
                fill={base === 'wood' ? 'url(#fb-wood)' : base === 'aluminum' ? 'url(#fb-alu)' : '#EFDCD2'}
              />
              <path d={blockSide(200, 246, 276, 100, 66, baseRx, baseRy)} fill="url(#fb-side-shade)" />
              <path d={blockSide(200, 246, 276, 100, 66, baseRx, baseRy)} fill="url(#fb-side-light)" />
              {base === 'aluminum' && (
                <path d={blockSide(200, 246, 276, 100, 66, baseRx, baseRy)} fill="url(#fb-alu-sheen)" opacity="0.7" />
              )}
              <path
                d={rr(200, 246, 276, 100, baseRx, baseRy)}
                fill={base === 'wood' ? 'url(#fb-wood)' : base === 'aluminum' ? 'url(#fb-alu)' : '#F6EAE3'}
              />
              <path d={rr(200, 246, 276, 100, baseRx, baseRy)} fill="url(#fb-top-sheen)" />
              <path d={rr(200, 246, 276, 100, baseRx, baseRy)} fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.6" />
            </g>
          )}

          {/* plate, socket, stem */}
          <path d={rr(200, 250, 206, 72, 22, 15)} fill="#000" opacity="0.16" transform="translate(0 3)" />
          <path d={rr(200, 250, 206, 72, 22, 15)} fill={plateFill} />
          <path d={rr(200, 250, 206, 72, 22, 15)} fill="url(#fb-top-sheen)" />
          <path d={rr(200, 248, 150, 50, 14, 10)} fill="#1E1A18" opacity={finish === 'frosted' ? 0.3 : 0.92} />
          {finish === 'glow' && <ellipse cx="200" cy="240" rx="150" ry="48" fill="url(#fb-glow-pool)" />}

          {/* charm on its eyelet (swings around the eyelet) */}
          <rect x="334" y="247" width="9" height="10" rx="2" fill={metal} />
          <circle cx={EYE_X + 6} cy={EYE_Y} r="7.5" fill="none" stroke={metal} strokeWidth="3.4" />
          <g
            key={`swing-${swingKey}`}
            data-anim="swing"
            className={!reducedMotion && swingKey > 0 ? 'fb-swing' : undefined}
            style={{ transformOrigin: `${EYE_X + 6}px ${EYE_Y + 7}px` }}
          >
            <ellipse cx={EYE_X + 6} cy={EYE_Y + 13} rx="3.4" ry="5.6" fill="none" stroke="#D5B670" strokeWidth="2.2" />
            <ellipse cx={EYE_X + 6} cy={EYE_Y + 23} rx="2.4" ry="5.2" fill="none" stroke="#C9A55A" strokeWidth="2.2" />
            <g transform={`translate(${EYE_X + 6 - 24 * 1.3} ${EYE_Y + 26 - 4 * 1.3}) scale(1.3)`}>
              <CharmArt charm={build.charm} />
            </g>
          </g>

          {/* keycap (travels on press) */}
          <g
            data-anim="cap"
            style={{
              transform: `translateY(${pressed ? travel : 0}px)`,
              transition: capTransition,
            }}
          >
            <rect x="186" y={CAP_BASE_Y - 30} width="28" height="34" rx="3" fill={stemColor} />
            <g
              opacity={capOpacity}
              filter={finish === 'glow' ? 'url(#fb-glow)' : undefined}
            >
              <path d={rr(CX, CAP_BASE_Y, cap.bw, cap.bd, cap.brx, cap.bry)} fill={finish === 'metallic' ? 'url(#fb-cap-metal)' : 'url(#fb-cap-side)'} />
              <path
                d={`M${CX - cap.bw / 2},${CAP_BASE_Y} L${CX - cap.tw / 2},${capTopY} H${CX + cap.tw / 2} L${CX + cap.bw / 2},${CAP_BASE_Y} Z`}
                fill={finish === 'metallic' ? 'url(#fb-cap-metal)' : 'url(#fb-cap-side)'}
              />
              <path
                d={`${rr(CX, CAP_BASE_Y, cap.bw, cap.bd, cap.brx, cap.bry)} M${CX - cap.bw / 2},${CAP_BASE_Y} L${CX - cap.tw / 2},${capTopY} H${CX + cap.tw / 2} L${CX + cap.bw / 2},${CAP_BASE_Y} Z`}
                fill="url(#fb-cap-shade)"
              />
              <path d={rr(CX, capTopY, cap.tw, cap.td, cap.trx, cap.try)} fill="url(#fb-cap-top)" />
              {cap.dish > 0 && (
                <ellipse cx={CX} cy={capTopY + 1} rx={cap.tw * 0.36} ry={cap.td * 0.33} fill="url(#fb-dish)" opacity={cap.dish} />
              )}
              {cap.dish < 0 && (
                <ellipse cx={CX - cap.tw * 0.12} cy={capTopY - cap.td * 0.12} rx={cap.tw * 0.24} ry={cap.td * 0.2} fill="#fff" opacity="0.32" />
              )}
              {(finish === 'glossy' || finish === 'frosted') && (
                <>
                  <path
                    d={`M${CX - cap.tw * 0.34},${capTopY - cap.td * 0.18} Q${CX - cap.tw * 0.05},${capTopY - cap.td * 0.36} ${CX + cap.tw * 0.2},${capTopY - cap.td * 0.3}`}
                    stroke="#fff"
                    strokeWidth={finish === 'glossy' ? 5 : 8}
                    strokeLinecap="round"
                    fill="none"
                    opacity={finish === 'glossy' ? 0.85 : 0.4}
                  />
                  <path
                    d={`M${CX - cap.bw * 0.4},${CAP_BASE_Y - 6} L${CX - cap.tw * 0.42},${capTopY + cap.td * 0.3}`}
                    stroke="#fff"
                    strokeWidth="4"
                    strokeLinecap="round"
                    opacity={finish === 'glossy' ? 0.5 : 0.3}
                  />
                </>
              )}
              {finish === 'frosted' && (
                <path d={rr(CX, capTopY, cap.tw, cap.td, cap.trx, cap.try)} fill="#fff" opacity="0.22" />
              )}
              {finish === 'metallic' && (
                <path
                  d={rr(CX, capTopY, cap.tw * 0.9, cap.td * 0.82, cap.trx, cap.try)}
                  fill="none"
                  stroke={lighten(color, 0.6)}
                  strokeWidth="2"
                  opacity="0.6"
                />
              )}
            </g>
          </g>
        </svg>

        {/* particles (HTML overlay above the cap) */}
        <div className="fb-particles" aria-hidden="true">
          {bursts.map((b) =>
            b.parts.map((p, i) => (
              <span
                key={`${b.id}-${i}`}
                className="fb-particle"
                style={
                  {
                    '--dx': `${p.dx}px`,
                    '--dy': `${p.dy}px`,
                    width: p.size,
                    height: p.size,
                    background: p.color,
                    animationDelay: `${p.delay}ms`,
                    boxShadow: `0 0 0 1px ${mix(p.color, '#000000', 0.15)}33`,
                  } as CSSProperties
                }
              />
            ))
          )}
        </div>
      </div>
    );
  }
);

FallbackClicker.displayName = 'FallbackClicker';
