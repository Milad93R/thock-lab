import * as THREE from 'three';
import { BaseMaterial, CharmType, KeycapShape } from '../types/build';

/**
 * Helper: Rounded rectangle 2D Shape centered at origin.
 */
function createRoundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const hw = w / 2;
  const hh = h / 2;
  const cr = Math.min(r, hw * 0.95, hh * 0.95);
  const s = new THREE.Shape();
  s.moveTo(-hw + cr, -hh);
  s.lineTo(hw - cr, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + cr);
  s.lineTo(hw, hh - cr);
  s.quadraticCurveTo(hw, hh, hw - cr, hh);
  s.lineTo(-hw + cr, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - cr);
  s.lineTo(-hw, -hh + cr);
  s.quadraticCurveTo(-hw, -hh, -hw + cr, -hh);
  return s;
}

/**
 * Replaces the normals of a geometry with area-weighted normals averaged over every
 * vertex that shares a position. Removes faceting on extruded bevels and the seams
 * where a lofted ring closes, while keeping UVs intact (works indexed or not).
 */
export function smoothNormalsByPosition(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const index = geo.index;
  const count = pos.count;
  const keyOf = (i: number) =>
    `${Math.round(pos.getX(i) * 1e4)}|${Math.round(pos.getY(i) * 1e4)}|${Math.round(pos.getZ(i) * 1e4)}`;
  const keys: string[] = new Array(count);
  const sums = new Map<string, THREE.Vector3>();
  for (let i = 0; i < count; i++) {
    keys[i] = keyOf(i);
    if (!sums.has(keys[i])) sums.set(keys[i], new THREE.Vector3());
  }
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const triCount = index ? index.count / 3 : count / 3;
  for (let t = 0; t < triCount; t++) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    cb.subVectors(c, b);
    ab.subVectors(a, b);
    cb.cross(ab); // area-weighted face normal
    sums.get(keys[ia])!.add(cb);
    sums.get(keys[ib])!.add(cb);
    sums.get(keys[ic])!.add(cb);
  }
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const n = sums.get(keys[i])!.clone();
    if (n.lengthSq() < 1e-20) n.set(0, 1, 0);
    n.normalize();
    normals[i * 3] = n.x;
    normals[i * 3 + 1] = n.y;
    normals[i * 3 + 2] = n.z;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

interface KeycapParams {
  hx: number; // bottom half-width (x)
  hz: number; // bottom half-depth (z)
  height: number;
  cornerR: number; // bottom plan-view corner radius
  taperInset: number; // how much the wall leans inward before the shoulder
  fillet: number; // shoulder fillet radius
  dish?: number; // concave finger scoop depth
  dome?: number; // convex crown height
}

const CORNER_SEGS = 9;
const EDGE_SEGS = 5;

/**
 * Plan-view rounded rectangle ring at height y (CCW seen from +Y). Straight edges are
 * subdivided too, so every ring has an even vertex spread and morphing between square
 * and round rings never produces long thin triangles (the source of diagonal creases).
 */
function ringPoints(
  ax: number,
  az: number,
  r: number,
  y: number | ((x: number, z: number) => number),
  out: number[]
): void {
  const Y = (x: number, z: number) => (typeof y === 'number' ? y : y(x, z));
  const rr = Math.max(0.0005, Math.min(r, ax, az));
  const cx = Math.max(0, ax - rr);
  const cz = Math.max(0, az - rr);
  const centers: [number, number][] = [
    [cx, cz],
    [-cx, cz],
    [-cx, -cz],
    [cx, -cz],
  ];
  for (let k = 0; k < 4; k++) {
    const [ox, oz] = centers[k];
    for (let s = 0; s <= CORNER_SEGS; s++) {
      const th = (k * Math.PI) / 2 + (s / CORNER_SEGS) * (Math.PI / 2);
      const px = ox + rr * Math.cos(th);
      const pz = oz + rr * Math.sin(th);
      out.push(px, Y(px, pz), pz);
    }
    // straight edge from the end of this corner arc to the start of the next one
    const thEnd = ((k + 1) * Math.PI) / 2;
    const ex = ox + rr * Math.cos(thEnd);
    const ez = oz + rr * Math.sin(thEnd);
    const [nx, nz] = centers[(k + 1) % 4];
    const sx = nx + rr * Math.cos(thEnd);
    const sz = nz + rr * Math.sin(thEnd);
    for (let e = 1; e < EDGE_SEGS; e++) {
      const t = e / EDGE_SEGS;
      const px = ex + (sx - ex) * t;
      const pz = ez + (sz - ez) * t;
      out.push(px, Y(px, pz), pz);
    }
  }
}

