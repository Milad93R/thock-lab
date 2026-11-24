import { Bookmark, Check, Crown, Flame, Gauge, Layers, X } from 'lucide-react';
import { ModalShell } from './ModalShell';
import {
  ACHIEVEMENTS,
  AchievementDef,
  getAchievementProgress,
  UserStats,
} from '../storage/store';

interface AchievementsModalProps {
  open: boolean;
  stats: UserStats;
  shelfCount: number;
  onClose: () => void;
}

function renderIcon(icon: AchievementDef['icon']) {
  switch (icon) {
    case 'spark':
      return <Gauge size={18} />;
    case 'flame':
      return <Flame size={18} />;
    case 'crown':
      return <Crown size={18} />;
    case 'layers':
      return <Layers size={18} />;
    case 'bookmark':
      return <Bookmark size={18} />;
  }
}

export function AchievementsModal({
  open,
  stats,
  shelfCount,
  onClose,
}: AchievementsModalProps) {
  if (!open) return null;

  return (
    <ModalShell labelledBy="ach-title" testId="achievements-modal" onClose={onClose}>
        <div className="modal-header">
          <div>
            <h2 id="ach-title" className="modal-title">
              Achievements
            </h2>
            <p className="modal-subtitle">
              {stats.unlockedAchievements.length} of {ACHIEVEMENTS.length} unlocked · Best combo:{' '}
              <strong>{stats.bestCombo.toLocaleString('en-US')}×</strong>
            </p>
          </div>
          <button
            type="button"
            className="sheet-mini-btn"
            onClick={onClose}
            aria-label="Close achievements"
            data-testid="close-achievements-btn"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="ach-list">
          {ACHIEVEMENTS.map((ach) => {
            const unlocked = stats.unlockedAchievements.includes(ach.id);
            const current = getAchievementProgress(ach.id, stats, shelfCount);
            const pct = Math.min(100, Math.round((current / ach.target) * 100));

            return (
              <div
                key={ach.id}
                className={`ach-row ${unlocked ? 'is-unlocked' : ''}`}
                data-testid={`ach-${ach.id}`}
              >
                <div className="ach-icon-box" aria-hidden="true">
                  {unlocked ? <Check size={18} strokeWidth={2.8} /> : renderIcon(ach.icon)}
                </div>
                <div className="ach-info">
                  <div className="ach-top">
                    <span className="ach-name">{ach.title}</span>
                    <span className="ach-progress-text">
                      {current.toLocaleString('en-US')} / {ach.target.toLocaleString('en-US')}
                    </span>
                  </div>
                  <p className="ach-desc">{ach.description}</p>
                  <div className="ach-bar-track">
                    <div className="ach-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
    </ModalShell>
  );
}
