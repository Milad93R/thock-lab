import { BookmarkPlus, Plus, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { MAX_SHELF_SLOTS, SavedBuild } from '../storage/store';
import { BASE_MATERIALS, CHARM_CATALOG, getColorName, getSwitchLabel, KEYCAP_FINISHES, KEYCAP_SHAPES } from '../types/build';
import { ModalShell } from './ModalShell';

interface ShelfModalProps {
  open: boolean;
  shelf: SavedBuild[];
  onClose: () => void;
  onLoadBuild: (saved: SavedBuild) => void;
  onDeleteBuild: (saved: SavedBuild) => void;
  onSaveCurrent: (slot?: number) => void;
  notification?: ReactNode;
}

export function ShelfModal({ open, shelf, onClose, onLoadBuild, onDeleteBuild, onSaveCurrent, notification }: ShelfModalProps) {
  if (!open) return null;

  const slots = new Map(shelf.map((item) => [item.slot, item]));

  return (
    <ModalShell labelledBy="shelf-title" testId="shelf-modal" wide onClose={onClose}>
      <div className="modal-header">
        <div>
          <h2 id="shelf-title" className="modal-title">
            Your Shelf
          </h2>
          <p className="modal-subtitle">
            {shelf.length} / {MAX_SHELF_SLOTS} collector slots · saved on this device
          </p>
        </div>
        <div className="modal-header-actions">
          <button
            type="button"
            className="primary-pill-btn"
            onClick={() => onSaveCurrent()}
            disabled={shelf.length >= MAX_SHELF_SLOTS}
            data-testid="shelf-save-current-btn"
          >
            <BookmarkPlus size={16} aria-hidden="true" />
            <span className="hide-xs">Save current</span>
            <span className="show-xs">Save</span>
          </button>
          <button
            type="button"
            className="sheet-mini-btn"
            onClick={onClose}
            aria-label="Close Shelf"
            data-testid="close-shelf-btn"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {notification && <div className="shelf-notification">{notification}</div>}

      <div className="shelf-grid">
        {Array.from({ length: MAX_SHELF_SLOTS }, (_, index) => {
          const slot = index + 1;
          const item = slots.get(slot);
          if (!item) return (
            <button
              key={slot}
              type="button"
              className="shelf-slot is-empty"
              onClick={() => onSaveCurrent(slot)}
              aria-label={`Save current build to slot ${slot}`}
            >
              <span className="shelf-empty-plus" aria-hidden="true">
                <Plus size={18} />
              </span>
              <span className="shelf-empty-label">Slot {slot}</span>
            </button>
          );
          const colorName = getColorName(item.build.keycapColor);
          const switchName = getSwitchLabel(item.build);
          const shapeName = KEYCAP_SHAPES.find(({ id }) => id === item.build.keycapShape)?.name;
          const finishName = KEYCAP_FINISHES.find(({ id }) => id === item.build.keycapFinish)?.name;
          const description = `Slot ${slot}, ${colorName} · ${switchName} · ${shapeName} · ${finishName}`;
          const baseName = BASE_MATERIALS.find((b) => b.id === item.build.baseMaterial)?.short ?? item.build.baseMaterial;
          const charmName = CHARM_CATALOG.find((c) => c.id === item.build.charm)?.name ?? item.build.charm;
          return (
            <div key={slot} className="shelf-slot is-filled" data-testid="shelf-slot-filled" data-slot={slot}>
              <button
                type="button"
                className="shelf-slot-main"
                onClick={() => onLoadBuild(item)}
                aria-label={`Load saved build, ${description}`}
              >
                <div className="shelf-thumb-wrap">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" className="shelf-thumb" loading="lazy" />
                  ) : (
                    <div className="shelf-thumb-fallback" style={{ backgroundColor: item.build.keycapColor }} />
                  )}
                  <span className="shelf-slot-number" aria-hidden="true">Slot {slot}</span>
                </div>
                <div className="shelf-meta">
                  <span className="shelf-name" title={item.name}>
                    {colorName}
                  </span>
                  <span className="shelf-switch">
                    {item.build.dailyVariantId && <span className="shelf-daily-mark" aria-hidden="true" />}
                    {switchName}
                  </span>
                  <span className="shelf-tags">
                    {baseName} · {charmName}
                  </span>
                </div>
              </button>
              <button
                type="button"
                className="shelf-delete-btn"
                onClick={() => onDeleteBuild(item)}
                aria-label={`Delete ${description} from Shelf`}
                data-testid="shelf-delete-btn"
              >
                <span className="shelf-delete-face">
                  <Trash2 size={15} aria-hidden="true" />
                </span>
              </button>
            </div>
          );
        })}

      </div>
    </ModalShell>
  );
}