/**
 * Sculpted keycap as one continuous lofted surface: tapered wall → round shoulder
 * fillet → concave dish (or domed crown), closed with a flat underside.
 * Origin at bottom centre (y = 0).
 */
function buildLoftedKeycap(p: KeycapParams): THREE.BufferGeometry {
  const rings: { ax: number; az: number; r: number; y: number | ((x: number, z: number) => number); v: number }[] = [];
  const wallTop = p.height - p.fillet;
  const WALL_RINGS = 6;
  for (let i = 0; i <= WALL_RINGS; i++) {
    const t = i / WALL_RINGS;
    // Gentle outward belly near the skirt reads as moulded plastic, not a box
    const inset = p.taperInset * Math.pow(t, 1.18);
    rings.push({ ax: p.hx - inset, az: p.hz - inset, r: p.cornerR - inset, y: wallTop * t, v: t * 0.55 });
  }
  const FILLET_RINGS = 8;
  for (let i = 1; i <= FILLET_RINGS; i++) {
    const th = (i / FILLET_RINGS) * (Math.PI / 2);
    const inset = p.taperInset + p.fillet * (1 - Math.cos(th));
    rings.push({
      ax: p.hx - inset,
      az: p.hz - inset,
      r: p.cornerR - inset,
      y: wallTop + p.fillet * Math.sin(th),
      v: 0.55 + 0.2 * (i / FILLET_RINGS),
    });
  }
  const last = rings[rings.length - 1];
  // True spherical-style scoop / crown: height depends on the real radial distance from the
  // centre (zero slope at its rim and at the centre), so it never shows ring-shaped creases.
  const rIn = Math.min(last.ax, last.az) * 0.98;
  const topHeight = (x: number, z: number) => {
    const d2 = Math.min(1, (x * x + z * z) / (rIn * rIn));
    const w = Math.pow(1 - d2, 2);
    let y = p.height;
    if (p.dish) y -= p.dish * w;
    if (p.dome) y += p.dome * w;
    return y;
  };
  const TOP_RINGS = 12;
  for (let i = 1; i <= TOP_RINGS; i++) {
    const s = 1 - i / TOP_RINGS; // 1 at shoulder → 0 at centre
    const y = topHeight;
    // Corner radius blends toward a full circle near the centre → no diagonal creases in the dish
    const toward = Math.min(last.ax, last.az);
    const roundness = Math.pow(1 - s, 0.8);
    rings.push({
      ax: last.ax * s,
      az: last.az * s,
      r: Math.max(0.0005, last.r + (toward - last.r) * roundness) * s,
      y,
      v: 0.75 + 0.25 * (i / TOP_RINGS),
    });
  }

  const perRing = 4 * (CORNER_SEGS + 1 + EDGE_SEGS - 1);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const ring of rings) {
    ringPoints(ring.ax, ring.az, ring.r, ring.y, positions);
    for (let j = 0; j < perRing; j++) uvs.push(j / perRing, ring.v);
  }
  const indices: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < perRing; j++) {
      const a = i * perRing + j;
      const b = i * perRing + ((j + 1) % perRing);
      const c = (i + 1) * perRing + j;
      const d = (i + 1) * perRing + ((j + 1) % perRing);
      // CCW from outside
      indices.push(a, c, b, b, c, d);
    }
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  side.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  side.setIndex(indices);
  smoothNormalsByPosition(side);

  // Flat underside cap (kept separate so the bottom edge stays crisp)
  const capPos: number[] = [];
  ringPoints(rings[0].ax, rings[0].az, rings[0].r, 0, capPos);
  const capCount = capPos.length / 3;
  capPos.push(0, 0, 0);
  const capIdx: number[] = [];
  for (let j = 0; j < capCount; j++) {
    capIdx.push(capCount, j, (j + 1) % capCount);
  }

  const sidePos = side.attributes.position.array as Float32Array;
  const sideNorm = side.attributes.normal.array as Float32Array;
  const sideUv = side.attributes.uv.array as Float32Array;
  const base = sidePos.length / 3;
  const allPos = new Float32Array(sidePos.length + capPos.length);
  allPos.set(sidePos, 0);
  allPos.set(capPos, sidePos.length);
  const allNorm = new Float32Array(allPos.length);
  allNorm.set(sideNorm, 0);
  for (let i = base; i < allPos.length / 3; i++) allNorm[i * 3 + 1] = -1;
  const allUv = new Float32Array((allPos.length / 3) * 2);
  allUv.set(sideUv, 0);
  const allIdx = [...indices, ...capIdx.map((k) => k + base)];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(allNorm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(allUv, 2));
  geo.setIndex(allIdx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  side.dispose();
  return geo;
}

