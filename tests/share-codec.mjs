import assert from 'node:assert/strict';
import { build as bundle } from 'esbuild';

// Bundle the production TypeScript decoder without starting a server or browser.
const { outputFiles } = await bundle({
  stdin: {
    contents: "export * from './src/share/codec'; export * from './src/types/build';",
    resolveDir: process.cwd(),
  },
  format: 'esm',
  bundle: true,
  write: false,
});
const {
  DAILY_VARIANTS, DEFAULT_BUILD, decodeBuildFromHash, encodeBuildToHash, parseShareHash, sanitizeBuild,
} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const valid = encodeBuildToHash(DEFAULT_BUILD);
const fields = valid.slice(3).split('.');
assert.deepEqual(decodeBuildFromHash(valid), DEFAULT_BUILD);
assert.deepEqual(parseShareHash('#section'), { status: 'none' });
for (const bad of ['#b', '#b=', '#b=%C0%AF', '#b=%ED%A0%80', '#b=%00', `${valid}&b=`, `#b=&${valid.slice(1)}`, `${valid}&${valid.slice(1)}`]) {
  assert.deepEqual(parseShareHash(bad), { status: 'invalid' }, bad);
}

for (const recipe of DAILY_VARIANTS) {
  const build = { ...DEFAULT_BUILD, switchType: recipe.baseSwitch, dailyVariantId: recipe.id };
  const encoded = encodeBuildToHash(build);
  assert.match(encoded, /^#b=2\./);
  assert.deepEqual(decodeBuildFromHash(encoded), build);
  assert.deepEqual(sanitizeBuild(build), build);
  const incompatible = encoded.split('.');
  incompatible[1] = recipe.baseSwitch === 'thock' ? 'ln' : 'th';
  assert.equal(decodeBuildFromHash(incompatible.join('.')), null);
}
assert.equal(decodeBuildFromHash('#b=1.th.1.sq.E85D3F.mt.wd.ct').dailyVariantId, 'honeycomb-thock');
assert.equal(sanitizeBuild({ switchType: 'thock', useDailyVariant: true }, 'Vermilion Pop · Velvet Raindrop').dailyVariantId, 'velvet-thock');
assert.equal(sanitizeBuild({ switchType: 'thock', useDailyVariant: 'true' }).dailyVariantId, null);

const poison = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'prototype', '%', '%E0%A4%A', '%00', '.', '&', '🚀'];
for (const value of poison) {
  for (let i = 0; i < fields.length; i++) {
    const mutated = [...fields];
    mutated[i] = value;
    assert.equal(decodeBuildFromHash(`#b=${mutated.join('.')}`), null);
  }
  const stored = Object.fromEntries(Object.keys(DEFAULT_BUILD).map((key) => [key, value]));
  assert.deepEqual(sanitizeBuild(stored), DEFAULT_BUILD);
}

let seed = 0xc0ffee;
function random(max) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % max;
}
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz%&._=+#ABCDEF\ud800\udc00\x00\u00a0';
for (let i = 0; i < 20000; i++) {
  const noise = Array.from({ length: random(i % 7 === 0 ? 600 : 24) }, () => alphabet[random(alphabet.length)]).join('');
  const mutated = [...fields];
  mutated[random(fields.length)] = noise;
  for (const hash of [`#b=${noise}`, `#b=${mutated.join('.')}`]) {
    const decoded = decodeBuildFromHash(hash);
    const parsed = parseShareHash(hash);
    assert.equal(parsed.status, decoded ? 'ok' : 'invalid');
    if (decoded) assert.deepEqual(decodeBuildFromHash(encodeBuildToHash(decoded)), decoded);
  }
}

console.log('Share codec PASS (40,000 seeded fuzz cases plus field attacks and daily migrations)');
