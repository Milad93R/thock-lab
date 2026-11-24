import * as THREE from 'three';
import {
  ClickerBuild,
  getDailyVariant,
  SWITCH_MAP,
} from '../types/build';
import {
  createBaseHousing,
  createCharmPendulum,
  createKeycapGeometry,
  createSwitchAssembly,
} from './geometry';
import {
  createBaseMaterial,
  createContactShadowTexture,
  createGlowTexture,
  createKeycapMaterial,
  createStudioEnvironment,
  loadSurfaceTextures,
  SurfaceTextures,
} from './materials';
import { BASE_MATERIALS, CHARM_CATALOG, KEYCAP_FINISHES } from '../types/build';

interface ParticleState {
  active: boolean;
  celebration: boolean;
  bornAt: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
  color: THREE.Color;
}

/** Visible area (CSS px, relative to the canvas) that UI chrome leaves free for the gadget. */
export interface StageFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_THETA = 0.62; // Azimuth: front-3/4 view showing the charm on the right
const DEFAULT_PHI = 0.96; // Polar angle from top
const FOV = 34;
const GADGET_RADIUS = 1.6; // bounding radius around the look-at point (base + cap + charm)
const LOOK_AT = new THREE.Vector3(0.1, 0.36, 0);
const MAX_PARTICLES = 96;
const PULSE_RADIUS = 1.24;
const EPS = 1e-4;

export interface ClickerSceneCallbacks {
  onKeyDown: () => void;
  onKeyUp: () => void;
  onCameraReset?: () => void;
  /** WebGL became unusable (context lost for good) → host should switch to the 2D clicker. */
  onFatal?: (reason: string) => void;
}