export const KEYCAP_PARAMS: Record<KeycapShape, KeycapParams> = {
  square: { hx: 0.71, hz: 0.71, height: 0.72, cornerR: 0.27, taperInset: 0.14, fillet: 0.09, dish: 0.07 },
  'low-profile': { hx: 0.74, hz: 0.74, height: 0.38, cornerR: 0.24, taperInset: 0.06, fillet: 0.08, dish: 0.03 },
  'tall-artisan': { hx: 0.69, hz: 0.69, height: 0.94, cornerR: 0.34, taperInset: 0.15, fillet: 0.17, dome: 0.1 },
  pill: { hx: 0.89, hz: 0.58, height: 0.64, cornerR: 0.52, taperInset: 0.1, fillet: 0.1, dish: 0.05 },
  round: { hx: 0.71, hz: 0.71, height: 0.66, cornerR: 0.71, taperInset: 0.1, fillet: 0.09, dish: 0.06 },
};

/**
 * Builds geometry for each of the 5 keycap shapes (origin at bottom center y=0).
 */
export function createKeycapGeometry(shape: KeycapShape): THREE.BufferGeometry {
  return buildLoftedKeycap(KEYCAP_PARAMS[shape]);
}

/**
 * Creates a detailed mechanical switch assembly (translucent housing + colored MX stem)
 * peeking beneath the keycap.
 */
export function createSwitchAssembly(stemColorHex: string): {
  housingGroup: THREE.Group;
  stemGroup: THREE.Group;
} {
  const housingGroup = new THREE.Group();

  // Translucent milky polycarbonate switch top housing
  const housingMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#F2EFEA'),
    roughness: 0.26,
    metalness: 0.02,
    transparent: true,
    opacity: 0.86,
    clearcoat: 0.5,
  });

  const baseGeo = smoothNormalsByPosition(
    new THREE.ExtrudeGeometry(createRoundedRectShape(0.92, 0.92, 0.08), {
      depth: 0.2,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      curveSegments: 6,
    }).rotateX(-Math.PI / 2)
  );
  const baseMesh = new THREE.Mesh(baseGeo, housingMat);
  baseMesh.position.y = 0.03;
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  housingGroup.add(baseMesh);

  // Subtle tapered upper switch collar
  const collarGeo = new THREE.CylinderGeometry(0.33, 0.4, 0.12, 4, 1);
  collarGeo.rotateY(Math.PI / 4);
  const collarMesh = new THREE.Mesh(collarGeo, housingMat);
  collarMesh.position.y = 0.3;
  housingGroup.add(collarMesh);

  // Tiny metallic gold spring ring inside
  const springMat = new THREE.MeshStandardMaterial({
    color: '#D8A94A',
    metalness: 0.85,
    roughness: 0.25,
  });
  const springRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 24), springMat);
  springRing.rotation.x = Math.PI / 2;
  springRing.position.y = 0.2;
  housingGroup.add(springRing);

  // Moving MX stem group
  const stemGroup = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(stemColorHex),
    roughness: 0.38,
    metalness: 0.05,
  });

  const stemBox = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.46), stemMat);
  stemBox.position.y = 0.34;
  stemGroup.add(stemBox);

  // Iconic MX '+' cross stem (sits cleanly inside even low-profile keycaps)
  const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.09), stemMat);
  crossA.position.y = 0.5;
  const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.28), stemMat);
  crossB.position.y = 0.5;
  stemGroup.add(crossA, crossB);

  return { housingGroup, stemGroup };
}

