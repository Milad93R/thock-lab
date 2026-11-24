export type SwitchType =
  | 'clicky'
  | 'tactile'
  | 'linear'
  | 'thock'
  | 'bubble'
  | 'arcade';

export type KeycapShape =
  | 'square'
  | 'round'
  | 'low-profile'
  | 'tall-artisan'
  | 'pill';

export type KeycapFinish =
  | 'matte'
  | 'glossy'
  | 'frosted'
  | 'metallic'
  | 'glow';

export type BaseMaterial = 'wood' | 'acrylic' | 'aluminum' | 'plastic';

export type CharmType =
  | 'star'
  | 'cherry'
  | 'cloud'
  | 'ghost'
  | 'mushroom'
  | 'cat'
  | 'dice';

export interface ClickerBuild {
  switchType: SwitchType;
  dailyVariantId: DailyVariantId | null;
  keycapShape: KeycapShape;
  keycapColor: string;
  keycapFinish: KeycapFinish;
  baseMaterial: BaseMaterial;
  charm: CharmType;
}

export interface SwitchSpec {
  id: SwitchType;
  name: string;
  shortName: string;
  tagline: string;
  character: string;
  stemColor: string;
  travelMm: number;
  /** Visual downward travel in 3D scene units */
  travelUnits: number;
  /** Spring stiffness for return motion */
  stiffness: number;
  /** Spring damping for return motion */
  damping: number;
  /** Tactile bump resistance (0..1) */
  bump: number;
  /** Visual overshoot factor on release */
  reboundKick: number;
}

export interface DailySwitchVariant {
  id: string;
  name: string;
  subtitle: string;
  baseSwitch: SwitchType;
  accentColor: string;
  /** Acoustic recipe tweaks */
  pitchMult: number;
  bodyFreqMult: number;
  clickBrightMult: number;
  resonanceBoost: number;
  tailMult: number;
}

export interface ColorSwatch {
  hex: string;
  name: string;
  backdropHue: string;
}

export const COLOR_PALETTE: ColorSwatch[] = [
  { hex: '#E85D3F', name: 'Vermilion Pop', backdropHue: '#F8EBE4' },
  { hex: '#F4EAE0', name: 'Oat Milk', backdropHue: '#F5EFE8' },
  { hex: '#7FA989', name: 'Matcha Cream', backdropHue: '#ECF3ED' },
  { hex: '#F2A7B3', name: 'Sakura Blush', backdropHue: '#F9ECEF' },
  { hex: '#4B7BF5', name: 'Cobalt Studio', backdropHue: '#EBF0FA' },
  { hex: '#F5C451', name: 'Buttercup', backdropHue: '#FBF4E3' },
  { hex: '#A996E8', name: 'Lavender Mist', backdropHue: '#F1EEFA' },
  { hex: '#2D2926', name: 'Espresso Noir', backdropHue: '#ECE7E2' },
  { hex: '#6CC7B8', name: 'Mint Gelato', backdropHue: '#E9F5F3' },
  { hex: '#F08C55', name: 'Apricot Fizz', backdropHue: '#FAEFE6' },
  { hex: '#88BCE8', name: 'Porcelain Sky', backdropHue: '#EAF2F9' },
  { hex: '#C65D8C', name: 'Berry Glaze', backdropHue: '#F6EAF0' },
];

