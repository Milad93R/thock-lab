import { useId } from 'react';
import { CharmType } from '../types/build';

/**
 * Hand-drawn SVG charm silhouettes (48×48 space, hang point at top centre ≈ (24, 5)).
 * Used by the Customize → Charm cards and the 2D (no-WebGL) clicker, so both match.
 * Every charm carries a darker outline so pale charms (ghost, cloud, dice) stay
 * legible on white cards. Uses per-instance gradient IDs so multiple SVGs on the page
 * (e.g. the 2D clicker and the Customize charm cards) never collide.
 */
export function CharmArt({ charm }: { charm: CharmType }) {
  const uid = useId().replace(/:/g, '');
  const gradId = `ch-${charm}-${uid}`;

  switch (charm) {
    case 'star':
      return (
        <g key="star">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0" stopColor="#FFE07A" />
              <stop offset="1" stopColor="#F0A626" />
            </linearGradient>
          </defs>
          <circle cx="24" cy="6.5" r="2.6" fill="none" stroke="#C99A3E" strokeWidth="1.6" />
          <path
            d="M24 9.5 L28.7 19.3 L39.4 20.6 L31.5 28 L33.6 38.6 L24 33.3 L14.4 38.6 L16.5 28 L8.6 20.6 L19.3 19.3 Z"
            fill={`url(#${gradId})`}
            stroke="#D38A1C"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M18.2 22.4 Q20.5 20.6 23 21" stroke="#FFF6D6" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <circle cx="21" cy="27" r="1.3" fill="#3A2A1E" />
          <circle cx="27" cy="27" r="1.3" fill="#3A2A1E" />
          <path d="M22.4 30 Q24 31.4 25.6 30" stroke="#3A2A1E" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'cherry':
      return (
        <g key="cherry">
          <defs>
            <radialGradient id={gradId} cx="0.35" cy="0.3" r="0.75">
              <stop offset="0" stopColor="#FF7A86" />
              <stop offset="0.55" stopColor="#DA2F47" />
              <stop offset="1" stopColor="#A31830" />
            </radialGradient>
          </defs>
          <circle cx="24" cy="6.5" r="2.6" fill="none" stroke="#C99A3E" strokeWidth="1.6" />
          <path d="M24 9 Q19 18 15.5 27" stroke="#4B8E56" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M24 9 Q28 18 31.5 29" stroke="#4B8E56" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M24.5 10 Q31 7.5 35 11.5 Q29.5 14.5 24.5 10 Z" fill="#6FB46B" stroke="#3F7F49" strokeWidth="1.1" />
          <circle cx="15.5" cy="32.5" r="7.6" fill={`url(#${gradId})`} stroke="#8F1428" strokeWidth="1.2" />
          <circle cx="31.5" cy="34" r="7.2" fill={`url(#${gradId})`} stroke="#8F1428" strokeWidth="1.2" />
          <ellipse cx="13.2" cy="29.8" rx="2" ry="1.3" fill="#FFD6DB" opacity="0.85" />
          <ellipse cx="29.4" cy="31.4" rx="1.9" ry="1.2" fill="#FFD6DB" opacity="0.85" />
        </g>
      );
    case 'cloud':
      return (
        <g key="cloud">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#D7E6FA" />
            </linearGradient>
          </defs>
          <circle cx="24" cy="6.5" r="2.6" fill="none" stroke="#C99A3E" strokeWidth="1.6" />
          <path
            d="M13 35 Q6.5 35 6.5 29 Q6.5 23.5 12.5 23 Q13 15.5 20.5 15 Q24 10.5 29 13.5 Q35.5 14 36 21 Q42 22 41.5 28.5 Q41 35 34.5 35 Z"
            fill={`url(#${gradId})`}
            stroke="#93AED6"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="20" cy="26.5" r="1.4" fill="#2E2A3A" />
          <circle cx="28" cy="26.5" r="1.4" fill="#2E2A3A" />
          <ellipse cx="16.8" cy="29.6" rx="2" ry="1.1" fill="#F6A5B7" opacity="0.8" />
          <ellipse cx="31.2" cy="29.6" rx="2" ry="1.1" fill="#F6A5B7" opacity="0.8" />
          <path d="M22.4 29 Q24 30.3 25.6 29" stroke="#2E2A3A" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'ghost':
      return (
        <g key="ghost">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#E4DEF6" />
            </linearGradient>
          </defs>
          <circle cx="24" cy="6.5" r="2.6" fill="none" stroke="#C99A3E" strokeWidth="1.6" />
          <path
            d="M13 40 V22 Q13 10 24 10 Q35 10 35 22 V40 Q32.2 37.4 29.5 40 Q26.8 42.6 24 40 Q21.2 37.4 18.5 40 Q15.8 42.6 13 40 Z"
            fill={`url(#${gradId})`}
            stroke="#A89BD2"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <ellipse cx="20.2" cy="22.5" rx="1.7" ry="2.2" fill="#2E2A3A" />
          <ellipse cx="27.8" cy="22.5" rx="1.7" ry="2.2" fill="#2E2A3A" />
          <ellipse cx="17.4" cy="26.6" rx="2" ry="1.1" fill="#F6A5B7" opacity="0.85" />
          <ellipse cx="30.6" cy="26.6" rx="2" ry="1.1" fill="#F6A5B7" opacity="0.85" />
          <ellipse cx="24" cy="27.6" rx="1.6" ry="1.2" fill="#2E2A3A" />
        </g>
      );
    case 'mushroom':
      return (
        <g key="mushroom">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#F26A55" />
              <stop offset="1" stopColor="#C9352B" />
            </linearGradient>
          </defs>
          <circle cx="24" cy="6.5" r="2.6" fill="none" stroke="#C99A3E" strokeWidth="1.6" />
          <path d="M19 27 Q18.4 36 17.8 39 Q24 41.6 30.2 39 Q29.6 36 29 27 Z" fill="#F7EDDD" stroke="#C9B394" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M7.5 27.5 Q7.5 10 24 10 Q40.5 10 40.5 27.5 Q24 31.5 7.5 27.5 Z" fill={`url(#${gradId})`} stroke="#9E2620" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="17" cy="18" r="2.8" fill="#FFF8EC" />
          <circle cx="28.5" cy="15.5" r="2.2" fill="#FFF8EC" />
          <circle cx="33.5" cy="23" r="2" fill="#FFF8EC" />
          <circle cx="23" cy="24" r="1.7" fill="#FFF8EC" />
          <circle cx="21.6" cy="33.5" r="1.2" fill="#3A2A1E" />
          <circle cx="26.4" cy="33.5" r="1.2" fill="#3A2A1E" />
        </g>
      );
    case 'cat':
      return (
        <g key="cat">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#F8CB98" />
              <stop offset="1" stopColor="#E9A564" />
            </linearGradient>
          </defs>
          <circle cx="24" cy="6.5" r="2.6" fill="none" stroke="#C99A3E" strokeWidth="1.6" />
          <path
            d="M10.5 22 L11.5 9.5 L19.5 15.2 Q24 14 28.5 15.2 L36.5 9.5 L37.5 22 Q39.5 27 37 32 Q32.5 39.5 24 39.5 Q15.5 39.5 11 32 Q8.5 27 10.5 22 Z"
            fill={`url(#${gradId})`}
            stroke="#B8763A"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M13.4 13.6 L14 19.4 L17.6 16.4 Z" fill="#F29DA8" />
          <path d="M34.6 13.6 L34 19.4 L30.4 16.4 Z" fill="#F29DA8" />
          <path d="M20.5 16.5 Q21.5 19 20.5 21" stroke="#D88A48" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <path d="M27.5 16.5 Q26.5 19 27.5 21" stroke="#D88A48" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <ellipse cx="18.8" cy="26" rx="1.7" ry="2.1" fill="#2E2A3A" />
          <ellipse cx="29.2" cy="26" rx="1.7" ry="2.1" fill="#2E2A3A" />
          <path d="M22.6 29.4 L25.4 29.4 L24 31 Z" fill="#E77F8E" />
          <path d="M24 31 Q22.6 33 21 32.2 M24 31 Q25.4 33 27 32.2" stroke="#7A4A2C" strokeWidth="1" strokeLinecap="round" fill="none" />
          <path d="M8 28.5 L15 29.4 M8.4 32.4 L15 31.2 M40 28.5 L33 29.4 M39.6 32.4 L33 31.2" stroke="#7A4A2C" strokeWidth="0.9" strokeLinecap="round" opacity="0.7" />
        </g>
      );
    case 'dice':
      return (
        <g key="dice">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#ECE3D4" />
            </linearGradient>
          </defs>
          <circle cx="24" cy="6.5" r="2.6" fill="none" stroke="#C99A3E" strokeWidth="1.6" />
          <path d="M14 15.5 L24 10.5 L34 15.5 L24 20.5 Z" fill="#FBF7F0" stroke="#B5A88F" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M14 15.5 L24 20.5 V40 L14 35 Z" fill={`url(#${gradId})`} stroke="#B5A88F" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M34 15.5 L24 20.5 V40 L34 35 Z" fill="#E4D9C6" stroke="#B5A88F" strokeWidth="1.4" strokeLinejoin="round" />
          <ellipse cx="24" cy="15.5" rx="1.9" ry="1.1" fill="#D8433A" />
          <ellipse cx="16.8" cy="21.6" rx="1.2" ry="1.5" fill="#2A2420" />
          <ellipse cx="21.2" cy="24" rx="1.2" ry="1.5" fill="#2A2420" />
          <ellipse cx="19" cy="28.6" rx="1.2" ry="1.5" fill="#2A2420" />
          <ellipse cx="16.8" cy="33.2" rx="1.2" ry="1.5" fill="#2A2420" />
          <ellipse cx="21.2" cy="35.6" rx="1.2" ry="1.5" fill="#2A2420" />
          <ellipse cx="28.6" cy="24.8" rx="1.2" ry="1.5" fill="#2A2420" />
          <ellipse cx="31.2" cy="31.2" rx="1.2" ry="1.5" fill="#2A2420" />
        </g>
      );
  }
}

export function CharmIcon({ charm, size = 40 }: { charm: CharmType; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <CharmArt charm={charm} />
    </svg>
  );
}
