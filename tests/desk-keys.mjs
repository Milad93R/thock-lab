import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/desk/keys.ts'],
  format: 'esm',
  bundle: true,
  write: false,
});
const { deskTouch, createDeskKeys } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const midpoint = () => 0.5;
assert.notDeepEqual(deskTouch('KeyA', midpoint), deskTouch('KeyB', midpoint));
assert.notDeepEqual(deskTouch('KeyA', () => 0), deskTouch('KeyA', () => 1));
for (const key of ['Space', 'Enter', 'NumpadEnter', 'Backspace', 'ShiftLeft', 'ShiftRight']) {
  assert(deskTouch(key, midpoint).rate < deskTouch('KeyA', midpoint).rate, key);
  assert(deskTouch(key, midpoint).gain > 1, key);
}
assert(deskTouch('Space', midpoint).rate < deskTouch('Enter', midpoint).rate);
assert(deskTouch('Enter', midpoint).rate < deskTouch('Backspace', midpoint).rate);
for (const code of ['F15', 'MediaPlayPause', 'IntlBackslash', 'ArrowDown', 'KeyZ']) {
  for (const random of [() => 0, () => 1]) {
    const { rate, gain } = deskTouch(code, random);
    assert(rate > 0.96 && rate < 1.04, code);
    assert(gain >= 0.94 && gain <= 1.08, code);
  }
}

const calls = [];
const keys = createDeskKeys((code) => {
  calls.push(['down', code]);
  return (released) => calls.push([released ? 'up' : 'cancel', code]);
});
const event = (code, key = code, options = {}) => ({ code, key, location: 0, repeat: false, ...options });
keys.down(event('KeyA', 'q'));
keys.down(event('KeyA', 'Q', { repeat: true }));
keys.down(event('KeyA', 'Q'));
keys.down(event('ShiftRight', 'Shift', { location: 2 }));
keys.up(event('KeyA', 'Q'));
keys.up(event('KeyA', 'Q'));
keys.clear();
keys.up(event('ShiftRight', 'Shift', { location: 2 }));
keys.down(event('KeyA', 'q', { repeat: true }));
keys.down(event('KeyA', 'q'));
keys.up(event('KeyA', 'q'));
keys.down(event('', 'Enter', { location: 3 }));
keys.up(event('', 'Enter', { location: 3 }));
keys.down(event('', ' ', { location: 0 }));
keys.up(event('Space', ' '));
keys.down(event('MediaPlayPause'));
keys.up(event('MediaPlayPause'));
assert.deepEqual(calls, [
  ['down', 'KeyA'], ['down', 'ShiftRight'], ['up', 'KeyA'], ['cancel', 'ShiftRight'],
  ['down', 'KeyA'], ['up', 'KeyA'], ['down', 'NumpadEnter'], ['up', 'NumpadEnter'],
  ['down', 'Space'], ['up', 'Space'], ['down', 'MediaPlayPause'], ['up', 'MediaPlayPause'],
]);
console.log('Desk keys PASS (physical codes, per-key acoustics, chords, repeat and lost release)');
