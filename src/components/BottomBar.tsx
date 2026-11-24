import { BookmarkPlus, Camera, Check, Dices, Hand, Keyboard, Share2, Sliders } from 'lucide-react';
import type { ToastAction } from './ToastStack';

interface BottomBarProps {
  mode: 'play' | 'customize';
  onSetMode: (mode: 'play' | 'customize') => void;
  onOpenDesk: () => void;
  onRandomize: () => void;
  onSaveToShelf: () => void;
  onShare: (opener: HTMLButtonElement) => void;
  onSnapshot: () => void;
  shelfFull: boolean;
  confirmedAction?: ToastAction;
}

export function BottomBar({ mode, onSetMode, onOpenDesk, onRandomize, onSaveToShelf, onShare, onSnapshot, shelfFull, confirmedAction }: BottomBarProps) {
  return (
    <div className="bottom-dock" role="toolbar" aria-label="Main clicker actions">
      <div className="mode-toggle" role="group" aria-label="Interaction mode">
        <button
          type="button"
          aria-pressed={mode === 'play'}
          className={`mode-tab ${mode === 'play' ? 'is-active' : ''}`}
          onClick={() => onSetMode('play')}
          data-testid="mode-play-btn"
        >
          <Hand size={16} aria-hidden="true" className="mode-tab-icon" />
          <span>Play</span>
        </button>
        <button
          type="button"
          aria-pressed={mode === 'customize'}
          className={`mode-tab ${mode === 'customize' ? 'is-active' : ''}`}
          onClick={() => onSetMode('customize')}
          data-testid="mode-customize-btn"
        >
          <Sliders size={16} aria-hidden="true" className="mode-tab-icon" />
          <span>Customize</span>
        </button>
        <button
          type="button"
          className="mode-tab desk-mode-tab"
          onClick={onOpenDesk}
          data-testid="mode-desk-btn"
        >
          <Keyboard size={16} aria-hidden="true" />
          <span>Desk mode</span>
        </button>
      </div>

      <div className="dock-actions">
        <button
          type="button"
          className="dock-btn"
          onClick={onRandomize}
          aria-label="Randomize clicker build"
          title="Randomize build"
          data-testid="dice-btn"
        >
          <Dices size={19} aria-hidden="true" />
          <span className="dock-btn-label">Dice</span>
        </button>

        <button
          type="button"
          className="dock-btn"
          onClick={() => onSaveToShelf()}
          aria-label={shelfFull ? 'Shelf is full (12 of 12)' : 'Save build to Shelf'}
          title={shelfFull ? 'Shelf full (12/12)' : 'Save to Shelf'}
          data-testid="save-shelf-btn"
          data-confirmed={confirmedAction === 'save' || undefined}
        >
          {confirmedAction === 'save' ? <Check size={19} aria-hidden="true" /> : <BookmarkPlus size={19} aria-hidden="true" />}
          <span className="dock-btn-label">Save</span>
        </button>

        <button
          type="button"
          className="dock-btn"
          onClick={(event) => onShare(event.currentTarget)}
          aria-label="Copy shareable link for this build"
          title="Share build link"
          data-testid="share-btn"
          data-confirmed={confirmedAction === 'share' || undefined}
        >
          {confirmedAction === 'share' ? <Check size={19} aria-hidden="true" /> : <Share2 size={19} aria-hidden="true" />}
          <span className="dock-btn-label">Share</span>
        </button>

        <button
          type="button"
          className="dock-btn"
          onClick={onSnapshot}
          aria-label="Export square PNG snapshot"
          title="Export square PNG"
          data-testid="snapshot-btn"
          data-confirmed={confirmedAction === 'snap' || undefined}
        >
          {confirmedAction === 'snap' ? <Check size={19} aria-hidden="true" /> : <Camera size={19} aria-hidden="true" />}
          <span className="dock-btn-label">Snap</span>
        </button>
      </div>
    </div>
  );
}
