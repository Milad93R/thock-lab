import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { X } from 'lucide-react';
import { audioEngine } from './audio/engine';
import { DeskPanel } from './desk/DeskPanel';
import { AchievementsModal } from './components/AchievementsModal';
import { BottomBar } from './components/BottomBar';
import { ClickerStage, ClickerStageHandle, RendererMode } from './components/ClickerStage';
import { CounterHud } from './components/CounterHud';
import { CustomizeSheet, CustomizeTab } from './components/CustomizeSheet';
import { ModalShell } from './components/ModalShell';
import { OnboardingHints } from './components/OnboardingHints';
import { SettingsModal } from './components/SettingsModal';
import { ShelfModal } from './components/ShelfModal';
import { ToastAction, ToastItem, ToastStack } from './components/ToastStack';
import { TopBar } from './components/TopBar';
import type { StageFrame } from './scene/ClickerScene';
import { buildShareUrl, encodeBuildToHash, parseShareHash } from './share/codec';
import {
  ACHIEVEMENTS,
  AchievementId,
  evaluateAchievements,
  loadPersistedState,
  MAX_SHELF_SLOTS,
  PersistedState,
  SavedBuild,
  STORAGE_KEY,
  updatePersistedState,
  UserSettings,
} from './storage/store';
import {
  ClickerBuild,
  getBackdropHighlight,
  getBackdropTint,
  getBuildLabel,
  getSwitchOfTheDay,
  randomizeCuratedBuild,
  SWITCH_MAP,
} from './types/build';

const COMBO_WINDOW_MS = 1600;
const MILESTONES = new Set([25, 50, 100]);
const TOAST_SOLO_MS = 2600;
const TOAST_QUEUED_MS = 1350;
const TOAST_UNDO_MS = 6000;
const FRAME_OBSTACLES = ['.top-bar', '.counter-hud', '.toast-lane', '.bottom-dock', '.customize-sheet', '.onboarding-card'];

function isToastAction(kind: ToastItem['kind']): kind is ToastAction {
  return kind === 'save' || kind === 'share' || kind === 'snap';
}

function selectShareLink(event: React.SyntheticEvent<HTMLTextAreaElement>) {
  event.preventDefault();
  const field = event.currentTarget;
  field.focus({ preventScroll: true });
  field.setSelectionRange(0, field.value.length);
}

function measureFreeFrame(host: HTMLElement | null): StageFrame | null {
  if (!host) return null;
  const bounds = host.getBoundingClientRect();
  const { width, height } = bounds;
  if (width < 10 || height < 10) return null;
  const pad = Math.max(6, Math.min(14, Math.round(Math.min(width, height) * 0.015)));
  const box = (selector: string) => {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return null;
    return {
      l: rect.left - bounds.left,
      t: rect.top - bounds.top,
      r: rect.right - bounds.left,
      b: rect.bottom - bounds.top,
    };
  };

  const bar = box('.top-bar');
  const hud = box('.counter-hud');
  const toast = box('.toast-lane');
  const dock = box('.bottom-dock');
  const tray = box('.customize-sheet');
  const sideTray = tray && host.parentElement &&
    getComputedStyle(host.parentElement).getPropertyValue('--side-tray-width').trim();
  let l = 0;
  let r = sideTray && tray ? tray.l - pad : width;
  let t = Math.max(bar?.b ?? 0, hud?.b ?? 0, toast?.b ?? 0) + pad;
  let b = Math.min(dock?.t ?? height, tray && !sideTray ? tray.t : height) - pad;

  const hints = box('.onboarding-card');
  if (hints && hints.l < r && hints.r > l && hints.t < b && hints.b > t) {
    const fits = [
      { l, t, r, b: hints.t - pad },
      { l, t: hints.b + pad, r, b },
      { l: hints.r + pad, t, r, b },
      { l, t, r: hints.l - pad, b },
    ];
    const fit = (rect: typeof hints) => Math.min(rect.r - rect.l, (rect.b - rect.t) * 1.25);
    fits.sort((left, right) => fit(right) - fit(left));
    ({ l, t, r, b } = fits[0]);
  }

  l = Math.ceil(l);
  t = Math.ceil(t);
  r = Math.floor(r);
  b = Math.floor(b);
  return { x: l, y: t, w: Math.max(1, r - l), h: Math.max(1, b - t) };
}

