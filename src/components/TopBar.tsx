import { Bookmark, Settings, Trophy, Volume2, VolumeX } from 'lucide-react';
import { DailySwitchVariant } from '../types/build';
import { BrandMark } from './BrandMark';

/** Crisp mechanical MX cross-stem emblem for Switch of the Day (replaces generic sparkle icons). */
function DailyStemGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.6v6.8M4.6 8h6.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

interface TopBarProps {
  muted: boolean;
  shelfCount: number;
  unlockedCount: number;
  totalAchievements: number;
  dailySwitch: DailySwitchVariant;
  isDailyActive: boolean;
  onToggleMute: () => void;
  onToggleDaily: () => void;
  onOpenShelf: () => void;
  onOpenAchievements: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  muted,
  shelfCount,
  unlockedCount,
  totalAchievements,
  dailySwitch,
  isDailyActive,
  onToggleMute,
  onToggleDaily,
  onOpenShelf,
  onOpenAchievements,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <div className="brand-pill" role="img" aria-label="Thock Lab">
          <BrandMark size={26} className="brand-mark" />
          <span className="brand-wordmark" aria-hidden="true">
            Thock<span className="brand-wordmark-lab">Lab</span>
          </span>
        </div>

        <button
          type="button"
          className={`daily-pill ${isDailyActive ? 'is-active' : ''}`}
          onClick={onToggleDaily}
          aria-pressed={isDailyActive}
          aria-label={`Switch of the day: ${dailySwitch.name}`}
          title={`Switch of the Day — ${dailySwitch.name}: ${dailySwitch.subtitle}`}
          data-testid="daily-switch-pill"
        >
          <span className="daily-pill-face">
            <DailyStemGlyph size={14} />
            <span className="daily-pill-text">
              <span className="daily-pill-kicker">Daily:</span> {dailySwitch.name}
            </span>
          </span>
        </button>
      </div>

      <nav className="top-bar-actions" aria-label="Studio controls">
        <button
          type="button"
          className={`icon-btn ${muted ? 'is-muted' : ''}`}
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          aria-pressed={muted}
          data-testid="mute-btn"
        >
          {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenShelf}
          aria-label={`Open Shelf (${shelfCount} saved builds)`}
          data-testid="shelf-btn"
        >
          <Bookmark size={18} aria-hidden="true" />
          {shelfCount > 0 && <span className="badge-count">{shelfCount}</span>}
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenAchievements}
          aria-label={`Achievements (${unlockedCount} of ${totalAchievements} unlocked)`}
          data-testid="achievements-btn"
        >
          <Trophy size={18} aria-hidden="true" />
          {unlockedCount > 0 && <span className="badge-count badge-gold">{unlockedCount}</span>}
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenSettings}
          aria-label="Open settings"
          data-testid="settings-btn"
        >
          <Settings size={18} aria-hidden="true" />
        </button>
      </nav>
    </header>
  );
}
