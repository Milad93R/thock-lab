import { ReactNode, useEffect, useRef } from 'react';

interface ModalShellProps {
  labelledBy: string;
  testId: string;
  wide?: boolean;
  onClose: () => void;
  returnFocusTo?: HTMLElement;
  children: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog shell: traps Tab/Shift+Tab inside, moves focus in on open,
 * restores focus to the control that opened it, closes on backdrop click.
 */
export function ModalShell({ labelledBy, testId, wide, onClose, returnFocusTo, children }: ModalShellProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const opener = returnFocusTo ?? (document.activeElement as HTMLElement | null);
    const card = cardRef.current;
    const focusables = () =>
      card ? Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null) : [];
    // Focus the dialog itself (announces the title) without scrolling
    card?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !card) return;
      const list = focusables();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? list[index > 0 ? index - 1 : list.length - 1]
        : list[index + 1] ?? list[0];
      // Follow the dialog's control order even when Safari skips buttons during native Tab navigation.
      e.preventDefault();
      (next ?? card).focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, [returnFocusTo]);

  return (
    <div
      className="modal-backdrop"
      data-testid={testId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={`modal-card ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
