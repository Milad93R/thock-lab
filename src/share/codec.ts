import {
  BaseMaterial,
  CharmType,
  ClickerBuild,
  DEFAULT_BUILD,
  getDailyVariant,
  resolveLegacyDaily,
  KeycapFinish,
  KeycapShape,
  SwitchType,
} from '../types/build';

function reverseCodes<T extends string>(codes: Record<T, string>): Map<string, T> {
  return new Map(Object.entries<string>(codes).map(([key, code]) => [code, key as T]));
}

function ownKey<T extends string>(codes: Record<T, string>, value: unknown): value is T {
  return typeof value === 'string' && Object.hasOwn(codes, value);
}

const SWITCH_TO_CODE: Record<SwitchType, string> = {
  clicky: 'ck',
  tactile: 'tc',
  linear: 'ln',
  thock: 'th',
  bubble: 'bb',
  arcade: 'ar',
};

const CODE_TO_SWITCH = reverseCodes(SWITCH_TO_CODE);

const SHAPE_TO_CODE: Record<KeycapShape, string> = {
  square: 'sq',
  round: 'rd',
  'low-profile': 'lp',
  'tall-artisan': 'ta',
  pill: 'pl',
};

const CODE_TO_SHAPE = reverseCodes(SHAPE_TO_CODE);

const FINISH_TO_CODE: Record<KeycapFinish, string> = {
  matte: 'mt',
  glossy: 'gl',
  frosted: 'fr',
  metallic: 'me',
  glow: 'gw',
};

const CODE_TO_FINISH = reverseCodes(FINISH_TO_CODE);

const BASE_TO_CODE: Record<BaseMaterial, string> = {
  wood: 'wd',
  acrylic: 'ac',
  aluminum: 'al',
  plastic: 'ps',
};

const CODE_TO_BASE = reverseCodes(BASE_TO_CODE);

const CHARM_TO_CODE: Record<CharmType, string> = {
  star: 'st',
  cherry: 'ch',
  cloud: 'cl',
  ghost: 'gh',
  mushroom: 'mu',
  cat: 'ct',
  dice: 'dc',
};

const CODE_TO_CHARM = reverseCodes(CHARM_TO_CODE);

const HEX_RE = /^[0-9A-Fa-f]{6}$/;

/**
 * Encodes a ClickerBuild into a compact deterministic URL hash fragment.
 * Version 1 retains standard links. Version 2 stores the daily recipe ID in field 3.
 */
export function encodeBuildToHash(build: ClickerBuild): string {
  const hex = build.keycapColor.replace('#', '').toUpperCase();
  const safeHex = HEX_RE.test(hex) ? hex : 'E85D3F';
  const parts = [
    build.dailyVariantId ? '2' : '1',
    SWITCH_TO_CODE[build.switchType],
    build.dailyVariantId ?? '0',
    SHAPE_TO_CODE[build.keycapShape] ?? 'sq',
    safeHex,
    FINISH_TO_CODE[build.keycapFinish] ?? 'mt',
    BASE_TO_CODE[build.baseMaterial] ?? 'wd',
    CHARM_TO_CODE[build.charm] ?? 'ct',
  ];
  return `#b=${parts.join('.')}`;
}

export type ShareHashResult =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; build: ClickerBuild };

/**
 * Parses a URL hash and reports whether it carried no share code, a broken one
 * (truncated / malformed percent-encoding / unknown codes), or a valid build.
 * Never throws.
 */
export function parseShareHash(hash: string | null | undefined): ShareHashResult {
  if (typeof hash !== 'string' || hash.length === 0) return { status: 'none' };
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!/(?:^|&)b(?:=|&|$)/.test(cleaned)) return { status: 'none' };
  const build = decodeBuildFromHash(hash);
  return build ? { status: 'ok', build } : { status: 'invalid' };
}

/**
 * Decodes a URL hash fragment back into a ClickerBuild.
 * Returns null if the hash does not contain a valid build. Never throws.
 */
export function decodeBuildFromHash(hash: string): ClickerBuild | null {
  if (typeof hash !== 'string' || !hash || hash.length > 512) return null;
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  const fields = cleaned.split('&').filter((field) => field === 'b' || field.startsWith('b='));
  if (fields.length !== 1 || fields[0].length <= 2) return null;

  let raw: string;
  try {
    raw = decodeURIComponent(fields[0].slice(2));
  } catch {
    return null;
  }
  const parts = raw.split('.');
  if (parts.length !== 8) return null;
  const [version, , dailyCode] = parts;

  const switchType = CODE_TO_SWITCH.get(parts[1]);
  const keycapShape = CODE_TO_SHAPE.get(parts[3]);
  const hexRaw = parts[4];
  const keycapFinish = CODE_TO_FINISH.get(parts[5]);
  const baseMaterial = CODE_TO_BASE.get(parts[6]);
  const charm = CODE_TO_CHARM.get(parts[7]);

  if (
    !switchType ||
    !keycapShape ||
    !HEX_RE.test(hexRaw) ||
    !keycapFinish ||
    !baseMaterial ||
    !charm
  ) {
    return null;
  }

  let dailyVariantId: ClickerBuild['dailyVariantId'] = null;
  if (version === '1' && (dailyCode === '0' || dailyCode === '1')) {
    if (dailyCode === '1') dailyVariantId = resolveLegacyDaily(switchType);
  } else if (version === '2') {
    const recipe = getDailyVariant(dailyCode);
    if (!recipe || recipe.baseSwitch !== switchType) return null;
    dailyVariantId = recipe.id;
  } else {
    return null;
  }

  return {
    switchType,
    dailyVariantId,
    keycapShape,
    keycapColor: `#${hexRaw.toUpperCase()}`,
    keycapFinish,
    baseMaterial,
    charm,
  };
}

export function buildShareUrl(build: ClickerBuild, originHref?: string): string {
  const base = (originHref ?? 'https://thock.algoty.com/').split(/[?#]/)[0];
  return `${base}${encodeBuildToHash(build)}`;
}

export function sanitizeBuild(value: unknown, savedName?: string): ClickerBuild {
  if (!value || typeof value !== 'object') return { ...DEFAULT_BUILD };
  const input = value as Partial<ClickerBuild> & { useDailyVariant?: unknown };
  const hex = typeof input.keycapColor === 'string' ? input.keycapColor.replace(/^#/, '') : '';
  const switchType = ownKey(SWITCH_TO_CODE, input.switchType) ? input.switchType : DEFAULT_BUILD.switchType;
  const recipe = getDailyVariant(input.dailyVariantId);
  const dailyVariantId = recipe?.baseSwitch === switchType
    ? recipe.id
    : input.dailyVariantId === undefined && input.useDailyVariant === true && ownKey(SWITCH_TO_CODE, input.switchType)
      ? resolveLegacyDaily(switchType, savedName)
      : null;

  return {
    switchType,
    dailyVariantId,
    keycapShape: ownKey(SHAPE_TO_CODE, input.keycapShape) ? input.keycapShape : DEFAULT_BUILD.keycapShape,
    keycapColor: HEX_RE.test(hex) ? `#${hex.toUpperCase()}` : DEFAULT_BUILD.keycapColor,
    keycapFinish: ownKey(FINISH_TO_CODE, input.keycapFinish) ? input.keycapFinish : DEFAULT_BUILD.keycapFinish,
    baseMaterial: ownKey(BASE_TO_CODE, input.baseMaterial) ? input.baseMaterial : DEFAULT_BUILD.baseMaterial,
    charm: ownKey(CHARM_TO_CODE, input.charm) ? input.charm : DEFAULT_BUILD.charm,
  };
}