/**
 * Creates the chunky rounded desk base housing for each of the 4 base materials,
 * complete with recessed plate bezel, silicone feet, and a machined charm lug + eyelet.
 */
export function createBaseHousing(
  baseType: BaseMaterial,
  material: THREE.MeshPhysicalMaterial
): {
  group: THREE.Group;
  eyeletAnchor: THREE.Vector3;
} {
  const group = new THREE.Group();

  const extrudeSettings = (depth: number, bevel: number): THREE.ExtrudeGeometryOptions => ({
    depth,
    bevelEnabled: true,
    bevelSegments: 6,
    steps: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 14,
  });

  let bodyTop = 0.7;
  if (baseType === 'acrylic') {
    // 3 stacked frosted translucent acrylic layers + 4 brushed steel corner standoffs
    const layerShape = createRoundedRectShape(2.04, 2.04, 0.36);
    const layerHeights = [0.06, 0.28, 0.5];
    for (const y of layerHeights) {
      const geo = smoothNormalsByPosition(
        new THREE.ExtrudeGeometry(layerShape, extrudeSettings(0.14, 0.035)).rotateX(-Math.PI / 2)
      );
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.y = y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      group.add(mesh);
    }

    const screwMat = new THREE.MeshStandardMaterial({
      color: '#C9CED6',
      metalness: 0.95,
      roughness: 0.2,
    });
    const screwGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.64, 18);
    const capGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 18);
    const offsets = [-0.76, 0.76];
    for (const ox of offsets) {
      for (const oz of offsets) {
        const bolt = new THREE.Mesh(screwGeo, screwMat);
        bolt.position.set(ox, 0.37, oz);
        group.add(bolt);
        const cap = new THREE.Mesh(capGeo, screwMat);
        cap.position.set(ox, 0.7, oz);
        group.add(cap);
      }
    }
    bodyTop = 0.675;
  } else {
    const cornerR = baseType === 'plastic' ? 0.44 : baseType === 'aluminum' ? 0.28 : 0.32;
    const bevel = baseType === 'plastic' ? 0.1 : baseType === 'aluminum' ? 0.06 : 0.08;
    const bodyShape = createRoundedRectShape(1.98, 1.98, cornerR);
    const bodyGeo = smoothNormalsByPosition(
      new THREE.ExtrudeGeometry(bodyShape, extrudeSettings(0.5, bevel)).rotateX(-Math.PI / 2)
    );
    const bodyMesh = new THREE.Mesh(bodyGeo, material);
    bodyMesh.position.y = 0.12;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);
    bodyTop = 0.62 + bevel;
  }

  // Top recessed switch plate bezel (gives contrast around the switch stem!)
  const plateColor =
    baseType === 'wood'
      ? '#C89B54' // warm brass plate on walnut
      : baseType === 'aluminum'
        ? '#2B2E34' // anodized obsidian plate on silver aluminum
        : baseType === 'acrylic'
          ? '#F6F9FC'
          : '#E5D3C9';

  const plateMat = new THREE.MeshStandardMaterial({
    color: plateColor,
    metalness: baseType === 'wood' || baseType === 'aluminum' ? 0.8 : 0.1,
    roughness: baseType === 'wood' || baseType === 'aluminum' ? 0.3 : 0.5,
  });
  const plateGeo = smoothNormalsByPosition(
    new THREE.ExtrudeGeometry(createRoundedRectShape(1.36, 1.36, 0.18), {
      depth: 0.03,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.015,
      bevelThickness: 0.015,
      curveSegments: 10,
    }).rotateX(-Math.PI / 2)
  );
  const plateMesh = new THREE.Mesh(plateGeo, plateMat);
  plateMesh.position.y = bodyTop - 0.005;
  plateMesh.receiveShadow = true;
  group.add(plateMesh);

  // Dark switch socket cavity
  const wellMat = new THREE.MeshStandardMaterial({
    color: '#1E1A18',
    roughness: 0.85,
  });
  const well = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), wellMat);
  well.position.y = bodyTop + 0.03;
  group.add(well);

  // 4 subtle silicone anti-slip feet at base bottom
  const footMat = new THREE.MeshStandardMaterial({
    color: '#2B2522',
    roughness: 0.9,
  });
  const footGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.06, 16);
  for (const fx of [-0.72, 0.72]) {
    for (const fz of [-0.72, 0.72]) {
      const foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(fx, 0.03, fz);
      group.add(foot);
    }
  }

  // Machined lug on the right face + a proud eyelet ring the chain hangs from.
  const metalColor = baseType === 'wood' ? '#D6AF66' : '#C8CDD6';
  const eyeletMat = new THREE.MeshStandardMaterial({
    color: metalColor,
    metalness: 0.95,
    roughness: 0.2,
  });
  const faceX = baseType === 'acrylic' ? 1.055 : 1.0 + (baseType === 'plastic' ? 0.1 : baseType === 'aluminum' ? 0.06 : 0.08);
  const lugY = 0.62;
  const lugZ = 0.42;
  const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 20), eyeletMat);
  lug.rotation.z = Math.PI / 2;
  lug.position.set(faceX + 0.03, lugY, lugZ);
  lug.castShadow = true;
  group.add(lug);

  const ringR = 0.075;
  const eyelet = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.022, 12, 28), eyeletMat);
  eyelet.position.set(faceX + 0.08 + ringR, lugY, lugZ);
  // Ring stands in the x–y plane, sticking out of the side like a real key-ring lug
  eyelet.castShadow = true;
  group.add(eyelet);

  // Anchor at the bottom of the eyelet ring
  const eyeletAnchor = new THREE.Vector3(faceX + 0.08 + ringR, lugY - ringR, lugZ);

  return { group, eyeletAnchor };
}

