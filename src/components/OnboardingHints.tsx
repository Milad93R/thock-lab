import { ArrowRight, X } from 'lucide-react';

interface OnboardingHintsProps {
  step: number; // 0, 1, 2
  renderer: '3d' | '2d';
  onNext: () => void;
  onSkip: () => void;
}

function getHints(renderer: '3d' | '2d') {
  return [
    {
      title: 'Tap or hold the key',
      body: 'Each press synthesizes live Web Audio ASMR & builds your combo streak.',
    },
    renderer === '3d'
      ? {
          title: 'Drag to orbit in 3D',
          body: 'Inspect the switch stem and hanging charm. Double-tap the backdrop to reset.',
        }
      : {
          title: 'Press Space or tap fast',
          body: 'Hit 25×, 50× & 100× combo streaks, or tap the Daily Switch pill for today’s tune.',
        },
    {
      title: 'Craft & share your clicker',
      body: 'Open Customize to swap switches, caps, bases & charms — or roll the Dice.',
    },
  ];
}

export function OnboardingHints({ step, renderer, onNext, onSkip }: OnboardingHintsProps) {
  const hints = getHints(renderer);
  const hint = hints[step];
  if (!hint) return null;

  const isLast = step === hints.length - 1;

  return (
    <div
      className="onboarding-card"
      role="status"
      aria-live="polite"
      data-testid="onboarding-hint"
    >
      <div className="onboarding-top">
        <span className="onboarding-step">
          Tip {step + 1} of {hints.length}
        </span>
        <button
          type="button"
          className="onboarding-skip"
          onClick={onSkip}
          aria-label="Skip tips"
          data-testid="onboarding-skip-btn"
        >
          <span>Skip</span>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="onboarding-title">{hint.title}</div>
      <p className="onboarding-body">{hint.body}</p>
      <div className="onboarding-footer">
        <div className="onboarding-dots" aria-hidden="true">
          {hints.map((_, idx) => (
            <span
              key={idx}
              className={`onboarding-dot ${idx === step ? 'is-active' : ''}`}
            />
          ))}
        </div>
        <button
          type="button"
          className="onboarding-next-btn"
          onClick={onNext}
          data-testid="onboarding-next-btn"
        >
          <span>{isLast ? 'Got it' : 'Next'}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
