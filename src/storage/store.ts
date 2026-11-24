import { ClickerBuild, DEFAULT_BUILD, SwitchType } from '../types/build';
import { sanitizeBuild } from '../share/codec';

export const MAX_SHELF_SLOTS = 12;

export type AchievementId =
  | 'clicks-100'
  | 'clicks-1000'
  | 'clicks-10000'
  | 'all-switches'
  | 'save-5-builds';

export interface AchievementDef {
  id: AchievementId;
  title: string;
  description: string;
  target: number;
  icon: 'spark' | 'flame' | 'crown' | 'layers' | 'bookmark';
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'clicks-100',
    title: 'Warming Up',
    description: 'Reach 100 total clicks',
    target: 100,
    icon: 'spark',
  },
  {
    id: 'clicks-1000',
    title: 'Thock Addict',
    description: 'Reach 1,000 total clicks',
    target: 1000,
    icon: 'flame',
  },
  {
    id: 'clicks-10000',
    title: 'Mechanical Legend',
    description: 'Reach 10,000 total clicks',
    target: 10000,
    icon: 'crown',
  },
  {
    id: 'all-switches',
    title: 'Switch Connoisseur',
    description: 'Click all 6 switch types',
    target: 6,
    icon: 'layers',
  },
  {
    id: 'save-5-builds',
    title: 'Studio Curator',
    description: 'Save 5 builds to your Shelf',
    target: 5,
    icon: 'bookmark',
  },
];

export interface SavedBuild {
  slot: number;
  id: string;
  name: string;
  build: ClickerBuild;
  thumbnail: string;
  createdAt: number;
}

export interface UserSettings {
  volume: number; // 0..1
  muted: boolean;
  reducedMotion: boolean;
  haptics: boolean;
}

export interface UserStats {
  totalClicks: number;
  bestCombo: number;
  switchesTried: SwitchType[];
  unlockedAchievements: AchievementId[];
  maxSavedCount: number;
}

export interface PersistedState {
  currentBuild: ClickerBuild;
  shelf: SavedBuild[];
  stats: UserStats;
  settings: UserSettings;
  hintsDismissed: boolean;
}

export const STORAGE_KEY = 'thock-lab:v1';

function detectSystemReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createDefaultState(): PersistedState {
  return {
    currentBuild: { ...DEFAULT_BUILD },
    shelf: [],
    stats: {
      totalClicks: 0,
      bestCombo: 0,
      switchesTried: [],
      unlockedAchievements: [],
      maxSavedCount: 0,
    },
    settings: {
      volume: 0.85,
      muted: false,
      reducedMotion: detectSystemReducedMotion(),
      haptics: true,
    },
    hintsDismissed: false,
  };
}

export function loadPersistedState(): PersistedState {
  const defaults = createDefaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;

    const slots = new Map<number, SavedBuild>();
    if (Array.isArray(parsed.shelf)) {
      parsed.shelf.slice(0, MAX_SHELF_SLOTS).forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        // Existing shelves used the array order as the slot order.
        const slot = Number.isInteger(item.slot) && item.slot >= 1 && item.slot <= MAX_SHELF_SLOTS
          ? item.slot
          : index + 1;
        const createdAt = Number.isFinite(item.createdAt) ? item.createdAt : 0;
        if ((slots.get(slot)?.createdAt ?? -Infinity) > createdAt) return;
        slots.set(slot, {
          slot,
          id: typeof item.id === 'string' ? item.id : `slot-${slot}`,
          name: typeof item.name === 'string' ? item.name.slice(0, 48) : 'Custom Clicker',
          build: sanitizeBuild(item.build, typeof item.name === 'string' ? item.name : undefined),
          thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : '',
          createdAt,
        });
      });
    }
    const shelf = [...slots.values()].sort((a, b) => a.slot - b.slot);

    const storedVolume = parsed.settings?.volume;
    const volume = typeof storedVolume === 'number' && Number.isFinite(storedVolume)
      ? Math.max(0, Math.min(1, storedVolume))
      : defaults.settings.volume;

    const validSwitches = new Set<SwitchType>([
      'clicky',
      'tactile',
      'linear',
      'thock',
      'bubble',
      'arcade',
    ]);

    const switchesTried = Array.isArray(parsed.stats?.switchesTried)
      ? parsed.stats.switchesTried.filter((s): s is SwitchType =>
          validSwitches.has(s)
        )
      : [];

    const validAch = new Set<AchievementId>(ACHIEVEMENTS.map((a) => a.id));
    const unlockedAchievements = Array.isArray(parsed.stats?.unlockedAchievements)
      ? parsed.stats.unlockedAchievements.filter((a): a is AchievementId =>
          validAch.has(a)
        )
      : [];

    return {
      currentBuild: sanitizeBuild(parsed.currentBuild),
      shelf,
      stats: {
        totalClicks:
          typeof parsed.stats?.totalClicks === 'number' &&
          parsed.stats.totalClicks >= 0
            ? Math.floor(parsed.stats.totalClicks)
            : 0,
        bestCombo:
          typeof parsed.stats?.bestCombo === 'number' &&
          parsed.stats.bestCombo >= 0
            ? Math.floor(parsed.stats.bestCombo)
            : 0,
        switchesTried,
        unlockedAchievements,
        maxSavedCount: Math.max(
          shelf.length,
          typeof parsed.stats?.maxSavedCount === 'number'
            ? parsed.stats.maxSavedCount
            : 0
        ),
      },
      settings: {
        volume: volume || defaults.settings.volume,
        muted: volume === 0 || parsed.settings?.muted === true,
        reducedMotion:
          typeof parsed.settings?.reducedMotion === 'boolean'
            ? parsed.settings.reducedMotion
            : defaults.settings.reducedMotion,
        haptics:
          typeof parsed.settings?.haptics === 'boolean'
            ? parsed.settings.haptics
            : defaults.settings.haptics,
      },
      hintsDismissed: Boolean(parsed.hintsDismissed),
    };
  } catch {
    return defaults;
  }
}