export const SWITCH_CATALOG: SwitchSpec[] = [
  {
    id: 'thock',
    name: 'Deep Thock',
    shortName: 'Thock',
    tagline: 'Creamy · Resonant · Marbly',
    character: 'Lubed POM stem, lush low-mid resonance',
    stemColor: '#5B4573',
    travelMm: 4.0,
    travelUnits: 0.29,
    stiffness: 300,
    damping: 22,
    bump: 0.15,
    reboundKick: 1.0,
  },
  {
    id: 'clicky',
    name: 'Clicky',
    shortName: 'Clicky',
    tagline: 'Crisp · Snappy · Bright',
    character: 'Click-jacket snap with sharp metallic ping',
    stemColor: '#2B8BE6',
    travelMm: 3.6,
    travelUnits: 0.26,
    stiffness: 420,
    damping: 23,
    bump: 0.65,
    reboundKick: 1.25,
  },
  {
    id: 'tactile',
    name: 'Tactile',
    shortName: 'Tactile',
    tagline: 'Rounded · Punchy · Balanced',
    character: 'Defined mid-stroke bump, solid bottom-out',
    stemColor: '#B56235',
    travelMm: 3.8,
    travelUnits: 0.27,
    stiffness: 360,
    damping: 24,
    bump: 0.5,
    reboundKick: 1.05,
  },
  {
    id: 'linear',
    name: 'Linear',
    shortName: 'Linear',
    tagline: 'Silky · Smooth · Muted',
    character: 'Zero bump glide with hushed velvety thud',
    stemColor: '#E04D4D',
    travelMm: 4.0,
    travelUnits: 0.28,
    stiffness: 290,
    damping: 26,
    bump: 0.0,
    reboundKick: 0.85,
  },
  {
    id: 'bubble',
    name: 'Bubble Pop',
    shortName: 'Bubble',
    tagline: 'Playful · Juicy · Bouncy',
    character: 'Pitch-swept acoustic pop with springy bounce',
    stemColor: '#36B8B0',
    travelMm: 3.4,
    travelUnits: 0.25,
    stiffness: 350,
    damping: 17,
    bump: 0.35,
    reboundKick: 1.4,
  },
  {
    id: 'arcade',
    name: 'Retro Arcade',
    shortName: 'Arcade',
    tagline: 'Fast · Hollow · Microswitch',
    character: 'Short-throw Sanwa leaf snap & cabinet clack',
    stemColor: '#E8A825',
    travelMm: 2.6,
    travelUnits: 0.19,
    stiffness: 560,
    damping: 28,
    bump: 0.45,
    reboundKick: 1.35,
  },
];

export const SWITCH_MAP: Record<SwitchType, SwitchSpec> = Object.fromEntries(
  SWITCH_CATALOG.map((s) => [s.id, s])
) as Record<SwitchType, SwitchSpec>;

export const KEYCAP_SHAPES: {
  id: KeycapShape;
  name: string;
  desc: string;
}[] = [
  { id: 'square', name: 'Square', desc: 'Sculpted Cherry scoop' },
  { id: 'round', name: 'Round', desc: 'Vintage typewriter dish' },
  { id: 'low-profile', name: 'Low Profile', desc: 'Sleek slim Choc bevel' },
  { id: 'tall-artisan', name: 'Tall Artisan', desc: 'Domed collector crown' },
  { id: 'pill', name: 'Pill', desc: 'Chunky rounded stadium' },
];

export const KEYCAP_FINISHES: {
  id: KeycapFinish;
  name: string;
  desc: string;
}[] = [
  { id: 'matte', name: 'Matte', desc: 'Velvety PBT' },
  { id: 'glossy', name: 'Glossy', desc: 'Piano lacquer' },
  { id: 'frosted', name: 'Frosted Glass', desc: 'Translucent mist' },
  { id: 'metallic', name: 'Metallic', desc: 'CNC anodized' },
  { id: 'glow', name: 'Glow', desc: 'Luminous neon' },
];

export const BASE_MATERIALS: {
  id: BaseMaterial;
  name: string;
  short: string;
  tone: string;
  swatch: string;
}[] = [
  { id: 'wood', name: 'Walnut Wood', short: 'Walnut', tone: 'Warmer, rounder resonance', swatch: '#8A5B3C' },
  { id: 'acrylic', name: 'Frosted Acrylic', short: 'Acrylic', tone: 'Hollow, poppy cavity', swatch: '#DCE8F2' },
  { id: 'aluminum', name: 'CNC Aluminum', short: 'Aluminum', tone: 'Brighter, crisper ping', swatch: '#C9CDD4' },
  { id: 'plastic', name: 'Pastel Plastic', short: 'Pastel ABS', tone: 'Balanced, snappy', swatch: '#F0DDD5' },
];

export const CHARM_CATALOG: {
  id: CharmType;
  name: string;
  swatch: string;
}[] = [
  { id: 'star', name: 'Star', swatch: '#F6C744' },
  { id: 'cherry', name: 'Cherry', swatch: '#DF3D52' },
  { id: 'cloud', name: 'Cloud', swatch: '#DCEBFF' },
  { id: 'ghost', name: 'Ghost', swatch: '#F5F3FB' },
  { id: 'mushroom', name: 'Mushroom', swatch: '#E24B3B' },
  { id: 'cat', name: 'Cat', swatch: '#F2B880' },
  { id: 'dice', name: 'Dice', swatch: '#F7F4EE' },
];

