import * as THREE from 'three';
import { BaseMaterial, KeycapFinish } from '../types/build';
import walnutUrl from '../assets/textures/walnut.webp';
import aluminumUrl from '../assets/textures/brushed-aluminum.webp';

/**
 * Generates a photographic softbox studio environment map via PMREMGenerator.
 * HDR (>1.0) softbox strips give crisp specular highlights on gloss and metal;
 * dark flags give metals the contrasting reflection bands that make them read as metal.
 * Zero external HDRI files; works offline.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#B9ADA3');

  const panel = (
    w: number,
    h: number,
    color: THREE.ColorRepresentation,
    intensity: number,
    pos: [number, number, number],
    rot: [number, number, number]
  ) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    mat.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    envScene.add(mesh);
  };

  // Big overhead warm softbox (key)
  panel(9, 6, '#FFF6EC', 2.5, [1.5, 8, 1.5], [Math.PI / 2, 0, 0]);
  // Two crisp vertical strip lights → long specular streaks on caps and aluminium
  panel(1.4, 9, '#FFFFFF', 4.2, [-7.5, 3, 2.5], [0, Math.PI / 2, 0]);
  panel(1.2, 8, '#FFE9D8', 3.0, [7.5, 3.2, -1], [0, -Math.PI / 2, 0]);
  // Soft front fill card
  panel(10, 5, '#F7EFE6', 1.15, [0, 2.4, 8], [0, Math.PI, 0]);
  // Dark flags (negative fill) for metal contrast
  panel(5, 9, '#1E1A18', 1, [-6.5, 2.5, -5], [0, Math.PI / 4, 0]);
  panel(4, 8, '#2A2522', 1, [6, 2.5, 5.5], [0, -Math.PI * 0.8, 0]);
  // Warm clay floor bounce
  panel(20, 20, '#CDBBA9', 0.9, [0, -3.5, 0], [-Math.PI / 2, 0, 0]);

  const envRT = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();

  envScene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });

  return envRT.texture;
}

/** Small procedural placeholder that is replaced by the real image once it decodes. */
function solidTexture(hex: string): THREE.DataTexture {
  const c = new THREE.Color(hex);
  const data = new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
}

export interface SurfaceTextures {
  wood: THREE.Texture;
  aluminum: THREE.Texture;
  dispose: () => void;
}

/**
 * Loads the generated walnut and brushed-aluminium textures (bundled, precached).
 * `onReady` fires once both decode so the scene can re-render on demand.
 */
export function loadSurfaceTextures(
  renderer: THREE.WebGLRenderer,
  onReady: () => void
): SurfaceTextures {
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const setup = (tex: THREE.Texture, repeat: number) => {
    tex.wrapS = THREE.MirroredRepeatWrapping;
    tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  };

  const result: SurfaceTextures = {
    wood: setup(solidTexture('#7A4B30'), 0.42),
    aluminum: setup(solidTexture('#C9CDD3'), 0.5),
    dispose: () => {
      result.wood.dispose();
      result.aluminum.dispose();
    },
  };

  let pending = 2;
  const done = () => {
    pending -= 1;
    if (pending === 0) onReady();
  };
  const swapIn = (key: 'wood' | 'aluminum', url: string, repeat: number) => {
    loader.load(
      url,
      (tex) => {
        const placeholder = result[key];
        result[key] = setup(tex, repeat);
        placeholder.dispose();
        done();
      },
      undefined,
      () => done()
    );
  };
  swapIn('wood', walnutUrl, 0.42);
  swapIn('aluminum', aluminumUrl, 0.5);
  return result;
}

/**
 * Soft radial contact shadow under the clicker plinth for rich grounding.
 */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, size * 0.08, cx, cx, size * 0.48);
  grad.addColorStop(0, 'rgba(34, 21, 14, 0.46)');
  grad.addColorStop(0.42, 'rgba(34, 21, 14, 0.24)');
  grad.addColorStop(0.76, 'rgba(34, 21, 14, 0.07)');
  grad.addColorStop(1, 'rgba(34, 21, 14, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

/** Soft additive halo sprite used under a glowing keycap. */
export function createGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createKeycapMaterial(
  colorHex: string,
  finish: KeycapFinish
): THREE.MeshPhysicalMaterial {
  const color = new THREE.Color(colorHex);

  switch (finish) {
    case 'matte':
      // Bead-blasted PBT: soft diffuse body with a faint satin sheen
      return new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.58,
        metalness: 0,
        clearcoat: 0.12,
        clearcoatRoughness: 0.5,
        sheen: 0.15,
        sheenRoughness: 0.6,
        sheenColor: new THREE.Color('#FFF6EE'),
        envMapIntensity: 0.72,
      });

    case 'glossy':
      // Piano lacquer: coloured base under a mirror-like clear coat
      return new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.32,
        metalness: 0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        envMapIntensity: 1.15,
      });

    case 'frosted':
      // Frosted polycarbonate: soft see-through haze; no depth write → no inner clipping
      return new THREE.MeshPhysicalMaterial({
        color: color.clone().lerp(new THREE.Color('#FFFFFF'), 0.12),
        roughness: 0.38,
        metalness: 0,
        transparent: true,
        opacity: 0.62,
        clearcoat: 0.7,
        clearcoatRoughness: 0.25,
        ior: 1.49,
        envMapIntensity: 1.25,
        depthWrite: false,
        side: THREE.FrontSide,
      });

    case 'metallic':
      // CNC anodised aluminium: true metal tinted by the swatch colour
      return new THREE.MeshPhysicalMaterial({
        color: color.clone().lerp(new THREE.Color('#D9DDE3'), 0.12),
        roughness: 0.24,
        metalness: 1.0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.12,
        envMapIntensity: 1.6,
      });

    case 'glow': {
      // Luminous resin: deep coloured body lit from within by a SATURATED emissive (no wash to white)
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      const neon = new THREE.Color().setHSL(hsl.h, Math.min(1, Math.max(0.55, hsl.s * 1.5)), Math.min(0.55, Math.max(0.32, hsl.l * 0.75)));
      return new THREE.MeshPhysicalMaterial({
        color: color.clone().multiplyScalar(0.45),
        emissive: neon,
        emissiveIntensity: 1.15,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.15,
        envMapIntensity: 0.6,
      });
    }
  }
}

export function createBaseMaterial(
  baseType: BaseMaterial,
  textures: SurfaceTextures
): THREE.MeshPhysicalMaterial {
  switch (baseType) {
    case 'wood':
      // Oiled walnut: real grain, satin finish
      return new THREE.MeshPhysicalMaterial({
        map: textures.wood,
        roughness: 0.48,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.32,
        envMapIntensity: 0.8,
      });

    case 'acrylic':
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#E3EEF7'),
        roughness: 0.16,
        metalness: 0,
        transparent: true,
        opacity: 0.6,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.4,
        depthWrite: false,
      });

    case 'aluminum':
      // Brushed aluminium: streaked albedo + fully metallic → anisotropic-looking sheen
      return new THREE.MeshPhysicalMaterial({
        map: textures.aluminum,
        color: new THREE.Color('#F2F4F7'),
        roughness: 0.3,
        metalness: 1.0,
        envMapIntensity: 1.5,
      });

    case 'plastic':
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#F3E4DC'),
        roughness: 0.46,
        metalness: 0.0,
        clearcoat: 0.22,
        clearcoatRoughness: 0.35,
        envMapIntensity: 0.9,
      });
  }
}
