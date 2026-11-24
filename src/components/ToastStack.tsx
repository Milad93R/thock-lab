export type ToastAction = 'save' | 'share' | 'snap';

export interface ToastItem {
  id: string;
  message: string;
  tone?: 'default' | 'success' | 'gold';
  kind?: ToastAction | 'roll' | 'invalid';
  undo?: () => void;
}

interface ToastStackProps {
  toast: ToastItem | null;
}

/**
 * Permanent reserved toast lane. Always mounted so stage framing reserves its
 * exact rectangle per breakpoint and renders at most one toast at a time.
 */
export function ToastStack({ toast }: ToastStackProps) {
  return (
    <div className="toast-lane toast-stack" data-testid="toast-lane" aria-live="polite" aria-atomic="true">
      {toast && (
        <div
          key={toast.id}
          className={`toast-pill toast-${toast.tone ?? 'default'}${toast.undo ? ' toast-with-action' : ''}`}
          data-testid="toast-item"
        >
          {toast.message}
          {toast.undo && (
            <button type="button" className="toast-undo" onClick={toast.undo}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}