/**
 * Creates a sculpted 3D charm hanging from a 3-link metallic chain.
 * Origin (0,0,0) is the top pivot where the chain meets the base eyelet!
 */
export function createCharmPendulum(charm: CharmType): THREE.Group {
  const root = new THREE.Group();

  // Short 2-link metallic chain
  const chainMat = new THREE.MeshStandardMaterial({
    color: '#D5B670',
    metalness: 0.95,
    roughness: 0.18,
  });
  const linkGeo = new THREE.TorusGeometry(0.045, 0.012, 8, 18);
  for (let i = 0; i < 2; i++) {
    const link = new THREE.Mesh(linkGeo, chainMat);
    link.scale.set(1, 1.35, 1);
    link.position.y = -0.045 - i * 0.072;
    link.rotation.y = i % 2 === 0 ? Math.PI / 2 : 0;
    link.castShadow = true;
    root.add(link);
  }

  // Jump ring that the charm body hangs from
  const jump = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 8, 16), chainMat);
  jump.position.y = -0.158;
  root.add(jump);

  // Charm body hangs below the last chain link
  const charmGroup = new THREE.Group();
  charmGroup.position.y = -0.18;
  charmGroup.scale.setScalar(0.96);
  root.add(charmGroup);

  const eyeMat = new THREE.MeshStandardMaterial({
    color: '#1E1A18',
    roughness: 0.2,
  });
  const blushMat = new THREE.MeshStandardMaterial({ color: '#F6A5B7', roughness: 0.6 });

  switch (charm) {
    case 'star': {
      const starShape = new THREE.Shape();
      const spikes = 5;
      const outerR = 0.2;
      const innerR = 0.1;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = (i * Math.PI) / spikes + Math.PI / 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) starShape.moveTo(x, y);
        else starShape.lineTo(x, y);
      }
      starShape.closePath();
      const geo = smoothNormalsByPosition(
        new THREE.ExtrudeGeometry(starShape, {
          depth: 0.05,
          bevelEnabled: true,
          bevelSegments: 5,
          bevelSize: 0.035,
          bevelThickness: 0.04,
        })
      );
      geo.center();
      const mat = new THREE.MeshPhysicalMaterial({
        color: '#F6C63F',
        roughness: 0.2,
        metalness: 0.3,
        clearcoat: 0.9,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = -0.17;
      mesh.castShadow = true;
      charmGroup.add(mesh);
      const eL = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), eyeMat);
      eL.scale.set(1, 1, 0.5);
      eL.position.set(-0.04, -0.16, 0.066);
      const eR = eL.clone();
      eR.position.x = 0.04;
      charmGroup.add(eL, eR);
      break;
    }

    case 'cherry': {
      const cherryMat = new THREE.MeshPhysicalMaterial({
        color: '#DA2F47',
        roughness: 0.12,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
      });
      const leftBerry = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), cherryMat);
      leftBerry.position.set(-0.09, -0.2, 0.015);
      leftBerry.castShadow = true;
      const rightBerry = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18), cherryMat);
      rightBerry.position.set(0.09, -0.23, -0.015);
      rightBerry.castShadow = true;

      const stemMat = new THREE.MeshStandardMaterial({ color: '#4B8E56', roughness: 0.5 });
      const leftCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0.0, 0),
        new THREE.Vector3(-0.07, -0.05, 0),
        new THREE.Vector3(-0.09, -0.11, 0.015)
      );
      const rightCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0.0, 0),
        new THREE.Vector3(0.07, -0.06, 0),
        new THREE.Vector3(0.09, -0.14, -0.015)
      );
      const stemL = new THREE.Mesh(new THREE.TubeGeometry(leftCurve, 12, 0.012, 8, false), stemMat);
      const stemR = new THREE.Mesh(new THREE.TubeGeometry(rightCurve, 12, 0.012, 8, false), stemMat);

      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), stemMat);
      leaf.scale.set(1.4, 0.4, 0.75);
      leaf.position.set(0.06, -0.02, 0.02);
      leaf.rotation.z = -0.35;

      charmGroup.add(leftBerry, rightBerry, stemL, stemR, leaf);
      break;
    }

    case 'cloud': {
      const cloudMat = new THREE.MeshPhysicalMaterial({
        color: '#F2F7FF',
        roughness: 0.4,
        clearcoat: 0.3,
        sheen: 0.4,
        sheenColor: new THREE.Color('#DDE9FF'),
      });
      const puffs: [number, number, number, number][] = [
        [0, -0.1, 0, 0.12],
        [-0.11, -0.14, 0.0, 0.09],
        [0.11, -0.14, 0.0, 0.09],
        [-0.055, -0.17, 0.02, 0.09],
        [0.055, -0.17, 0.02, 0.09],
      ];
      for (const [x, y, z, r] of puffs) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), cloudMat);
        m.position.set(x, y, z);
        m.castShadow = true;
        charmGroup.add(m);
      }
      const eL = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), eyeMat);
      eL.position.set(-0.04, -0.13, 0.11);
      const eR = eL.clone();
      eR.position.x = 0.04;
      const bL = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), blushMat);
      bL.scale.set(1.3, 0.6, 0.4);
      bL.position.set(-0.07, -0.16, 0.1);
      const bR = bL.clone();
      bR.position.x = 0.07;
      charmGroup.add(eL, eR, bL, bR);
      break;
    }

    case 'ghost': {
      const ghostMat = new THREE.MeshPhysicalMaterial({
        color: '#F1EDFB',
        roughness: 0.3,
        clearcoat: 0.5,
        sheen: 0.3,
        sheenColor: new THREE.Color('#E6E0FF'),
      });
      const rimColor = new THREE.Color('#847691');
      ghostMat.onBeforeCompile = (shader) => {
        shader.uniforms.ghostRimColor = { value: rimColor };
        shader.fragmentShader = `uniform vec3 ghostRimColor;\n${shader.fragmentShader}`.replace(
          '#include <opaque_fragment>',
          `float facing = abs(dot(normal, normalize(vViewPosition)));
           outgoingLight = mix(ghostRimColor, outgoingLight, smoothstep(0.33, 0.70, facing));
           #include <opaque_fragment>`
        );
      };
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 18), ghostMat);
      head.position.y = -0.1;
      head.castShadow = true;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.14, 0.15, 24, 1, true), ghostMat);
      body.position.y = -0.175;
      body.castShadow = true;

      // Scalloped hem puffs
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const hem = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), ghostMat);
        hem.position.set(Math.cos(a) * 0.1, -0.25, Math.sin(a) * 0.1);
        charmGroup.add(hem);
      }
      const hemFill = new THREE.Mesh(new THREE.CircleGeometry(0.14, 24), ghostMat);
      hemFill.rotation.x = Math.PI / 2;
      hemFill.position.y = -0.25;
      charmGroup.add(hemFill);

      const eL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), eyeMat);
      eL.scale.set(1, 1.3, 0.5);
      eL.position.set(-0.042, -0.1, 0.118);
      const eR = eL.clone();
      eR.position.x = 0.042;
      const bL = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 8), blushMat);
      bL.scale.set(1.3, 0.6, 0.4);
      bL.position.set(-0.075, -0.135, 0.104);
      const bR = bL.clone();
      bR.position.x = 0.075;

      charmGroup.add(head, body, eL, eR, bL, bR);
      break;
    }

    case 'mushroom': {
      const capMat = new THREE.MeshPhysicalMaterial({
        color: '#DF453A',
        roughness: 0.22,
        clearcoat: 0.7,
      });
      const stalkMat = new THREE.MeshStandardMaterial({
        color: '#F6ECDC',
        roughness: 0.55,
      });
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
        capMat
      );
      cap.position.y = -0.1;
      cap.castShadow = true;

      const capUnder = new THREE.Mesh(new THREE.CircleGeometry(0.155, 28), stalkMat);
      capUnder.rotation.x = Math.PI / 2;
      capUnder.position.y = -0.1 + 0.16 * Math.cos(Math.PI * 0.55) + 0.002;

      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.15, 20), stalkMat);
      stalk.position.y = -0.2;
      stalk.castShadow = true;

      const spotMat = new THREE.MeshStandardMaterial({ color: '#FFFDF7', roughness: 0.4 });
      // Spots sit ON the dome surface (flattened discs), not floating
      const spotDirs: [number, number][] = [
        [0.0, 0.25],
        [0.95, 0.75],
        [2.2, 0.8],
        [3.5, 0.7],
        [4.9, 0.85],
      ];
      for (const [az, pol] of spotDirs) {
        const dir = new THREE.Vector3(
          Math.sin(pol) * Math.cos(az),
          Math.cos(pol),
          Math.sin(pol) * Math.sin(az)
        );
        const spot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), spotMat);
        spot.scale.set(1, 0.3, 1);
        spot.position.copy(dir.clone().multiplyScalar(0.158)).add(new THREE.Vector3(0, -0.1, 0));
        spot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        charmGroup.add(spot);
      }
      const eL = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), eyeMat);
      eL.position.set(-0.025, -0.2, 0.072);
      const eR = eL.clone();
      eR.position.x = 0.025;

      charmGroup.add(cap, capUnder, stalk, eL, eR);
      break;
    }

    case 'cat': {
      const furMat = new THREE.MeshPhysicalMaterial({
        color: '#E99A55',
        roughness: 0.5,
        clearcoat: 0.25,
        sheen: 0.25,
        sheenColor: new THREE.Color('#FFD7AE'),
      });
      const earInnerMat = new THREE.MeshStandardMaterial({
        color: '#F29DA8',
        roughness: 0.5,
      });

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 28, 20), furMat);
      head.scale.set(1.14, 0.94, 0.9);
      head.position.y = -0.15;
      head.castShadow = true;

      const earGeo = new THREE.ConeGeometry(0.07, 0.15, 14);
      const earL = new THREE.Mesh(earGeo, furMat);
      earL.position.set(-0.1, -0.02, 0);
      earL.rotation.set(0, 0, 0.38);
      const earR = new THREE.Mesh(earGeo, furMat);
      earR.position.set(0.1, -0.02, 0);
      earR.rotation.set(0, 0, -0.38);
      const innerGeo = new THREE.ConeGeometry(0.04, 0.1, 12);
      const inL = new THREE.Mesh(innerGeo, earInnerMat);
      inL.position.set(-0.097, -0.03, 0.032);
      inL.rotation.set(0.22, 0, 0.38);
      const inR = new THREE.Mesh(innerGeo, earInnerMat);
      inR.position.set(0.097, -0.03, 0.032);
      inR.rotation.set(0.22, 0, -0.38);

      const eL = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), eyeMat);
      eL.scale.set(1, 1.25, 0.6);
      eL.position.set(-0.054, -0.14, 0.116);
      const eR = eL.clone();
      eR.position.x = 0.054;

      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), earInnerMat);
      nose.scale.set(1.3, 0.85, 0.7);
      nose.position.set(0, -0.172, 0.126);
      const bL = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), blushMat);
      bL.scale.set(1.3, 0.6, 0.4);
      bL.position.set(-0.09, -0.18, 0.1);
      const bR = bL.clone();
      bR.position.x = 0.09;

      charmGroup.add(head, earL, earR, inL, inR, eL, eR, nose, bL, bR);
      break;
    }

    case 'dice': {
      const dieMat = new THREE.MeshPhysicalMaterial({
        color: '#FAF6EE',
        roughness: 0.22,
        clearcoat: 0.7,
      });
      const pipMat = new THREE.MeshStandardMaterial({
        color: '#25211E',
        roughness: 0.35,
      });
      const redPipMat = new THREE.MeshStandardMaterial({
        color: '#DF453A',
        roughness: 0.3,
      });

      // Rounded cube: 0.2 core + 0.03 bevel each side → half-extent 0.13 on every axis
      const half = 0.13;
      const dieGeo = smoothNormalsByPosition(
        new THREE.ExtrudeGeometry(createRoundedRectShape(0.2, 0.2, 0.03), {
          depth: 0.2,
          bevelEnabled: true,
          bevelSegments: 4,
          bevelSize: 0.03,
          bevelThickness: 0.03,
          curveSegments: 6,
        })
      );
      dieGeo.center();
      const die = new THREE.Mesh(dieGeo, dieMat);
      die.position.y = -0.17;
      die.rotation.set(0.2, 0.55, 0.12);
      die.castShadow = true;

      const pipGeo = new THREE.CircleGeometry(0.019, 16);
      const addPip = (mat: THREE.Material, pos: THREE.Vector3, normal: THREE.Vector3, r = 1) => {
        const pip = new THREE.Mesh(pipGeo, mat);
        pip.scale.setScalar(r);
        pip.position.copy(pos);
        pip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        die.add(pip);
      };
      const off = half + 0.0015;
      // Front face (5)
      for (const [px, py] of [
        [0, 0],
        [-0.05, 0.05],
        [0.05, 0.05],
        [-0.05, -0.05],
        [0.05, -0.05],
      ]) {
        addPip(pipMat, new THREE.Vector3(px, py, off), new THREE.Vector3(0, 0, 1));
      }
      // Right face (1, red)
      addPip(redPipMat, new THREE.Vector3(off, 0, 0), new THREE.Vector3(1, 0, 0), 1.45);
      // Left face (3)
      for (const d of [-0.05, 0, 0.05]) {
        addPip(pipMat, new THREE.Vector3(-off, d, d), new THREE.Vector3(-1, 0, 0));
      }
      // Top face (2)
      addPip(pipMat, new THREE.Vector3(-0.045, off, -0.045), new THREE.Vector3(0, 1, 0));
      addPip(pipMat, new THREE.Vector3(0.045, off, 0.045), new THREE.Vector3(0, 1, 0));

      charmGroup.add(die);
      break;
    }
  }

  return root;
}
