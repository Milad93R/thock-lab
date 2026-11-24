interface PhysicalKey {
  code: string;
  key: string;
  location: number;
}

function keyId({ code, key, location }: PhysicalKey): string {
  if (code && code !== 'Unidentified') return code;
  const side = location === 2 ? 'Right' : 'Left';
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return key + side;
  if (key === ' ') return 'Space';
  if (key === 'Enter' && location === 3) return 'NumpadEnter';
  if (location === 3 && /^[0-9]$/.test(key)) return 'Numpad' + key;
  if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return 'Digit' + key;
  return key;
}

export function deskTouch(code: string, random = Math.random): { rate: number; gain: number } {
  let hash = 0;
  for (const character of code) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;

  let rate = 1;
  let gain = 1;
  switch (code) {
    case 'Space': rate = 0.82; gain = 1.15; break;
    case 'Enter':
    case 'NumpadEnter': rate = 0.89; gain = 1.11; break;
    case 'Backspace': rate = 0.93; gain = 1.08; break;
    case 'ShiftLeft':
    case 'ShiftRight': rate = 0.95; gain = 1.04; break;
  }
  return {
    rate: rate * (0.977 + (hash % 47) / 1000 + (random() - 0.5) * 0.024),
    gain: gain * (0.94 + ((hash >>> 7) % 61) / 1000 + random() * 0.06),
  };
}

type FinishStroke = (released: boolean) => void;

/** A stroke owns its original sound until keyup. Clearing handles lost keyup on tab switches. */
export function createDeskKeys(start: (code: string) => FinishStroke) {
  const held = new Map<string, FinishStroke>();
  return {
    down(event: PhysicalKey & { repeat: boolean }) {
      const code = keyId(event);
      if (!code || event.repeat || held.has(code)) return;
      held.set(code, start(code));
    },
    up(event: PhysicalKey) {
      const code = keyId(event);
      const finish = held.get(code);
      if (held.delete(code)) finish?.(true);
    },
    clear() {
      for (const finish of held.values()) finish(false);
      held.clear();
    },
  };
}
