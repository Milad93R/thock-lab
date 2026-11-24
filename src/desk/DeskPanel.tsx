import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Keyboard } from 'lucide-react';
import { audioEngine } from '../audio/engine';
import { deskSamples } from '../audio/deskSamples';
import { BASE_MATERIALS, SWITCH_CATALOG, getDailyVariant, type ClickerBuild, type DailySwitchVariant } from '../types/build';
import { DeskBoard } from './DeskBoard';
import { createDeskKeys, deskTouch } from './keys';
import './desk.css';

export type DeskListening = 'pad' | 'tab';

interface DeskPanelProps {
  build: ClickerBuild;
  dailySwitch: DailySwitchVariant & { id: NonNullable<ClickerBuild['dailyVariantId']> };
  muted: boolean;
  listening: DeskListening;
  padText: string;
  onChangeListening: (next: DeskListening) => void;
  onChangePadText: (next: string) => void;
  onChangeBuild: (patch: Partial<ClickerBuild>) => void;
  onClose: () => void;
}

const hasTabFocus = () => !document.hidden && document.hasFocus();

export function DeskPanel({
  build,
  dailySwitch,
  muted,
  listening,
  padText,
  onChangeListening,
  onChangePadText,
  onChangeBuild,
  onClose,
}: DeskPanelProps) {
  const [focused, setFocused] = useState(hasTabFocus);
  const [padFocused, setPadFocused] = useState(false);
  const [pressed, setPressed] = useState<ReadonlySet<string>>(() => new Set());
  const padRef = useRef<HTMLTextAreaElement | null>(null);
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => { deskSamples(build); }, [build]);

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) {
      padRef.current?.focus({ preventScroll: true });
    }
    setPadFocused(hasTabFocus() && document.activeElement === padRef.current);
  }, []);

  useEffect(() => {
    const keys = createDeskKeys((code) => {
      const finish = audioEngine.triggerDeskDown(buildRef.current, deskTouch(code));
      setPressed((previous) => new Set(previous).add(code));
      return (released) => {
        finish(released);
        setPressed((previous) => {
          const next = new Set(previous);
          next.delete(code);
          return next;
        });
      };
    });
    const down = (event: KeyboardEvent) => {
      if (!event.isTrusted || !hasTabFocus()) return;
      if (listeningRef.current === 'pad' && event.target !== padRef.current) return;
      keys.down(event);
    };
    const up = (event: KeyboardEvent) => {
      if (event.isTrusted && hasTabFocus()) keys.up(event);
    };
    const blur = () => {
      // Capturing keyboard events must stop even when the OS withholds the corresponding keyup.
      keys.clear();
      setFocused(false);
      setPadFocused(false);
    };
    const focus = () => {
      const active = hasTabFocus();
      setFocused(active);
      setPadFocused(active && document.activeElement === padRef.current);
    };
    const visibility = () => {
      if (document.hidden) blur();
      else focus();
    };
    focus();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      keys.clear();
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  const selectedDaily = getDailyVariant(build.dailyVariantId);
  const selectListening = (next: DeskListening) => {
    onChangeListening(next);
    if (next === 'pad' && !window.matchMedia('(pointer: coarse)').matches) {
      padRef.current?.focus({ preventScroll: true });
    }
  };

  const activeListener = focused && !muted && (listening === 'tab' || padFocused);
  const statusText = !focused
    ? 'Paused · tab out of focus'
    : muted
      ? 'Sound muted'
      : listening === 'pad' && !padFocused
        ? 'Focus the typing pad'
        : listening === 'pad'
          ? 'Listening in typing pad'
          : 'Tab focused';

  return (
    <section className="desk-view" aria-labelledby="desk-title" data-testid="desk-view">
      <div className="desk-layout">
        <header className="desk-header">
          <div className="desk-title-block">
            <div className="desk-title-row">
              <button type="button" className="desk-back" onClick={onClose} data-testid="desk-close">
                <ArrowLeft size={16} aria-hidden="true" /> Back to studio
              </button>
              <h1 id="desk-title">Desk mode</h1>
            </div>
            <p id="desk-scope">Key sounds work while this tab has focus.</p>
          </div>
          <div className="desk-build">
            <div className="desk-option">
              <label htmlFor="desk-switch">Switch</label>
              <select
                id="desk-switch"
                value={build.dailyVariantId ?? build.switchType}
                onChange={(event) => {
                  const daily = getDailyVariant(event.target.value);
                  const standard = SWITCH_CATALOG.find(({ id }) => id === event.target.value);
                  if (daily) onChangeBuild({ switchType: daily.baseSwitch, dailyVariantId: daily.id });
                  else if (standard) onChangeBuild({ switchType: standard.id, dailyVariantId: null });
                }}
              >
                {SWITCH_CATALOG.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                <option value={dailySwitch.id}>{dailySwitch.name} (Daily)</option>
                {selectedDaily && selectedDaily.id !== dailySwitch.id && (
                  <option value={selectedDaily.id}>{selectedDaily.name} (Daily)</option>
                )}
              </select>
            </div>
            <div className="desk-option">
              <label htmlFor="desk-base">Base</label>
              <select
                id="desk-base"
                value={build.baseMaterial}
                onChange={(event) => onChangeBuild({ baseMaterial: event.target.value as ClickerBuild['baseMaterial'] })}
              >
                {BASE_MATERIALS.map(({ id, short }) => <option key={id} value={id}>{short}</option>)}
              </select>
            </div>
          </div>
        </header>
        <div className="desk-workbench">
          <DeskBoard pressed={pressed} base={build.baseMaterial} />
          <div className="desk-paper">
            <div className="desk-listening" role="group" aria-label="Where to listen">
              <button type="button" aria-pressed={listening === 'pad'} onClick={() => selectListening('pad')}>Typing pad</button>
              <button type="button" aria-pressed={listening === 'tab'} onClick={() => selectListening('tab')}>Background</button>
            </div>
            <p className="desk-mobile-note"><Keyboard size={15} aria-hidden="true" /> Pair a physical keyboard to play.</p>
            <label htmlFor="desk-pad">Type here</label>
            <textarea
              ref={padRef}
              id="desk-pad"
              dir="auto"
              rows={4}
              value={padText}
              onChange={(event) => onChangePadText(event.target.value)}
              onFocus={() => setPadFocused(true)}
              onBlur={() => setPadFocused(false)}
              placeholder="The quick brown fox…"
              aria-describedby="desk-scope desk-listening-note"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
            <p className="desk-listening-note" id="desk-listening-note">
              {listening === 'pad'
                ? 'Plays while you type here. Scratch pad clears on reload.'
                : 'Plays anywhere in this tab; scratch pad stays until reload.'}
            </p>
          </div>
        </div>
        <p
          className="desk-status"
          data-active={activeListener}
          data-focused={focused}
          data-muted={muted}
          role="status"
        >
          {statusText}
        </p>
      </div>
    </section>
  );
}