export const DAILY_VARIANTS = [
  {
    id: 'honeycomb-thock',
    name: 'Honeycomb Thock',
    subtitle: 'Extra-deep honeyed resonance',
    baseSwitch: 'thock',
    accentColor: '#D98A1E',
    pitchMult: 0.88,
    bodyFreqMult: 0.84,
    clickBrightMult: 0.82,
    resonanceBoost: 3.2,
    tailMult: 1.18,
  },
  {
    id: 'bamboo-click',
    name: 'Bamboo Click',
    subtitle: 'Dry woody snap & crisp tick',
    baseSwitch: 'clicky',
    accentColor: '#4E9A68',
    pitchMult: 1.06,
    bodyFreqMult: 1.12,
    clickBrightMult: 0.92,
    resonanceBoost: 2.5,
    tailMult: 0.9,
  },
  {
    id: 'marble-pop',
    name: 'Glass Marble',
    subtitle: 'Sparkling crystalline pop',
    baseSwitch: 'bubble',
    accentColor: '#3C9DC9',
    pitchMult: 1.14,
    bodyFreqMult: 1.18,
    clickBrightMult: 1.25,
    resonanceBoost: 2.8,
    tailMult: 1.05,
  },
  {
    id: 'brass-tactile',
    name: 'Brass Plate Tactile',
    subtitle: 'Crisp studio punch with shimmer',
    baseSwitch: 'tactile',
    accentColor: '#C9963B',
    pitchMult: 1.08,
    bodyFreqMult: 0.96,
    clickBrightMult: 1.3,
    resonanceBoost: 2.4,
    tailMult: 1.0,
  },
  {
    id: 'cream-linear',
    name: 'Cream Soda Linear',
    subtitle: 'Ultra-silky creamy thump',
    baseSwitch: 'linear',
    accentColor: '#D8738E',
    pitchMult: 0.92,
    bodyFreqMult: 0.88,
    clickBrightMult: 0.85,
    resonanceBoost: 3.0,
    tailMult: 1.15,
  },
  {
    id: 'neo-arcade',
    name: 'Neo-Geo Micro',
    subtitle: 'Turbo arcade cabinet clack',
    baseSwitch: 'arcade',
    accentColor: '#E05A47',
    pitchMult: 1.12,
    bodyFreqMult: 1.08,
    clickBrightMult: 1.2,
    resonanceBoost: 2.2,
    tailMult: 0.86,
  },
  {
    id: 'velvet-thock',
    name: 'Velvet Raindrop',
    subtitle: 'Soft muted sub-bass thock',
    baseSwitch: 'thock',
    accentColor: '#6D68B8',
    pitchMult: 0.94,
    bodyFreqMult: 0.9,
    clickBrightMult: 0.78,
    resonanceBoost: 3.5,
    tailMult: 1.22,
  },
] as const satisfies readonly DailySwitchVariant[];

export type DailyVariantId = typeof DAILY_VARIANTS[number]['id'];

export function getDailyVariant(id: unknown) {
  return DAILY_VARIANTS.find((variant) => variant.id === id);
}

export function resolveLegacyDaily(switchType: SwitchType, savedName?: string): DailyVariantId | null {
  const saved = DAILY_VARIANTS.find((variant) =>
    variant.baseSwitch === switchType && savedName?.endsWith(` · ${variant.name}`)
  );
  return (saved ?? DAILY_VARIANTS.find((variant) => variant.baseSwitch === switchType))?.id ?? null;
}

export function getDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getSwitchOfTheDay(date: Date = new Date()): DailySwitchVariant & { id: DailyVariantId; dateKey: string } {
  const dateKey = getDateKey(date);
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const idx = Math.abs(hash) % DAILY_VARIANTS.length;
  return {
    ...DAILY_VARIANTS[idx],
    dateKey,
  };
}

export const DEFAULT_BUILD: ClickerBuild = {
  switchType: 'thock',
  dailyVariantId: null,
  keycapShape: 'square',
  keycapColor: '#E85D3F',
  keycapFinish: 'matte',
  baseMaterial: 'wood',
  charm: 'cat',
};