/** Cheap capability probe so we never ask three.js for a context that cannot exist. */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export class ClickerScene {
  private container: HTMLElement;
  private callbacks: ClickerSceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private envTex: THREE.Texture;

  private textures: SurfaceTextures;
  private contactShadowTex: THREE.CanvasTexture;
  private glowTex: THREE.CanvasTexture;

  // Lights (intensities are animated for the glow finish; light COUNT never changes → no recompiles)
  private hemi!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private glowLight: THREE.PointLight;
  private glowSprite: THREE.Sprite;

  // Scene hierarchy
  private gadgetRoot = new THREE.Group();
  private baseHolder = new THREE.Group();
  private switchHolder = new THREE.Group();
  private movingCapRoot = new THREE.Group();
  private charmPivot = new THREE.Group();
  private keycapMesh: THREE.Mesh | null = null;

  // Floor pulse ring
  private pulseRing: THREE.Mesh;
  private pulseScale = 1;
  private viewProjection = new THREE.Matrix4();
  private pulseAge = 99;

  // Instanced burst particles (ring buffer)
  private particleMesh: THREE.InstancedMesh;
  private particles: ParticleState[] = [];
  private particleSerial = 0;
  private dummy = new THREE.Object3D();

  // Active build & settings
  private build: ClickerBuild;
  private reducedMotion = false;
  private glowMix = 0;

  // Key spring physics
  private isHeld = false;
  private capOffset = 0; // 0 = rest, negative = pressed down
  private capVelocity = 0;
  private restCapY = 1.04;

  // Charm 2-DOF damped pendulum physics
  private charmAngleZ = 0;
  private charmVelZ = 0;
  private charmAngleX = 0;
  private charmVelX = 0;

  // Orbit camera state
  private theta = DEFAULT_THETA;
  private phi = DEFAULT_PHI;
  private targetTheta = DEFAULT_THETA;
  private targetPhi = DEFAULT_PHI;
  private radius = 7;
  private targetRadius = 7;
  private offX = 0;
  private offY = 0;
  private targetOffX = 0;
  private targetOffY = 0;
  private frame: StageFrame | null = null;
  private viewW = 1;
  private viewH = 1;

  // "Alive" camera breathing only while the user is playing; fades out when idle
  private driftTime = 0;
  private driftAmp = 0;
  private lastInteraction = -1e9;

  // Pointer interaction state
  private raycaster = new THREE.Raycaster();
  private activePointerId: number | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointerDownOnKey = false;
  private isDraggingOrbit = false;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private lastCameraResetAt = -1e9;

  // Render-on-demand loop state
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private disposed = false;
  private manual = false;
  private contextLost = false;
  private contextLostTimer: number | null = null;
  private resizeObserver: ResizeObserver;
  private precompileRoot: THREE.Group | null = null;
  private precompileState: 'idle' | 'running' | 'done' = 'idle';
  public renderCount = 0;

  constructor(
    container: HTMLElement,
    initialBuild: ClickerBuild,
    reducedMotion: boolean,
    callbacks: ClickerSceneCallbacks
  ) {
    this.container = container;
    this.build = { ...initialBuild };
    this.reducedMotion = reducedMotion;
    this.callbacks = callbacks;
    this.manual = (window as unknown as { __THOCK_MANUAL__?: boolean }).__THOCK_MANUAL__ === true;

    this.scene = new THREE.Scene();

    this.viewW = Math.max(container.clientWidth, 1);
    this.viewH = Math.max(container.clientHeight, 1);

    this.camera = new THREE.PerspectiveCamera(FOV, this.viewW / this.viewH, 0.1, 60);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'default',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.viewW, this.viewH, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-testid', 'clicker-canvas');
    container.appendChild(canvas);

    this.envTex = createStudioEnvironment(this.renderer);
    this.scene.environment = this.envTex;

    this.textures = loadSurfaceTextures(this.renderer, () => {
      if (this.disposed) return;
      this.rebuildClicker();
      this.requestRender();
    });
    this.contactShadowTex = createContactShadowTexture();
    this.glowTex = createGlowTexture();

    this.setupLightsAndFloor();

    this.gadgetRoot.position.y = -0.38;
    this.scene.add(this.gadgetRoot);
    this.gadgetRoot.add(this.baseHolder);
    this.gadgetRoot.add(this.switchHolder);
    this.gadgetRoot.add(this.movingCapRoot);
    this.gadgetRoot.add(this.charmPivot);

    // Glow light lives in the scene permanently (intensity 0 unless the glow finish is on),
    // so switching finishes never changes the light count and never recompiles shaders.
    this.glowLight = new THREE.PointLight('#ffffff', 0, 5, 2);
    this.glowLight.position.set(0, 0.15, 0);
    this.movingCapRoot.add(this.glowLight);

    this.glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.glowSprite.scale.set(3.2, 3.2, 1);
    this.glowSprite.position.set(0, 0.9, 0);
    this.glowSprite.renderOrder = 2;
    this.gadgetRoot.add(this.glowSprite);

    // Floor pulse ring
    const ringGeo = new THREE.RingGeometry(1.15, PULSE_RADIUS, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(initialBuild.keycapColor),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.pulseRing = new THREE.Mesh(ringGeo, ringMat);
    this.pulseRing.position.y = -0.365;
    this.scene.add(this.pulseRing);

    // Instanced particle pool
    const pGeo = new THREE.IcosahedronGeometry(0.065, 0);
    const pMat = new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      roughness: 0.35,
      metalness: 0.1,
    });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        celebration: false,
        bornAt: 0,
        pos: new THREE.Vector3(0, -10, 0),
        vel: new THREE.Vector3(),
        age: 1,
        life: 1,
        scale: 0,
        color: new THREE.Color('#E85D3F'),
      });
      this.dummy.position.set(0, -10, 0);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
      this.particleMesh.setColorAt(i, new THREE.Color('#E85D3F'));
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.particleMesh);

    this.rebuildClicker();
    this.computeFrameTargets();
    this.snapCamera();
    this.updateCameraPosition(0);

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // First frame immediately (no zoom-in flash), then idle precompile of every finish/base/charm.
    this.renderNow();
    this.schedulePrecompile();
    this.exposeDebugHook();
  }

  // ───────────────────────── setup ─────────────────────────

  private setupLightsAndFloor(): void {
    this.hemi = new THREE.HemisphereLight('#FFFDF8', '#CEBAA8', 0.5);
    this.scene.add(this.hemi);

    // Single shadow-casting key light (mobile budget: one shadow map)
    this.keyLight = new THREE.DirectionalLight('#FFF3E6', 1.55);
    this.keyLight.position.set(4.8, 6.4, 4.4);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 16;
    const d = 3.2;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 4;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight('#DCEBFF', 0.6);
    this.rimLight.position.set(-5.2, 3.8, -4.6);
    this.scene.add(this.rimLight);

    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.7, 3.7),
      new THREE.MeshBasicMaterial({
        map: this.contactShadowTex,
        transparent: true,
        depthWrite: false,
      })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = -0.376;
    this.scene.add(contactShadow);
  }

  private disposeGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m?.dispose();
        }
      });
    }
  }

  private createGem(color: string): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshPhysicalMaterial({
        color: '#FFFDF7',
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.5,
        roughness: 0.1,
        metalness: 0.3,
      })
    );
  }

  private rebuildClicker(): void {
    this.disposeGroup(this.baseHolder);
    this.disposeGroup(this.switchHolder);
    // keep the persistent glow light, dispose the rest of the moving cap group
    this.movingCapRoot.remove(this.glowLight);
    this.disposeGroup(this.movingCapRoot);
    this.movingCapRoot.add(this.glowLight);
    this.disposeGroup(this.charmPivot);

    const baseMat = createBaseMaterial(this.build.baseMaterial, this.textures);
    const { group: baseGroup, eyeletAnchor } = createBaseHousing(this.build.baseMaterial, baseMat);
    this.baseHolder.add(baseGroup);

    const daily = getDailyVariant(this.build.dailyVariantId) ?? null;
    const stemColor = daily ? daily.accentColor : SWITCH_MAP[this.build.switchType].stemColor;
    const { housingGroup, stemGroup } = createSwitchAssembly(stemColor);
    housingGroup.position.y = 0.72;
    this.switchHolder.add(housingGroup);

    stemGroup.position.y = -0.32;
    this.movingCapRoot.add(stemGroup);

    const capGeo = createKeycapGeometry(this.build.keycapShape);
    const capMat = createKeycapMaterial(this.build.keycapColor, this.build.keycapFinish);
    const capMesh = new THREE.Mesh(capGeo, capMat);
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    capMesh.name = 'keycap';
    capMesh.renderOrder = this.build.keycapFinish === 'frosted' ? 3 : 0;
    this.movingCapRoot.add(capMesh);
    this.keycapMesh = capMesh;

    if (
      this.build.keycapShape === 'tall-artisan' &&
      (this.build.keycapFinish === 'frosted' || this.build.keycapFinish === 'glow')
    ) {
      const gem = this.createGem(this.build.keycapColor);
      gem.position.y = 0.44;
      this.movingCapRoot.add(gem);
    }

    // Glow finish: light the cap from within and dim the studio (uniform changes only)
    const isGlow = this.build.keycapFinish === 'glow';
    const neon = new THREE.Color(this.build.keycapColor);
    const hsl = { h: 0, s: 0, l: 0 };
    neon.getHSL(hsl);
    neon.setHSL(hsl.h, Math.min(1, Math.max(0.6, hsl.s * 1.5)), 0.55);
    this.glowLight.color.copy(neon);
    this.glowMix = isGlow ? 1 : 0;
    this.applyGlowMix();
    (this.glowSprite.material as THREE.SpriteMaterial).color.copy(neon);

    this.restCapY = this.build.keycapShape === 'low-profile' ? 1.06 : 1.04;
    this.movingCapRoot.position.y = this.restCapY + this.capOffset;

    this.charmPivot.position.copy(eyeletAnchor);
    this.charmPivot.add(createCharmPendulum(this.build.charm));

    (this.pulseRing.material as THREE.MeshBasicMaterial).color.set(this.build.keycapColor);
  }

  private applyGlowMix(): void {
    const g = this.glowMix;
    this.hemi.intensity = 0.5 - 0.22 * g;
    this.keyLight.intensity = 1.55 - 0.55 * g;
    this.rimLight.intensity = 0.6 - 0.2 * g;
    this.glowLight.intensity = 4.2 * g;
    (this.glowSprite.material as THREE.SpriteMaterial).opacity = 0.3 * g;
    this.glowSprite.visible = g > 0.001;
  }

  /** Compile every material variant during idle time so the first switch to any finish never stalls. */
  private schedulePrecompile(): void {
    if (this.precompileState !== 'idle') return;
    const run = () => {
      if (this.disposed || this.contextLost || this.precompileState !== 'idle') return;
      this.precompileState = 'running';
      const root = new THREE.Group();
      for (const fin of KEYCAP_FINISHES) {
        const m = new THREE.Mesh(createKeycapGeometry('square'), createKeycapMaterial('#E85D3F', fin.id));
        m.castShadow = true;
        m.receiveShadow = true;
        root.add(m);
      }
      root.add(this.createGem('#A996E8'));
      for (const bm of BASE_MATERIALS) {
        root.add(createBaseHousing(bm.id, createBaseMaterial(bm.id, this.textures)).group);
      }
      for (const ch of CHARM_CATALOG) root.add(createCharmPendulum(ch.id));
      const sw = createSwitchAssembly('#5B4573');
      root.add(sw.housingGroup, sw.stemGroup);
      root.add(new THREE.Sprite(this.glowSprite.material));
      this.precompileRoot = root;

      // Compile + warm a couple of objects per idle slice: drivers may defer the real link
      // until the first draw, so each batch is also drawn once into a 1×1 scissor of the
      // live canvas (same lights, same output → same programs), then the real frame is
      // repainted in the same task so nothing ever flashes.
      const queue = [...root.children];
      const step = () => {
        if (this.disposed || this.contextLost) return;
        const batch = new THREE.Group();
        const items = queue.splice(0, 2);
        for (const obj of items) batch.add(obj);
        batch.position.set(LOOK_AT.x, LOOK_AT.y, LOOK_AT.z);
        try {
          this.renderer.compile(batch, this.camera, this.scene);
          this.scene.add(batch);
          this.renderer.setScissorTest(true);
          this.renderer.setScissor(0, 0, 1, 1);
          this.renderer.render(this.scene, this.camera);
        } catch {
          // ignore — the material will simply compile on first use
        } finally {
          this.renderer.setScissorTest(false);
          this.scene.remove(batch);
          for (const obj of items) root.add(obj);
          try {
            this.renderer.render(this.scene, this.camera);
          } catch {
            // ignore
          }
        }
        if (queue.length > 0) idle(step);
        else this.precompileState = 'done';
      };
      idle(step);
    };
    const idle = (cb: () => void) => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      if (ric) ric(cb, { timeout: 2500 });
      else window.setTimeout(cb, 120);
    };
    idle(run);
  }

  // ───────────────────────── public API ─────────────────────────

  public updateBuild(nextBuild: ClickerBuild): void {
    const prev = this.build;
    const changed =
      prev.switchType !== nextBuild.switchType ||
      prev.dailyVariantId !== nextBuild.dailyVariantId ||
      prev.keycapShape !== nextBuild.keycapShape ||
      prev.keycapColor !== nextBuild.keycapColor ||
      prev.keycapFinish !== nextBuild.keycapFinish ||
      prev.baseMaterial !== nextBuild.baseMaterial ||
      prev.charm !== nextBuild.charm;
    if (!changed) return;

    const charmChanged = prev.charm !== nextBuild.charm;
    this.build = { ...nextBuild };
    this.rebuildClicker();

    if (charmChanged && !this.reducedMotion) {
      this.charmVelZ += 2.6;
      this.charmVelX += 0.8;
    }
    this.requestRender();
  }

  public setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        this.particles[i].active = false;
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.particleMesh.instanceMatrix.needsUpdate = true;
      this.driftAmp = 0;
      this.charmAngleX = this.charmAngleZ = this.charmVelX = this.charmVelZ = 0;
      this.pulseAge = 99;
    }
    this.requestRender();
  }

  /** Free area for the gadget (CSS px relative to the canvas). `immediate` skips the glide. */
  public setFrame(frame: StageFrame | null, immediate = false): void {
    this.frame = frame;
    this.computeFrameTargets();
    if (immediate || this.reducedMotion) {
      this.snapCamera();
      this.updateCameraPosition(0);
    }
    this.requestRender();
  }

  /**
   * Programmatic press down (canvas tap, keyboard Space, preview from the customizer).
   * A press while already held (rapid previews) re-triggers a fresh impulse.
   */
  public pressKey(comboStreak = 1): void {
    this.isHeld = true;
    this.markInteraction();

    const spec = SWITCH_MAP[this.build.switchType];
    this.capVelocity = -spec.travelUnits * 28;

    if (!this.reducedMotion) {
      const kick = 3.2 * spec.reboundKick;
      this.charmVelZ += kick * (0.85 + Math.random() * 0.3);
      this.charmVelX += (Math.random() - 0.5) * 2.4;
      this.pulseAge = 0;
      const count = comboStreak >= 20 ? 11 : comboStreak >= 10 ? 8 : 6;
      this.spawnParticles(count, false);
    } else {
      this.capOffset = -spec.travelUnits;
    }
    this.requestRender();
  }

  public releaseKey(): void {
    if (!this.isHeld) return;
    this.isHeld = false;
    this.markInteraction();

    const spec = SWITCH_MAP[this.build.switchType];
    if (!this.reducedMotion) {
      this.capVelocity += spec.travelUnits * 9 * spec.reboundKick;
      this.charmVelZ -= 1.2 * spec.reboundKick;
    } else {
      this.capOffset = 0;
    }
    this.requestRender();
  }

  /** Bigger celebration burst for combo milestones (25, 50, 100) — always visible. */
  public triggerMilestoneBurst(milestone: number): void {
    if (this.reducedMotion) return;
    const count = milestone >= 100 ? 40 : milestone >= 50 ? 32 : 24;
    this.spawnParticles(count, true);
    this.pulseAge = 0;
    this.charmVelZ += 4.5;
    this.requestRender();
  }

  public resetCamera(): void {
    const now = performance.now();
    this.targetTheta = DEFAULT_THETA;
    this.targetPhi = DEFAULT_PHI;
    if (this.reducedMotion) {
      this.theta = DEFAULT_THETA;
      this.phi = DEFAULT_PHI;
    }
    if (now - this.lastCameraResetAt > 350) {
      this.lastCameraResetAt = now;
      this.callbacks.onCameraReset?.();
    }
    this.requestRender();
  }

  // ───────────────────────── particles ─────────────────────────

  /** Picks a slot: free first; otherwise evict the oldest (celebrations evict regular sparks first). */
  private allocParticle(celebration: boolean): number {
    let oldestIdx = -1;
    let oldestBorn = Infinity;
    let oldestRegularIdx = -1;
    let oldestRegularBorn = Infinity;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) return i;
      if (p.bornAt < oldestBorn) {
        oldestBorn = p.bornAt;
        oldestIdx = i;
      }
      if (!p.celebration && p.bornAt < oldestRegularBorn) {
        oldestRegularBorn = p.bornAt;
        oldestRegularIdx = i;
      }
    }
    if (celebration && oldestRegularIdx >= 0) return oldestRegularIdx;
    return oldestIdx;
  }

  private spawnParticles(count: number, celebration: boolean): void {
    const palette = celebration
      ? ['#E85D3F', '#F5C451', '#6CC7B8', '#A996E8', '#F2A7B3', '#4B7BF5']
      : [this.build.keycapColor, '#FFF8F0', '#F5C451'];

    for (let n = 0; n < count; n++) {
      const i = this.allocParticle(celebration);
      const p = this.particles[i];
      p.active = true;
      p.celebration = celebration;
      p.bornAt = ++this.particleSerial;
      p.age = 0;
      p.life = celebration ? 0.75 + Math.random() * 0.4 : 0.38 + Math.random() * 0.22;
      const angle = celebration ? (n / count) * Math.PI * 2 + Math.random() * 0.3 : Math.random() * Math.PI * 2;
      const speed = celebration ? 2.2 + Math.random() * 2.2 : 1.1 + Math.random() * 1.4;
      p.pos.set(Math.cos(angle) * 0.45, 0.95 + Math.random() * 0.25, Math.sin(angle) * 0.45);
      p.vel.set(
        Math.cos(angle) * speed,
        (celebration ? 2.8 : 1.5) + Math.random() * 1.4,
        Math.sin(angle) * speed
      );
      p.scale = celebration ? 1.25 + Math.random() * 0.6 : 0.65 + Math.random() * 0.45;
      p.color.set(palette[n % palette.length]);
      this.particleMesh.setColorAt(i, p.color);
    }
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  public countCelebrationParticles(): number {
    return this.particles.filter((p) => p.active && p.celebration).length;
  }

  // ───────────────────────── camera ─────────────────────────

  private computeFrameTargets(): void {
    const W = this.viewW;
    const H = this.viewH;
    const f = this.frame && this.frame.w > 40 && this.frame.h > 40 ? this.frame : { x: 0, y: 0, w: W, h: H };
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const tanSub = Math.min(tanV * (f.h / H), tanV * (f.w / H));
    const halfAngle = Math.atan(tanSub);
    this.targetRadius = Math.max(5.2, (GADGET_RADIUS / Math.sin(halfAngle)) * 1.06);
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    this.targetOffX = W / 2 - cx;
    this.targetOffY = H / 2 - cy;
  }

  private snapCamera(): void {
    this.radius = this.targetRadius;
    this.offX = this.targetOffX;
    this.offY = this.targetOffY;
  }

  private markInteraction(): void {
    this.lastInteraction = performance.now();
  }

  private updateCameraPosition(dt: number): void {
    const a = this.reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-12 * dt);
    this.theta += (this.targetTheta - this.theta) * a;
    this.phi += (this.targetPhi - this.phi) * a;
    const b = this.reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-9 * dt);
    this.radius += (this.targetRadius - this.radius) * b;
    this.offX += (this.targetOffX - this.offX) * b;
    this.offY += (this.targetOffY - this.offY) * b;

    // Breathing drift only while playing; it fades out ~2.5 s after the last interaction.
    const wantDrift =
      !this.manual &&
      !this.reducedMotion &&
      !this.isDraggingOrbit &&
      performance.now() - this.lastInteraction < 2500
        ? 1
        : 0;
    this.driftAmp += (wantDrift - this.driftAmp) * Math.min(1, dt * 2.5);
    if (this.driftAmp < 0.002 && wantDrift === 0) this.driftAmp = 0;
    if (this.driftAmp > 0) this.driftTime += dt;
    const driftTheta = Math.sin(this.driftTime * 0.9) * 0.03 * this.driftAmp;
    const driftPhi = Math.cos(this.driftTime * 0.7) * 0.015 * this.driftAmp;

    const effPhi = Math.max(0.28, Math.min(1.22, this.phi + driftPhi));
    const effTheta = this.theta + driftTheta;

    this.camera.position.set(
      LOOK_AT.x + this.radius * Math.sin(effPhi) * Math.sin(effTheta),
      LOOK_AT.y + this.radius * Math.cos(effPhi),
      LOOK_AT.z + this.radius * Math.sin(effPhi) * Math.cos(effTheta)
    );
    this.camera.lookAt(LOOK_AT);
    this.camera.setViewOffset(this.viewW, this.viewH, this.offX, this.offY, this.viewW, this.viewH);
  }

  // ───────────────────────── physics ─────────────────────────

  private stepPhysics(dt: number): void {
    const spec = SWITCH_MAP[this.build.switchType];

    const targetOffset = this.isHeld ? -spec.travelUnits : 0;
    if (this.reducedMotion) {
      this.capOffset = targetOffset;
      this.capVelocity = 0;
    } else {
      const stiffness = this.isHeld ? spec.stiffness * 1.7 : spec.stiffness;
      const damping = this.isHeld ? spec.damping * 1.35 : spec.damping;
      const force = (targetOffset - this.capOffset) * stiffness - this.capVelocity * damping;
      this.capVelocity += force * dt;
      this.capOffset += this.capVelocity * dt;
      const minOffset = -spec.travelUnits * 1.08;
      if (this.capOffset < minOffset) {
        this.capOffset = minOffset;
        this.capVelocity = Math.max(0, this.capVelocity);
      }
      if (this.capOffset > 0.04) {
        this.capOffset = 0.04;
        this.capVelocity = Math.min(0, this.capVelocity);
      }
      if (Math.abs(this.capVelocity) < 0.002 && Math.abs(this.capOffset - targetOffset) < 0.0004) {
        this.capVelocity = 0;
        this.capOffset = targetOffset;
      }
    }
    this.movingCapRoot.position.y = this.restCapY + this.capOffset;

    const pressProgress = Math.max(0, -this.capOffset / spec.travelUnits);
    this.gadgetRoot.position.y = -0.38 - pressProgress * 0.018;

    if (!this.reducedMotion) {
      const gravity = 28;
      const damp = 3.2;
      const accZ = -gravity * Math.sin(this.charmAngleZ) - damp * this.charmVelZ;
      const accX = -gravity * Math.sin(this.charmAngleX) - damp * this.charmVelX;
      this.charmVelZ += accZ * dt;
      this.charmVelX += accX * dt;
      this.charmAngleZ = Math.max(-0.95, Math.min(0.95, this.charmAngleZ + this.charmVelZ * dt));
      this.charmAngleX = Math.max(-0.8, Math.min(0.8, this.charmAngleX + this.charmVelX * dt));
      if (
        Math.abs(this.charmAngleZ) + Math.abs(this.charmAngleX) < 0.0008 &&
        Math.abs(this.charmVelZ) + Math.abs(this.charmVelX) < 0.004
      ) {
        this.charmAngleZ = this.charmAngleX = this.charmVelZ = this.charmVelX = 0;
      }
      this.charmPivot.rotation.z = this.charmAngleZ;
      this.charmPivot.rotation.x = this.charmAngleX;
    } else {
      this.charmPivot.rotation.set(0, 0, 0);
    }

    const ringMat = this.pulseRing.material as THREE.MeshBasicMaterial;
    if (this.pulseAge < 0.55) {
      this.pulseAge += dt;
      const u = Math.min(1, this.pulseAge / 0.55);
      const eased = 1 - Math.pow(1 - u, 3);
      this.pulseScale = 1 + eased * 0.56;
      ringMat.opacity = (1 - u) * 0.34;
    } else {
      ringMat.opacity = 0;
    }

    let anyActive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyActive = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.vel.y -= 6.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const u = p.age / p.life;
      const s = p.scale * (1 - u * u);
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.set(p.age * 5, p.age * 3.5, 0);
      this.dummy.scale.setScalar(Math.max(0.001, s));
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (anyActive) this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  /** True while anything is still moving; when false the render loop stops completely. */
  private isAnimating(): boolean {
    if (this.isDraggingOrbit) return true;
    if (this.capVelocity !== 0) return true;
    const spec = SWITCH_MAP[this.build.switchType];
    const targetOffset = this.isHeld ? -spec.travelUnits : 0;
    if (Math.abs(this.capOffset - targetOffset) > EPS) return true;
    if (this.charmVelZ !== 0 || this.charmVelX !== 0 || this.charmAngleZ !== 0 || this.charmAngleX !== 0) {
      if (!this.reducedMotion) return true;
    }
    if (this.pulseAge < 0.55) return true;
    if (this.particles.some((p) => p.active)) return true;
    if (this.driftAmp > 0) return true;
    if (
      Math.abs(this.targetTheta - this.theta) > EPS ||
      Math.abs(this.targetPhi - this.phi) > EPS ||
      Math.abs(this.targetRadius - this.radius) > 0.002 ||
      Math.abs(this.targetOffX - this.offX) > 0.3 ||
      Math.abs(this.targetOffY - this.offY) > 0.3
    ) {
      return true;
    }
    return false;
  }

  // ───────────────────────── render loop (on demand) ─────────────────────────

  private fitPulseToFrame(): void {
    if ((this.pulseRing.material as THREE.MeshBasicMaterial).opacity <= 0) return;
    this.camera.updateMatrixWorld();
    const m = this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const { x, y, w, h } = this.frame ?? { x: 0, y: 0, w: this.viewW, h: this.viewH };
    const gap = 8;
    const floorY = this.pulseRing.position.y;

    // Each screen edge is a plane in clip space. Fit the floor circle using
    // the distance from its center to that plane along the floor.
    const limit = (axis: number, edge: number, sign: number) => {
      const center = (m[axis + 4] - edge * m[7]) * floorY + m[axis + 12] - edge * m[15];
      const slope = Math.hypot(m[axis] - edge * m[3], m[axis + 8] - edge * m[11]);
      return sign * center / (slope * PULSE_RADIUS);
    };
    const scale = Math.min(
      this.pulseScale,
      limit(0, 2 * (x + gap) / this.viewW - 1, 1),
      limit(0, 2 * (x + w - gap) / this.viewW - 1, -1),
      limit(1, 1 - 2 * (y + gap) / this.viewH, -1),
      limit(1, 1 - 2 * (y + h - gap) / this.viewH, 1),
    );
    this.pulseRing.scale.setScalar(Math.max(0, scale));
  }

  private projectedBounds(object: THREE.Object3D, radius?: number) {
    const bounds = new THREE.Box3().setFromObject(object);
    const point = new THREE.Vector3();
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < (radius === undefined ? 8 : 64); i++) {
      if (radius === undefined) {
        point.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z);
      } else {
        const angle = i * Math.PI / 32;
        point.set(radius * Math.cos(angle), object.position.y, radius * Math.sin(angle));
      }
      point.project(this.camera);
      left = Math.min(left, (point.x + 1) * this.viewW / 2);
      right = Math.max(right, (point.x + 1) * this.viewW / 2);
      top = Math.min(top, (1 - point.y) * this.viewH / 2);
      bottom = Math.max(bottom, (1 - point.y) * this.viewH / 2);
    }
    return { left, right, top, bottom };
  }

  private renderNow(): void {
    if (this.contextLost || this.disposed) return;
    try {
      this.fitPulseToFrame();
      this.renderer.render(this.scene, this.camera);
      this.renderCount++;
    } catch (err) {
      this.fail(`render: ${(err as Error)?.message ?? err}`);
    }
  }

  /** Schedule a frame; the loop keeps itself alive only while something animates. */
  public requestRender(): void {
    if (this.disposed || this.manual || this.contextLost) return;
    if (document.hidden) return;
    if (this.rafId !== null) return;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    this.rafId = null;
    if (this.disposed || this.contextLost || document.hidden) return;

    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    this.stepPhysics(dt);
    this.updateCameraPosition(dt);
    this.renderNow();

    if (this.isAnimating()) {
      this.rafId = requestAnimationFrame(this.loop);
    } else {
      // settle exactly on targets so the final frame is pixel-stable
      this.snapCamera();
      this.theta = this.targetTheta;
      this.phi = this.targetPhi;
    }
  };

  /** Deterministic stepping for tests: advance simulated time by `ms` and render one frame. */
  public advance(ms: number): void {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    const dt = ms / 1000 / steps;
    for (let i = 0; i < steps; i++) {
      this.stepPhysics(dt);
      this.updateCameraPosition(dt);
    }
    this.renderNow();
  }

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    } else {
      this.requestRender();
    }
  };

  private handleResize(): void {
    if (this.disposed) return;
    this.viewW = Math.max(this.container.clientWidth, 1);
    this.viewH = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = this.viewW / this.viewH;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.viewW, this.viewH, false);
    this.computeFrameTargets();
    this.snapCamera();
    this.updateCameraPosition(0);
    this.renderNow();
    this.requestRender();
  }

  private fail(reason: string): void {
    if (this.disposed) return;
    this.callbacks.onFatal?.(reason);
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.contextLostTimer = window.setTimeout(() => this.fail('context-lost'), 2500);
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    if (this.contextLostTimer !== null) {
      window.clearTimeout(this.contextLostTimer);
      this.contextLostTimer = null;
    }
    this.envTex.dispose();
    this.envTex = createStudioEnvironment(this.renderer);
    this.scene.environment = this.envTex;
    this.renderNow();
    this.requestRender();
  };

  // ───────────────────────── pointer input ─────────────────────────

  private isPointerHittingClicker(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    if (this.keycapMesh) targets.push(this.keycapMesh);
    targets.push(this.baseHolder);
    return this.raycaster.intersectObjects(targets, true).length > 0;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.pointerStartX = e.clientX;
    this.pointerStartY = e.clientY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.isDraggingOrbit = false;

    this.renderer.domElement.setPointerCapture?.(e.pointerId);

    this.pointerDownOnKey = this.isPointerHittingClicker(e.clientX, e.clientY);
    if (this.pointerDownOnKey) this.callbacks.onKeyDown();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    const dist = Math.hypot(e.clientX - this.pointerStartX, e.clientY - this.pointerStartY);

    if (!this.isDraggingOrbit && dist > 8) {
      this.isDraggingOrbit = true;
      if (this.pointerDownOnKey && this.isHeld) {
        this.callbacks.onKeyUp();
        this.pointerDownOnKey = false;
      }
    }

    if (this.isDraggingOrbit) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.targetTheta -= dx * 0.009;
      this.targetPhi = Math.max(0.28, Math.min(1.22, this.targetPhi - dy * 0.0075));
      if (!this.reducedMotion) this.charmVelZ += dx * 0.015;
      this.requestRender();
    }

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private onPointerUpOrCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.renderer.domElement.releasePointerCapture?.(e.pointerId);

    const wasDrag = this.isDraggingOrbit;
    const wasKey = this.pointerDownOnKey;

    this.activePointerId = null;
    this.isDraggingOrbit = false;
    this.pointerDownOnKey = false;

    if (wasKey && this.isHeld) this.callbacks.onKeyUp();

    if (e.type !== 'pointercancel' && !wasDrag && !wasKey) {
      const now = performance.now();
      const dtTap = now - this.lastTapTime;
      const dTap = Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY);
      if (dtTap < 340 && dTap < 48) {
        this.resetCamera();
        this.lastTapTime = 0;
      } else {
        this.lastTapTime = now;
        this.lastTapX = e.clientX;
        this.lastTapY = e.clientY;
      }
    }
    this.requestRender();
  };

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUpOrCancel);
    canvas.addEventListener('pointercancel', this.onPointerUpOrCancel);
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  private exposeDebugHook(): void {
    (window as unknown as { __thockScene?: unknown }).__thockScene = {
      advance: (ms: number) => this.advance(ms),
      renderCount: () => this.renderCount,
      programs: () => this.renderer.info.programs?.length ?? 0,
      precompiled: () => this.precompileState === 'done',
      celebrationParticles: () => this.countCelebrationParticles(),
      isAnimating: () => this.isAnimating() || this.rafId !== null,
      camera: () => ({ radius: this.radius, offX: this.offX, offY: this.offY }),
      keyHeld: () => this.isHeld,
      pulseBounds: () => this.projectedBounds(this.pulseRing, this.pulseRing.scale.x * PULSE_RADIUS),
      gadgetBounds: () => [this.baseHolder, this.switchHolder, this.movingCapRoot, this.charmPivot]
        .map((part) => this.projectedBounds(part))
        .reduce((a, b) => ({
          left: Math.min(a.left, b.left),
          top: Math.min(a.top, b.top),
          right: Math.max(a.right, b.right),
          bottom: Math.max(a.bottom, b.bottom),
        })),
      renderFrame: () => {
        this.renderNow();
        return this.renderer.domElement.toDataURL();
      },
      renderPng: (size: number) => this.renderSquare(size).toDataURL('image/png'),
    };
  }

  // ───────────────────────── capture ─────────────────────────

  /**
   * Renders a square, transparent-background image of the current build (no UI offset)
   * and returns the canvas holding it. The live view is restored immediately.
   */
  public renderSquare(size: number): HTMLCanvasElement {
    const renderRes = Math.min(size, 1080);
    const prevDpr = this.renderer.getPixelRatio();
    const prevPos = this.camera.position.clone();

    this.camera.clearViewOffset();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(renderRes, renderRes, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();

    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const snapRadius = (GADGET_RADIUS / tanV) * 1.08;
    this.camera.position.set(
      LOOK_AT.x + snapRadius * Math.sin(this.phi) * Math.sin(this.theta),
      LOOK_AT.y + snapRadius * Math.cos(this.phi),
      LOOK_AT.z + snapRadius * Math.sin(this.phi) * Math.cos(this.theta)
    );
    this.camera.lookAt(LOOK_AT);
    this.glowSprite.visible = this.glowMix > 0.001;
    this.renderer.render(this.scene, this.camera);

    const out = document.createElement('canvas');
    out.width = renderRes;
    out.height = renderRes;
    out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, renderRes, renderRes);

    // Restore live viewport
    this.renderer.setPixelRatio(prevDpr);
    this.renderer.setSize(this.viewW, this.viewH, false);
    this.camera.aspect = this.viewW / this.viewH;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(prevPos);
    this.camera.lookAt(LOOK_AT);
    this.camera.setViewOffset(this.viewW, this.viewH, this.offX, this.offY, this.viewW, this.viewH);
    this.renderNow();
    return out;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.contextLostTimer !== null) window.clearTimeout(this.contextLostTimer);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.resizeObserver.disconnect();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUpOrCancel);
    canvas.removeEventListener('pointercancel', this.onPointerUpOrCancel);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.disposeGroup(this.baseHolder);
    this.disposeGroup(this.switchHolder);
    this.disposeGroup(this.movingCapRoot);
    this.disposeGroup(this.charmPivot);
    if (this.precompileRoot) this.disposeGroup(this.precompileRoot);

    this.pulseRing.geometry.dispose();
    (this.pulseRing.material as THREE.Material).dispose();
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();
    (this.glowSprite.material as THREE.Material).dispose();

    this.envTex.dispose();
    this.textures.dispose();
    this.contactShadowTex.dispose();
    this.glowTex.dispose();

    this.renderer.dispose();
    if (canvas.parentElement === this.container) this.container.removeChild(canvas);
    const w = window as unknown as { __thockScene?: unknown };
    if (w.__thockScene) delete w.__thockScene;
  }
}