function savePersistedState(state: PersistedState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Quota exceeded or storage blocked — attempt saving without oldest thumbnail
    try {
      const trimmed: PersistedState = {
        ...state,
        shelf: state.shelf.map((item, idx) =>
          idx >= 6 ? { ...item, thumbnail: '' } : item
        ),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return true;
    } catch {
      return false;
    }
  }
}

let unsavedState: PersistedState | undefined;
let lockDatabase: Promise<IDBDatabase> | undefined;

function openLockDatabase(): Promise<IDBDatabase> {
  return lockDatabase ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('thock-lab:transactions', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('lock');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function updatePersistedState(edit: (latest: PersistedState) => PersistedState) {
  const commit = () => {
    const latest = loadPersistedState();
    const base = unsavedState ? { ...unsavedState, shelf: latest.shelf } : latest;
    const next = edit(base);
    if (base === next) return { state: base, saved: true };
    const saved = savePersistedState(next);
    // A failed Shelf write must never be replayed by a later unrelated edit.
    const visible = saved ? next : {
      ...next,
      shelf: latest.shelf,
      stats: next.shelf === base.shelf ? next.stats : base.stats,
    };
    unsavedState = saved ? undefined : visible;
    return { state: visible, saved };
  };

  if (navigator.locks) {
    try {
      return await navigator.locks.request(STORAGE_KEY, commit);
    } catch {
      // Restricted browsing modes may still allow the IndexedDB transaction.
    }
  }

  // An IndexedDB readwrite transaction serializes the synchronous localStorage
  // update in browsers without Web Locks.
  const db = await openLockDatabase().catch(() => null);
  if (!db) return commit();
  return new Promise<ReturnType<typeof commit>>((resolve, reject) => {
    const transaction = db.transaction('lock', 'readwrite');
    const request = transaction.objectStore('lock').get(STORAGE_KEY);
    request.onsuccess = () => resolve(commit());
    transaction.onabort = () => reject(transaction.error);
  }).catch(commit);
}

export function evaluateAchievements(
  stats: UserStats,
  shelfCount: number
): { newlyUnlocked: AchievementId[]; allUnlocked: AchievementId[] } {
  const set = new Set<AchievementId>(stats.unlockedAchievements);
  const newlyUnlocked: AchievementId[] = [];
  const check = (id: AchievementId, condition: boolean) => {
    if (condition && !set.has(id)) {
      set.add(id);
      newlyUnlocked.push(id);
    }
  };

  check('clicks-100', stats.totalClicks >= 100);
  check('clicks-1000', stats.totalClicks >= 1000);
  check('clicks-10000', stats.totalClicks >= 10000);
  check('all-switches', stats.switchesTried.length >= 6);
  check('save-5-builds', Math.max(shelfCount, stats.maxSavedCount) >= 5);

  return { newlyUnlocked, allUnlocked: Array.from(set) };
}

export function getAchievementProgress(
  id: AchievementId,
  stats: UserStats,
  shelfCount: number
): number {
  switch (id) {
    case 'clicks-100':
      return Math.min(100, stats.totalClicks);
    case 'clicks-1000':
      return Math.min(1000, stats.totalClicks);
    case 'clicks-10000':
      return Math.min(10000, stats.totalClicks);
    case 'all-switches':
      return Math.min(6, stats.switchesTried.length);
    case 'save-5-builds':
      return Math.min(5, Math.max(shelfCount, stats.maxSavedCount));
  }
}
