import { CSSProperties, memo } from 'react';
import { Flame } from 'lucide-react';
import { ClickerBuild, getSwitchLabel } from '../types/build';

interface CounterHudProps {
  totalClicks: number;
  combo: number;
  comboWindowMs: number;
  bumpKey: number;
  build: ClickerBuild;
  milestoneBanner: number | null;
}

/**
 * Click counter + combo meter. The combo bar drains with a CSS animation that restarts
 * on every click (keyed by bumpKey) — no per-frame React state updates.
 */
export const CounterHud = memo(function CounterHud({
  totalClicks,
  combo,
  comboWindowMs,
  bumpKey,
  build,
  milestoneBanner,
}: CounterHudProps) {
  const switchName = getSwitchLabel(build);

  const comboTier =
    combo >= 100 ? 'tier-legend' : combo >= 50 ? 'tier-blaze' : combo >= 25 ? 'tier-hot' : combo >= 5 ? 'tier-warm' : '';

  return (
    <section className="counter-hud" aria-label="Click counter and combo meter">
      <div className="counter-cluster">
        <output className="sr-only" aria-live="polite" aria-atomic="true">
          {totalClicks.toLocaleString('en-US')} {totalClicks === 1 ? 'click' : 'clicks'} · {switchName}
        </output>
        <div key={bumpKey} className="counter-readout" data-testid="click-counter" aria-hidden="true">
          <span className="counter-number">{totalClicks.toLocaleString('en-US')}</span>
          <span className="counter-label">
            <span className="counter-unit">{totalClicks === 1 ? 'click' : 'clicks'}</span>
            <span className="counter-sep" aria-hidden="true">
              {' · '}
            </span>
            <span className="counter-switch">{switchName}</span>
          </span>
        </div>

        <div className="combo-slot">
          <div
            className={`combo-pill ${combo >= 2 && milestoneBanner === null ? 'is-visible' : ''} ${milestoneBanner !== null ? 'is-suppressed' : ''} ${comboTier}`}
            data-testid="combo-meter"
            aria-hidden={combo < 2 || milestoneBanner !== null}
          >
            <div className="combo-row">
              <Flame size={14} className="combo-icon" aria-hidden="true" />
              <span className="combo-value">{Math.max(2, combo)}×</span>
              <span className="combo-tag">
                {combo >= 100 ? 'GODLIKE' : combo >= 50 ? 'HYPER' : combo >= 25 ? 'ON FIRE' : 'COMBO'}
              </span>
            </div>
            <div className="combo-bar-track" aria-hidden="true">
              {combo >= 2 && (
                <div
                  key={bumpKey}
                  className="combo-bar-fill"
                  style={{ animationDuration: `${comboWindowMs}ms` } as CSSProperties}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {milestoneBanner !== null && (
        <div className="milestone-burst-pill" role="status" data-testid="milestone-banner">
          <span className="milestone-burst-inner">{milestoneBanner}×<span className="milestone-label"> combo milestone!</span></span>
        </div>
      )}
    </section>
  );
});
