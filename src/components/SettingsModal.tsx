import { Box, Gauge, RotateCcw, Smartphone, Volume2, VolumeX, X } from 'lucide-react';
import { ModalShell } from './ModalShell';
import { UserSettings } from '../storage/store';

interface SettingsModalProps {
  open: boolean;
  settings: UserSettings;
  renderer: '3d' | '2d';
  onUpdateSettings: (patch: Partial<UserSettings>) => void;
  onResetCamera: () => void;
  onReplayHints: () => void;
  onClose: () => void;
}

export function SettingsModal({
  open,
  settings,
  renderer,
  onUpdateSettings,
  onResetCamera,
  onReplayHints,
  onClose,
}: SettingsModalProps) {
  if (!open) return null;

  return (
    <ModalShell labelledBy="settings-title" testId="settings-modal" onClose={onClose}>
        <div className="modal-header">
          <div>
            <h2 id="settings-title" className="modal-title">
              Studio Settings
            </h2>
            <p className="modal-subtitle">100% offline · synthesized in-browser</p>
          </div>
          <button
            type="button"
            className="sheet-mini-btn"
            onClick={onClose}
            aria-label="Close settings"
            data-testid="close-settings-btn"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="settings-list">
          <div className="setting-block">
            <div className="setting-row-top">
              <label htmlFor="master-volume" className="setting-label">
                {settings.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                <span>Master Volume</span>
              </label>
              <span className="setting-value">
                {settings.muted ? 'Muted' : `${Math.round(settings.volume * 100)}%`}
              </span>
            </div>
            <input
              id="master-volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.muted ? 0 : settings.volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onUpdateSettings(v === 0 ? { muted: true } : { volume: v, muted: false });
              }}
              className="volume-slider"
              aria-label="Master volume"
              data-testid="volume-slider"
            />
          </div>

          <div className="setting-toggle-row">
            <div className="setting-copy">
              <span className="setting-label">
                <VolumeX size={16} />
                <span>Mute Audio</span>
              </span>
              <span className="setting-desc">Silence all switch sound synthesis</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.muted}
              className={`toggle-pill ${settings.muted ? 'is-on' : ''}`}
              onClick={() => onUpdateSettings({ muted: !settings.muted })}
              aria-label="Toggle mute audio"
              data-testid="toggle-mute"
            >
              <span className="toggle-track"><span className="toggle-knob" /></span>
            </button>
          </div>

          <div className="setting-toggle-row">
            <div className="setting-copy">
              <span className="setting-label">
                <Gauge size={16} aria-hidden="true" />
                <span>Reduced Motion</span>
              </span>
              <span className="setting-desc">Disable particles, charm swing & camera drift</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.reducedMotion}
              className={`toggle-pill ${settings.reducedMotion ? 'is-on' : ''}`}
              onClick={() =>
                onUpdateSettings({ reducedMotion: !settings.reducedMotion })
              }
              aria-label="Toggle reduced motion"
              data-testid="toggle-reduced-motion"
            >
              <span className="toggle-track"><span className="toggle-knob" /></span>
            </button>
          </div>

          <div className="setting-toggle-row">
            <div className="setting-copy">
              <span className="setting-label">
                <Smartphone size={16} />
                <span>Haptic Feedback</span>
              </span>
              <span className="setting-desc">Subtle 8ms vibration pulse on supported devices</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.haptics}
              className={`toggle-pill ${settings.haptics ? 'is-on' : ''}`}
              onClick={() => onUpdateSettings({ haptics: !settings.haptics })}
              aria-label="Toggle haptic feedback"
              data-testid="toggle-haptics"
            >
              <span className="toggle-track"><span className="toggle-knob" /></span>
            </button>
          </div>

          <div className="settings-footer-actions">
            {renderer === '3d' && (
              <button
                type="button"
                className="secondary-pill-btn"
                onClick={() => {
                  onResetCamera();
                  onClose();
                }}
                data-testid="reset-camera-btn"
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>Reset Camera</span>
              </button>
            )}
            <button
              type="button"
              className="secondary-pill-btn"
              onClick={() => {
                onReplayHints();
                onClose();
              }}
              data-testid="replay-tips-btn"
            >
              <span>Show Quick Tips</span>
            </button>
          </div>

          <p className="shortcut-note" data-testid="renderer-note">
            <Box size={13} aria-hidden="true" />{' '}
            {renderer === '3d'
              ? 'Rendering in 3D · renders only while something moves, to save battery.'
              : '2D studio mode — 3D (WebGL) isn’t available on this device. Sounds and saving work the same.'}
          </p>
          <p className="shortcut-note" data-testid="shortcut-note">
            {renderer === '3d' ? (
              <>
                Tip: Press <kbd>Space</kbd> to click · Drag to orbit · Double-tap backdrop to reset angle.
              </>
            ) : (
              <>
                Tip: Press <kbd>Space</kbd> or <kbd>Enter</kbd> to click.
              </>
            )}
          </p>
        </div>
    </ModalShell>
  );
}