const CURATED_COMBOS: ClickerBuild[] = [
  {
    switchType: 'thock',
    dailyVariantId: null,
    keycapShape: 'square',
    keycapColor: '#E85D3F',
    keycapFinish: 'matte',
    baseMaterial: 'wood',
    charm: 'cat',
  },
  {
    switchType: 'bubble',
    dailyVariantId: null,
    keycapShape: 'round',
    keycapColor: '#6CC7B8',
    keycapFinish: 'glossy',
    baseMaterial: 'acrylic',
    charm: 'cloud',
  },
  {
    switchType: 'clicky',
    dailyVariantId: null,
    keycapShape: 'low-profile',
    keycapColor: '#4B7BF5',
    keycapFinish: 'metallic',
    baseMaterial: 'aluminum',
    charm: 'star',
  },
  {
    switchType: 'tactile',
    dailyVariantId: null,
    keycapShape: 'tall-artisan',
    keycapColor: '#A996E8',
    keycapFinish: 'frosted',
    baseMaterial: 'acrylic',
    charm: 'ghost',
  },
  {
    switchType: 'arcade',
    dailyVariantId: null,
    keycapShape: 'pill',
    keycapColor: '#F5C451',
    keycapFinish: 'glossy',
    baseMaterial: 'plastic',
    charm: 'dice',
  },
  {
    switchType: 'linear',
    dailyVariantId: null,
    keycapShape: 'square',
    keycapColor: '#7FA989',
    keycapFinish: 'matte',
    baseMaterial: 'wood',
    charm: 'mushroom',
  },
  {
    switchType: 'thock',
    dailyVariantId: null,
    keycapShape: 'tall-artisan',
    keycapColor: '#F2A7B3',
    keycapFinish: 'glow',
    baseMaterial: 'plastic',
    charm: 'cherry',
  },
  {
    switchType: 'clicky',
    dailyVariantId: null,
    keycapShape: 'round',
    keycapColor: '#2D2926',
    keycapFinish: 'metallic',
    baseMaterial: 'aluminum',
    charm: 'dice',
  },
];

export function randomizeCuratedBuild(current: ClickerBuild, daily: Pick<DailySwitchVariant, 'baseSwitch'> & { id: DailyVariantId }): ClickerBuild {
  // 50% chance pick a hand-curated look with a fresh charm/switch twist, 50% procedural harmonious combo
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  for (let attempt = 0; attempt < 6; attempt++) {
    let candidate: ClickerBuild;
    if (Math.random() < 0.45) {
      const base = pick(CURATED_COMBOS);
      const useDailyVariant = Math.random() < 0.18;
      candidate = {
        ...base,
        switchType: useDailyVariant ? daily.baseSwitch : base.switchType,
        charm: pick(CHARM_CATALOG).id,
        dailyVariantId: useDailyVariant ? daily.id : null,
      };
    } else {
      const baseMaterial = pick(BASE_MATERIALS).id;
      const finishPool: KeycapFinish[] =
        baseMaterial === 'aluminum'
          ? ['metallic', 'matte', 'frosted', 'glossy']
          : baseMaterial === 'acrylic'
            ? ['frosted', 'glossy', 'glow', 'matte']
            : ['matte', 'glossy', 'frosted', 'glow', 'metallic'];

      const colorPool = COLOR_PALETTE.filter((c) => {
        if (baseMaterial === 'wood' && c.hex === '#2D2926') return false;
        if (baseMaterial === 'plastic' && c.hex === '#F4EAE0') return false;
        return true;
      });

      const useDailyVariant = Math.random() < 0.16;
      const switchType = useDailyVariant
        ? daily.baseSwitch
        : pick(SWITCH_CATALOG).id;

      candidate = {
        switchType,
        dailyVariantId: useDailyVariant ? daily.id : null,
        keycapShape: pick(KEYCAP_SHAPES).id,
        keycapColor: pick(colorPool).hex,
        keycapFinish: pick(finishPool),
        baseMaterial,
        charm: pick(CHARM_CATALOG).id,
      };
    }

    if (
      candidate.keycapColor !== current.keycapColor ||
      candidate.keycapShape !== current.keycapShape ||
      candidate.baseMaterial !== current.baseMaterial
    ) {
      return candidate;
    }
  }
  return pick(CURATED_COMBOS);
}

export function getColorName(hex: string): string {
  return (
    COLOR_PALETTE.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex.toUpperCase()
  );
}

export function getSwitchLabel(build: ClickerBuild): string {
  return getDailyVariant(build.dailyVariantId)?.name ?? SWITCH_MAP[build.switchType].name;
}

export function getBuildLabel(build: ClickerBuild): string {
  const sw = getSwitchLabel(build);
  const colorName =
    COLOR_PALETTE.find(
      (c) => c.hex.toLowerCase() === build.keycapColor.toLowerCase()
    )?.name ?? build.keycapColor.toUpperCase();
  return `${colorName} · ${sw}`;
}

export function getBackdropTint(keycapColor: string): string {
  const match = COLOR_PALETTE.find(
    (c) => c.hex.toLowerCase() === keycapColor.toLowerCase()
  );
  return match?.backdropHue ?? '#F5EDE6';
}

export function getBackdropHighlight(base: BaseMaterial): string {
  return base === 'acrylic' ? '#EFE5DE' : '#FFFDF9';
}