export function App() {
  const [dailySwitch, setDailySwitch] = useState(() => getSwitchOfTheDay());
  useEffect(() => {
    let timer: number;
    const refresh = () => {
      const now = new Date();
      const offer = getSwitchOfTheDay(now);
      setDailySwitch((current) => current.dateKey === offer.dateKey ? current : offer);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // Initial state: localStorage + share hash (a valid hash wins; a broken one is ignored safely)
  const initial = useMemo(() => {
    const stored = loadPersistedState();
    const shared = parseShareHash(window.location.hash);
    if (shared.status === 'ok') {
      return { state: { ...stored, currentBuild: shared.build }, shareStatus: 'ok' as const };
    }
    return { state: stored, shareStatus: shared.status };
  }, []);

  const [state, setState] = useState<PersistedState>(initial.state);
  const [mode, setMode] = useState<'play' | 'customize' | 'desk'>('play');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [activeTab, setActiveTab] = useState<CustomizeTab>('switch');
  const [dialog, setDialog] = useState<'shelf' | 'achievements' | 'settings' | null>(null);
  const deskOpener = useRef<'mode-desk-btn' | 'settings-btn'>('mode-desk-btn');
  const openDesk = (opener: typeof deskOpener.current) => {
    deskOpener.current = opener;
    setDialog(null);
    setMode('desk');
  };
  const closeDesk = () => {
    setMode('play');
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-testid="${deskOpener.current}"]`)?.focus({ preventScroll: true });
    });
  };
  const [shareFallback, setShareFallback] = useState<{ url: string; opener: HTMLButtonElement } | null>(null);
  const shareRequestRef = useRef(0);
  const [hintStep, setHintStep] = useState<number>(() => (initial.state.hintsDismissed ? -1 : 0));
  const [renderer, setRenderer] = useState<RendererMode>('3d');
  const [frame, setFrame] = useState<StageFrame | null>(null);

  // Combo & click visual feedback state (no per-frame React updates: the bar drains in CSS)
  const [combo, setCombo] = useState(0);
  const [bumpKey, setBumpKey] = useState(0);
  const [milestoneBanner, setMilestoneBanner] = useState<number | null>(null);
  const [toastState, setToastState] = useState<{ active: ToastItem | null; queue: ToastItem[] }>({
    active: null,
    queue: [],
  });
  const [feedback, setFeedback] = useState<{ action: ToastAction; id: string } | null>(null);
  const toastShownAtRef = useRef<number>(0);

  const stageRef = useRef<ClickerStageHandle | null>(null);
  const comboDeadlineRef = useRef<number>(0);
  const comboCountRef = useRef<number>(0);
  const comboTimerRef = useRef<number | null>(null);
  const milestoneTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const spaceReleaseRef = useRef<(() => void) | null>(null);
  const stageReleaseRef = useRef<(() => void) | null>(null);
  const lastInputWasPointerRef = useRef<boolean>(false);
  const focusViaPointerRef = useRef<boolean>(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeDialog = dialog ?? (shareFallback ? 'share' : null);
  const activeDialogRef = useRef(activeDialog);
  activeDialogRef.current = activeDialog;
  const anyModalOpen = activeDialog !== null;

  const pushToast = useCallback((
    message: string,
    tone: ToastItem['tone'] = 'default',
    kind?: ToastItem['kind'],
    undo?: () => void
  ) => {
    const item: ToastItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message,
      tone,
      kind,
      undo,
    };
    const action = isToastAction(kind);
    if (action) setFeedback({ action: kind, id: item.id });
    setToastState(({ active, queue }) => {
      const pending = queue.filter((toast) => toast.kind !== 'roll' && (!action || toast.kind !== kind));
      if (undo) return { active: item, queue: pending };
      if (active?.undo) return { active, queue: [...pending, item].slice(-3) };
      if (!active || kind === 'invalid' || (active.kind === 'roll' && kind === 'roll')) {
        return { active: item, queue: pending };
      }
      if (!action) return { active, queue: [...pending, item].slice(0, 3) };

      const confirmations = pending.filter((toast) => isToastAction(toast.kind));
      if (!isToastAction(active.kind) || (active.kind === kind && confirmations.length === 0)) {
        return { active: item, queue: pending };
      }
      const notices = pending.filter((toast) => !isToastAction(toast.kind));
      return { active, queue: [...confirmations, item, ...notices].slice(0, 3) };
    });
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 1500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const activeToastId = toastState.active?.id;
  const hasQueuedToast = toastState.queue.length > 0;
  const hasUndoToast = !!toastState.active?.undo;
  useEffect(() => {
    if (!activeToastId) return;
    toastShownAtRef.current = performance.now();
  }, [activeToastId]);

  useEffect(() => {
    if (!activeToastId) return;
    const dwell = hasUndoToast ? TOAST_UNDO_MS : hasQueuedToast ? TOAST_QUEUED_MS : TOAST_SOLO_MS;
    const elapsed = performance.now() - toastShownAtRef.current;
    const remaining = Math.max(80, dwell - elapsed);
    const timer = window.setTimeout(() => {
      setToastState((prev) => {
        if (prev.active?.id !== activeToastId) return prev;
        if (prev.queue.length === 0) return { active: null, queue: [] };
        const [next, ...rest] = prev.queue;
        return { active: next, queue: rest };
      });
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [activeToastId, hasQueuedToast, hasUndoToast]);

  // Broken share link → keep the studio, explain, and clean the URL
  useEffect(() => {
    if (initial.shareStatus === 'invalid') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      pushToast('That share link is incomplete — showing your studio instead', 'default', 'invalid');
    } else if (initial.shareStatus === 'ok') {
      pushToast('Loaded shared clicker build', 'success');
    }
  }, [initial.shareStatus, pushToast]);

  // Sync audio engine settings
  useLayoutEffect(() => {
    audioEngine.setVolume(state.settings.volume);
    audioEngine.setMuted(state.settings.muted);
  }, [state.settings.volume, state.settings.muted]);

  useLayoutEffect(() => {
    const events = ['pointerdown', 'mousedown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'click'];
    const activateAudio = (event: Event) => {
      if (!event.isTrusted) return;
      const canResume = navigator.userActivation?.hasBeenActive !== false || event.type === 'touchend';
      if (canResume || event.type === 'touchstart') audioEngine.activate(canResume);
    };
    for (const event of events) window.addEventListener(event, activateAudio, { capture: true, passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, activateAudio, true);
    };
  }, []);

  const syncProgress = useCallback(({ shelf, stats }: PersistedState) => {
    setState((prev) => ({ ...prev, shelf, stats }));
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) syncProgress(loadPersistedState());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncProgress]);

  // Persist only locally edited fields. A tab playing a shared build keeps its
  // own build while Shelf and click progress are synchronized across tabs.
  const persistedLocal = useRef(initial.state);
  const persistInitialShare = useRef(initial.shareStatus === 'ok');
  const { currentBuild, settings, hintsDismissed } = state;
  useEffect(() => {
    const previous = persistedLocal.current;
    const buildChanged = persistInitialShare.current || previous.currentBuild !== currentBuild;
    const hintsChanged = previous.hintsDismissed !== hintsDismissed;
    const settingsPatch = Object.fromEntries(
      Object.entries(settings).filter(([key, value]) => value !== previous.settings[key as keyof UserSettings])
    ) as Partial<UserSettings>;
    persistInitialShare.current = false;
    persistedLocal.current = { ...previous, currentBuild, settings, hintsDismissed };
    if (!buildChanged && !hintsChanged && Object.keys(settingsPatch).length === 0) return;
    void updatePersistedState((latest) => ({
      ...latest,
      currentBuild: buildChanged ? currentBuild : latest.currentBuild,
      hintsDismissed: hintsChanged ? hintsDismissed : latest.hintsDismissed,
      settings: { ...latest.settings, ...settingsPatch },
    }));
  }, [currentBuild, settings, hintsDismissed]);

  // Achievement toasts (diff outside of state updaters, so StrictMode never doubles them)
  const unlockedRef = useRef<AchievementId[]>(state.stats.unlockedAchievements);
  useEffect(() => {
    const prev = new Set(unlockedRef.current);
    for (const id of state.stats.unlockedAchievements) {
      if (!prev.has(id)) {
        const def = ACHIEVEMENTS.find((a) => a.id === id);
        if (def) pushToast(`Achievement unlocked: ${def.title}`, 'gold');
      }
    }
    unlockedRef.current = state.stats.unlockedAchievements;
  }, [state.stats.unlockedAchievements, pushToast]);

  // One place keeps an existing share hash in sync with the current build (dice, shelf, daily, edits)
  useEffect(() => {
    if (!window.location.hash.startsWith('#b=')) return;
    const next = encodeBuildToHash(state.currentBuild);
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }, [state.currentBuild]);

  // Pasted / navigated share links
  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseShareHash(window.location.hash);
      if (parsed.status === 'ok') {
        setState((prev) => ({ ...prev, currentBuild: parsed.build }));
        pushToast('Loaded shared clicker build', 'success');
      } else if (parsed.status === 'invalid') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        pushToast('That share link is incomplete — showing your studio instead', 'default', 'invalid');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [pushToast]);

  // ── layout-aware framing for the clicker ──
  const measure = useCallback(() => {
    const host = document.querySelector<HTMLElement>('.stage-viewport');
    const next = measureFreeFrame(host);
    if (!next) return;
    setFrame((prev) =>
      prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    // re-check after the browser has styled/animated the new chrome, and once it settled
    const r1 = requestAnimationFrame(() => {
      measure();
    });
    const t = window.setTimeout(measure, 300);
    return () => {
      cancelAnimationFrame(r1);
      window.clearTimeout(t);
    };
  }, [measure, mode, hintStep, renderer, activeTab, anyModalOpen]);

  useEffect(() => {
    (window as unknown as { __thockFrame?: StageFrame | null }).__thockFrame = frame;
  }, [frame]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (!viewport || !shell) return;
    const fitViewport = () => {
      if (viewport.scale === 1 && viewport.height < window.innerHeight - 2) {
        shell.style.setProperty('--studio-height', `${viewport.height}px`);
      } else {
        shell.style.removeProperty('--studio-height');
      }
    };
    fitViewport();
    viewport.addEventListener('resize', fitViewport);
    return () => viewport.removeEventListener('resize', fitViewport);
  }, []);

  useEffect(() => {
    // ResizeObserver runs before paint. Commit the measured coordinates in
    // that frame too, including when Safari switches between tray breakpoints.
    const onResize = () => flushSync(measure);
    const ro = new ResizeObserver(onResize);
    const observe = () => {
      ro.disconnect();
      for (const sel of FRAME_OBSTACLES) {
        const el = document.querySelector(sel);
        if (el) ro.observe(el);
      }
      const host = document.querySelector('.stage-viewport');
      if (host) ro.observe(host);
    };
    observe();
    const mo = new MutationObserver(() => {
      observe();
      measure();
    });
    const shell = document.querySelector('.app-shell');
    if (shell) mo.observe(shell, { childList: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [measure]);

  const registerClick = useCallback((overrideBuild?: ClickerBuild) => {
    const activeBuild = overrideBuild ?? stateRef.current.currentBuild;
    const now = performance.now();
    const nextCombo = now <= comboDeadlineRef.current ? comboCountRef.current + 1 : 1;
    comboCountRef.current = nextCombo;
    comboDeadlineRef.current = now + COMBO_WINDOW_MS;

    setCombo(nextCombo);
    setBumpKey((k) => k + 1);
    if (comboTimerRef.current) window.clearTimeout(comboTimerRef.current);
    comboTimerRef.current = window.setTimeout(() => {
      comboCountRef.current = 0;
      setCombo(0);
    }, COMBO_WINDOW_MS);

    stageRef.current?.pressKey(nextCombo);

    const velocity = Math.min(1.12, 0.96 + nextCombo * 0.005);
    const releaseAudio = audioEngine.triggerDown(activeBuild, velocity);

    if (
      stateRef.current.settings.haptics &&
      navigator.userActivation?.hasBeenActive !== false &&
      typeof navigator.vibrate === 'function'
    ) {
      try {
        navigator.vibrate(8);
      } catch {
        // Ignore unsupported vibrate
      }
    }

    if (MILESTONES.has(nextCombo)) {
      stageRef.current?.triggerMilestoneBurst(nextCombo);
      audioEngine.triggerMilestone(nextCombo);
      setMilestoneBanner(nextCombo);
      if (milestoneTimerRef.current) window.clearTimeout(milestoneTimerRef.current);
      milestoneTimerRef.current = window.setTimeout(() => setMilestoneBanner(null), 1800);
    }

    const switchUsed = activeBuild.switchType;
    void updatePersistedState((prev) => {
      const switchesTried = prev.stats.switchesTried.includes(switchUsed)
        ? prev.stats.switchesTried
        : [...prev.stats.switchesTried, switchUsed];
      const nextStats = {
        ...prev.stats,
        totalClicks: prev.stats.totalClicks + 1,
        bestCombo: Math.max(prev.stats.bestCombo, nextCombo),
        switchesTried,
      };
      const { allUnlocked } = evaluateAchievements(nextStats, prev.shelf.length);
      return { ...prev, stats: { ...nextStats, unlockedAchievements: allUnlocked } };
    }).then(({ state }) => syncProgress(state));
    return releaseAudio;
  }, [syncProgress]);

  const handleKeyUp = useCallback((releaseAudio: (() => void) | null) => {
    stageRef.current?.releaseKey();
    releaseAudio?.();
  }, []);

  const handleStageDown = useCallback(() => {
    stageReleaseRef.current = registerClick();
  }, [registerClick]);
  const handleStageUp = useCallback(() => {
    handleKeyUp(stageReleaseRef.current);
    stageReleaseRef.current = null;
  }, [handleKeyUp]);

  // Preview press+release when selecting a switch, base or rolling the dice.
  // Rapid previews cancel the pending release so every pick gets a fresh key travel.
  const handlePreviewClick = useCallback(
    (overrideBuild?: ClickerBuild) => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
        stageRef.current?.releaseKey();
      }
      const releaseAudio = registerClick(overrideBuild);
      previewTimerRef.current = window.setTimeout(() => {
        previewTimerRef.current = null;
        handleKeyUp(releaseAudio);
      }, 95);
    },
    [registerClick, handleKeyUp]
  );

  // Keyboard: Space (and Enter on the clicker) presses the key.
  useEffect(() => {
    const isTypingTarget = (el: HTMLElement | null) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    // Track whether focus arrived via pointer (mouse/touch) or keyboard navigation (Tab/arrows).
    // Stored in refs so opening/closing modals never resets pointer-vs-keyboard tracking.
    const onPointerDownCapture = () => {
      lastInputWasPointerRef.current = true;
    };
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (
        e.key === 'Tab' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        lastInputWasPointerRef.current = false;
      }
    };
    const onFocusIn = () => {
      focusViaPointerRef.current = lastInputWasPointerRef.current;
    };
    const keyboardFocusedControl = (el: HTMLElement | null) => {
      if (!el || el === document.body) return false;
      const interactive = el.closest('button, a, [role="button"], [role="tab"], [role="switch"]');
      if (!interactive) return false;
      return !focusViaPointerRef.current;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeDialogRef.current === 'share') setShareFallback(null);
        else setDialog(null);
        return;
      }
      if (modeRef.current === 'desk' || e.defaultPrevented || (e.code !== 'Space' && e.key !== ' ')) return;
      if (activeDialogRef.current) return;
      const stage = document.querySelector('.stage-viewport');
      if (stage && getComputedStyle(stage).visibility === 'hidden') return;
      const target = e.target as HTMLElement | null;
      if (isTypingTarget(target)) return;
      // A control the user reached with Tab keeps native Space behaviour;
      // a button that merely kept focus after a mouse/touch click does not steal the key.
      if (keyboardFocusedControl(target)) return;
      e.preventDefault();
      if (
        target &&
        target !== document.body &&
        typeof target.blur === 'function'
      ) {
        target.blur();
      }
      if (e.repeat) return;
      if (!spaceReleaseRef.current) spaceReleaseRef.current = registerClick();
    };

    const onKeyUpEv = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (spaceReleaseRef.current) {
        e.preventDefault();
        handleKeyUp(spaceReleaseRef.current);
        spaceReleaseRef.current = null;
      }
    };

    window.addEventListener('pointerdown', onPointerDownCapture, true);
    window.addEventListener('keydown', onKeyDownCapture, true);
    window.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUpEv);
    return () => {
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
      window.removeEventListener('keydown', onKeyDownCapture, true);
      window.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUpEv);
    };
  }, [registerClick, handleKeyUp]);

  const updateBuild = useCallback((patch: Partial<ClickerBuild>) => {
    setState((prev) => ({ ...prev, currentBuild: { ...prev.currentBuild, ...patch } }));
  }, []);

  const handleRandomize = useCallback(() => {
    const next = randomizeCuratedBuild(stateRef.current.currentBuild, dailySwitch);
    setState((prev) => ({ ...prev, currentBuild: next }));
    handlePreviewClick(next);
    pushToast(`Rolled ${getBuildLabel(next)}`, 'default', 'roll');
  }, [dailySwitch, handlePreviewClick, pushToast]);

  const handleToggleDaily = useCallback(() => {
    const currentlyActive = stateRef.current.currentBuild.dailyVariantId === dailySwitch.id;
    const next: ClickerBuild = currentlyActive
      ? { ...stateRef.current.currentBuild, dailyVariantId: null }
      : { ...stateRef.current.currentBuild, switchType: dailySwitch.baseSwitch, dailyVariantId: dailySwitch.id };
    setState((prev) => ({ ...prev, currentBuild: next }));
    handlePreviewClick(next);
    pushToast(
      currentlyActive ? `Switched to ${SWITCH_MAP[next.switchType].name}` : `Switch of the Day: ${dailySwitch.name}`,
      'success'
    );
  }, [dailySwitch, handlePreviewClick, pushToast]);

  const savingRef = useRef(false);
  const handleSaveToShelf = useCallback(async (requestedSlot?: number) => {
    if (savingRef.current) return;
    savingRef.current = true;
    const build = stateRef.current.currentBuild;
    try {
      let thumbnail = '';
      try {
        thumbnail = (await stageRef.current?.captureThumbnail()) ?? '';
      } catch {
        thumbnail = '';
      }
      const createdAt = Date.now();
      const id = `build-${createdAt}-${Math.random().toString(36).slice(2, 10)}`;
      const { state: latest, saved } = await updatePersistedState((prev) => {
        const slots = new Map(prev.shelf.map((item) => [item.slot, item]));
        let slot = requestedSlot ?? 1;
        if (requestedSlot === undefined) {
          while (slots.has(slot)) slot++;
        }
        if (slot > MAX_SHELF_SLOTS || slots.has(slot)) return prev;
        slots.set(slot, {
          slot,
          id,
          name: getBuildLabel(build),
          build: { ...build },
          thumbnail,
          createdAt,
        });
        const nextShelf = [...slots.values()].sort((a, b) => a.slot - b.slot);
        const nextStats = { ...prev.stats, maxSavedCount: Math.max(prev.stats.maxSavedCount, nextShelf.length) };
        const { allUnlocked } = evaluateAchievements(nextStats, nextShelf.length);
        return { ...prev, shelf: nextShelf, stats: { ...nextStats, unlockedAchievements: allUnlocked } };
      });
      syncProgress(latest);
      if (!saved) {
        pushToast('Shelf storage is unavailable. Your build is still open in the studio.');
      } else if (latest.shelf.some((item) => item.id === id)) {
        pushToast(`Saved to Shelf (${latest.shelf.length}/${MAX_SHELF_SLOTS})`, 'success', 'save');
      } else if (requestedSlot === undefined) {
        if (!activeDialogRef.current) setDialog('shelf');
        pushToast('Shelf is full (12/12) — remove a slot to save more');
      } else {
        pushToast(`Slot ${requestedSlot} is already filled`);
      }
    } finally {
      savingRef.current = false;
    }
  }, [pushToast, syncProgress]);

  const handleLoadFromShelf = useCallback(
    (saved: SavedBuild) => {
      const next = saved.build;
      setState((prev) => ({ ...prev, currentBuild: next }));
      setDialog(null);
      handlePreviewClick(next);
      pushToast(`Loaded ${getBuildLabel(next)}`);
    },
    [handlePreviewClick, pushToast]
  );

  const handleDeleteFromShelf = useCallback(
    async (target: SavedBuild) => {
      let removed = false;
      const { state: latest, saved } = await updatePersistedState((prev) => {
        const shelf = prev.shelf.filter(({ slot, id, createdAt }) =>
          slot !== target.slot || id !== target.id || createdAt !== target.createdAt
        );
        removed = shelf.length !== prev.shelf.length;
        return removed ? { ...prev, shelf } : prev;
      });
      syncProgress(latest);
      if (!saved) {
        pushToast('Shelf storage is unavailable');
        return;
      }
      if (!removed) return;

      const undo = async () => {
        setToastState((prev) => {
          if (prev.active?.undo !== undo) return prev;
          const [next, ...rest] = prev.queue;
          return { active: next ?? null, queue: rest };
        });
        const { state: restored, saved } = await updatePersistedState((prev) => {
          if (prev.shelf.some(({ slot }) => slot === target.slot)) return prev;
          const shelf = [...prev.shelf, target].sort((a, b) => a.slot - b.slot);
          return { ...prev, shelf };
        });
        syncProgress(restored);
        if (!saved) pushToast('Shelf storage is unavailable');
        else if (restored.shelf.some(({ slot, id }) => slot === target.slot && id === target.id)) {
          pushToast(`Restored to Slot ${target.slot}`, 'success');
        } else {
          pushToast(`Slot ${target.slot} is already filled`);
        }
      };
      pushToast('Removed from Shelf', 'default', undefined, undo);
    },
    [pushToast, syncProgress]
  );

  const handleShare = useCallback(async (opener: HTMLButtonElement) => {
    const request = ++shareRequestRef.current;
    const build = stateRef.current.currentBuild;
    window.history.replaceState(null, '', encodeBuildToHash(build));
    const shareUrl = buildShareUrl(build);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        if (request === shareRequestRef.current) pushToast('Share link copied to clipboard', 'success', 'share');
        return;
      }
    } catch {
      // Fall through to the manual copy path.
    }
    if (request !== shareRequestRef.current) return;

    // The legacy path selects a temporary field and can move focus out of a dialog.
    if (!activeDialogRef.current) {
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.readOnly = true;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      const previousFocus = document.activeElement;
      try {
        textarea.select();
        if (document.execCommand('copy')) {
          pushToast('Share link copied to clipboard', 'success', 'share');
          return;
        }
      } catch {
        // The URL is available for manual selection in the dialog below.
      } finally {
        textarea.remove();
        if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
      }
    }
    setFeedback((current) => current?.action === 'share' ? null : current);
    setToastState(({ active, queue }) => {
      const remaining = queue.filter((item) => item.kind !== 'share');
      if (active?.kind !== 'share') return { active, queue: remaining };
      const [next, ...rest] = remaining;
      return { active: next ?? null, queue: rest };
    });
    setShareFallback({ url: shareUrl, opener });
  }, [pushToast]);

  const snappingRef = useRef(false);
  const handleSnapshot = useCallback(async () => {
    if (snappingRef.current) return;
    snappingRef.current = true;
    const build = stateRef.current.currentBuild;
    try {
      const blob = await stageRef.current?.captureSnapshot();
      if (!blob) {
        pushToast('Could not capture snapshot');
        return;
      }
      const slug = `${build.switchType}-${build.keycapShape}-${build.baseMaterial}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `thock-lab-${slug}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      pushToast('Saved square PNG snapshot', 'success', 'snap');
    } catch {
      pushToast('Could not capture snapshot');
    } finally {
      snappingRef.current = false;
    }
  }, [pushToast]);

  const handleUpdateSettings = useCallback((patch: Partial<UserSettings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  const handleNextHint = useCallback(() => {
    setHintStep((step) => {
      if (step >= 2) {
        setState((prev) => ({ ...prev, hintsDismissed: true }));
        return -1;
      }
      return step + 1;
    });
  }, []);

  const handleSkipHints = useCallback(() => {
    setHintStep(-1);
    setState((prev) => ({ ...prev, hintsDismissed: true }));
  }, []);

  const handleRendererChange = useCallback(
    (next: RendererMode) => {
      setRenderer(next);
      if (next === '2d') {
        let shown = false;
        try {
          shown = window.sessionStorage.getItem('thock-lab:2d-notice') === '1';
          window.sessionStorage.setItem('thock-lab:2d-notice', '1');
        } catch {
          // ignore
        }
        if (!shown) pushToast('No 3D on this device — showing the 2D studio');
      }
    },
    [pushToast]
  );

  const backdropTint = getBackdropTint(state.currentBuild.keycapColor);
  const isGlow = state.currentBuild.keycapFinish === 'glow';
  const showHints = hintStep >= 0 && mode === 'play' && !anyModalOpen;
  const toast = <ToastStack toast={toastState.active} />;
  const toastInTray = mode === 'customize' && !anyModalOpen;
  const toastInShelf = activeDialog === 'shelf' && hasUndoToast;

  return (
    <main
      className={[
        'app-shell',
        mode === 'desk' ? 'is-desk' : mode === 'customize' ? 'is-customizing' : 'is-playing',
        state.settings.reducedMotion ? 'is-reduced-motion' : '',
        isGlow ? 'is-glow' : '',
        showHints ? 'has-hints' : '',
        anyModalOpen ? 'has-modal' : '',
        `renderer-${renderer}`,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        '--backdrop-tint': backdropTint,
        '--backdrop-highlight': getBackdropHighlight(state.currentBuild.baseMaterial),
      } as React.CSSProperties}
      data-testid="app-shell"
    >
      <div className="studio-backdrop" aria-hidden="true" />

      <div className="stage-viewport">
        <ClickerStage
          ref={stageRef}
          build={state.currentBuild}
          reducedMotion={state.settings.reducedMotion}
          frame={frame}
          onKeyDown={handleStageDown}
          onKeyUp={handleStageUp}
          onCameraReset={() => pushToast('Camera angle reset')}
          onRendererChange={handleRendererChange}
        />
      </div>

      <TopBar
        muted={state.settings.muted}
        shelfCount={state.shelf.length}
        unlockedCount={state.stats.unlockedAchievements.length}
        totalAchievements={ACHIEVEMENTS.length}
        dailySwitch={dailySwitch}
        isDailyActive={state.currentBuild.dailyVariantId === dailySwitch.id}
        onToggleMute={() => handleUpdateSettings({ muted: !state.settings.muted })}
        onToggleDaily={handleToggleDaily}
        onOpenShelf={() => setDialog('shelf')}
        onOpenAchievements={() => setDialog('achievements')}
        onOpenSettings={() => setDialog('settings')}
      />

      {mode === 'desk' && (
        <DeskPanel
          build={state.currentBuild}
          dailySwitch={dailySwitch}
          muted={state.settings.muted}
          onChangeBuild={updateBuild}
          onClose={closeDesk}
        />
      )}

      <CounterHud
        totalClicks={state.stats.totalClicks}
        combo={combo}
        comboWindowMs={COMBO_WINDOW_MS}
        bumpKey={bumpKey}
        build={state.currentBuild}
        milestoneBanner={milestoneBanner}
      />

      {showHints && <OnboardingHints step={hintStep} renderer={renderer} onNext={handleNextHint} onSkip={handleSkipHints} />}

      <CustomizeSheet
        open={mode === 'customize'}
        activeTab={activeTab}
        build={state.currentBuild}
        dailySwitch={dailySwitch}
        notification={toastInTray ? toast : undefined}
        onSelectTab={setActiveTab}
        onChangeBuild={updateBuild}
        onRandomize={handleRandomize}
        onClose={() => setMode('play')}
        onPreviewClick={handlePreviewClick}
      />

      <BottomBar
        mode={mode === 'desk' ? 'play' : mode}
        onSetMode={setMode}
        onOpenDesk={() => openDesk('mode-desk-btn')}
        onRandomize={handleRandomize}
        onSaveToShelf={handleSaveToShelf}
        onShare={handleShare}
        onSnapshot={handleSnapshot}
        confirmedAction={feedback?.action}
        shelfFull={state.shelf.length >= MAX_SHELF_SLOTS}
      />

      <ShelfModal
        open={activeDialog === 'shelf'}
        shelf={state.shelf}
        onClose={() => setDialog(null)}
        onLoadBuild={handleLoadFromShelf}
        onDeleteBuild={handleDeleteFromShelf}
        onSaveCurrent={handleSaveToShelf}
        notification={toastInShelf ? toast : undefined}
      />

      <AchievementsModal
        open={activeDialog === 'achievements'}
        stats={state.stats}
        shelfCount={state.shelf.length}
        onClose={() => setDialog(null)}
      />

      <SettingsModal
        open={activeDialog === 'settings'}
        settings={state.settings}
        renderer={renderer}
        onUpdateSettings={handleUpdateSettings}
        onResetCamera={() => stageRef.current?.resetCamera()}
        onReplayHints={() => {
          setMode('play');
          setHintStep(0);
          setState((prev) => ({ ...prev, hintsDismissed: false }));
        }}
        onOpenDesk={mode === 'desk' ? undefined : () => openDesk('settings-btn')}
        onClose={() => setDialog(null)}
      />

      {activeDialog === 'share' && shareFallback && (
        <ModalShell
          labelledBy="share-link-title"
          testId="share-link-modal"
          returnFocusTo={shareFallback.opener}
          onClose={() => setShareFallback(null)}
        >
          <div className="modal-header">
            <h2 id="share-link-title" className="modal-title">Share build</h2>
            <button type="button" className="sheet-mini-btn" aria-label="Close Share" onClick={() => setShareFallback(null)}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="share-link-body">
            <label htmlFor="share-link-url">Share link</label>
            <textarea
              id="share-link-url"
              rows={2}
              value={shareFallback.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              onTouchEnd={selectShareLink}
              onClick={selectShareLink}
            />
          </div>
        </ModalShell>
      )}

      {!toastInTray && !toastInShelf && toast}
    </main>
  );
}

export default App;
