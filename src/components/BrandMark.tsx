import { useId } from 'react';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Thock Lab logo mark: a chunky vermilion keycap seated on a walnut plinth,
 * with the "thock" ripple that also echoes the floor pulse ring in the studio.
 */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`bm-top-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F58A6E" />
          <stop offset="1" stopColor="#EB6545" />
        </linearGradient>
        <linearGradient id={`bm-skirt-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D9512F" />
          <stop offset="1" stopColor="#B53E22" />
        </linearGradient>
        <linearGradient id={`bm-wood-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9A6646" />
          <stop offset="1" stopColor="#6E4329" />
        </linearGradient>
      </defs>
      <ellipse cx="24" cy="43.2" rx="19" ry="3" fill="#1F1A17" opacity="0.13" />
      <path d="M5 33.5 Q5 30 8.5 30 H39.5 Q43 30 43 33.5 V38.5 Q43 42 39.5 42 H8.5 Q5 42 5 38.5 Z" fill={`url(#bm-wood-${uid})`} />
      <path d="M6.5 32 Q6.5 30 8.5 30 H39.5 Q41.5 30 41.5 32 V33 H6.5 Z" fill="#B07A54" opacity="0.9" />
      <path d="M13.2 13.5 L9.4 29 Q8.8 33 12.6 33 H35.4 Q39.2 33 38.6 29 L34.8 13.5 Z" fill={`url(#bm-skirt-${uid})`} />
      <rect x="12.5" y="6" width="23" height="14.5" rx="4.6" fill={`url(#bm-top-${uid})`} />
      <ellipse cx="24" cy="13.4" rx="7.6" ry="4" fill="#E04F2F" opacity="0.42" />
      <path d="M15.5 9.2 Q24 7.4 32.5 9.2" stroke="#FFD9CC" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.9" />
    </svg>
  );
}
