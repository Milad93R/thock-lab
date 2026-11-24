import { CSSProperties, KeyboardEvent, ReactNode, useId } from 'react';
import { Check, Dices, X } from 'lucide-react';
import walnutUrl from '../assets/textures/walnut.webp';
import aluminumUrl from '../assets/textures/brushed-aluminum.webp';
import { luminance } from '../lib/color';
import {
  BASE_MATERIALS,
  BaseMaterial,
  CHARM_CATALOG,
  ClickerBuild,
  COLOR_PALETTE,
  DailySwitchVariant,
  DailyVariantId,
  KEYCAP_FINISHES,
  KEYCAP_SHAPES,
  SWITCH_CATALOG,
} from '../types/build';
import { CharmIcon } from './CharmArt';

export type CustomizeTab = 'switch' | 'keycap' | 'base' | 'charm';

interface CustomizeSheetProps {
  open: boolean;
  activeTab: CustomizeTab;
  build: ClickerBuild;
  dailySwitch: DailySwitchVariant & { id: DailyVariantId };
  notification?: ReactNode;
  onSelectTab: (tab: CustomizeTab) => void;
  onChangeBuild: (patch: Partial<ClickerBuild>) => void;
  onRandomize: () => void;
  onClose: () => void;
  onPreviewClick: (overrideBuild?: ClickerBuild) => void;
}

const TABS: { id: CustomizeTab; label: string }[] = [
  { id: 'switch', label: 'Switch' },
  { id: 'keycap', label: 'Keycap' },
  { id: 'base', label: 'Base' },
  { id: 'charm', label: 'Charm' },
];

const BASE_TILE: Record<BaseMaterial, CSSProperties> = {
  wood: { backgroundColor: '#5A3822', backgroundImage: `url(${walnutUrl})`, backgroundSize: '220% auto', backgroundPosition: '30% 40%' },
  aluminum: {
    backgroundColor: '#B8BEC7',
    backgroundImage: `linear-gradient(105deg, rgba(255,255,255,.55), rgba(255,255,255,0) 40%, rgba(0,0,0,.08) 70%, rgba(255,255,255,.3)), url(${aluminumUrl})`,
    backgroundSize: 'auto, 220% auto',
  },
  acrylic: {
    backgroundColor: '#E4EFF7',
    backgroundImage:
      'linear-gradient(180deg, rgba(255,255,255,.95) 0 18%, rgba(205,225,240,.9) 18% 33%, rgba(255,255,255,.95) 33% 51%, rgba(205,225,240,.9) 51% 66%, rgba(255,255,255,.95) 66% 84%, rgba(205,225,240,.9) 84%)',
  },
  plastic: { backgroundColor: '#F3DFD4', backgroundImage: 'linear-gradient(145deg, #FBEFE8, #EBD3C7)' },
};

/** Tiny plan-view silhouettes so shape chips read at a glance. */
function ShapeGlyph({ shape }: { shape: string }) {
  const common = { fill: 'currentColor', opacity: 0.9 };
  switch (shape) {
    case 'round':
      return <circle cx="9" cy="9" r="6.5" {...common} />;
    case 'pill':
      return <rect x="1.5" y="4.5" width="15" height="9" rx="4.5" {...common} />;
    case 'low-profile':
      return <rect x="2" y="6" width="14" height="6" rx="2" {...common} />;
    case 'tall-artisan':
      return <path d="M4 15 L5.5 4.5 Q9 1.5 12.5 4.5 L14 15 Z" {...common} />;
    default:
      return <rect x="2.5" y="2.5" width="13" height="13" rx="3.5" {...common} />;
  }
}

export function CustomizeSheet({
  open,
  activeTab,
  build,
  dailySwitch,
  notification,
  onSelectTab,
  onChangeBuild,
  onRandomize,
  onClose,
  onPreviewClick,
}: CustomizeSheetProps) {
  const id = useId();
  if (!open) return null;

  const tabId = (tab: CustomizeTab) => `${id}-tab-${tab}`;
  const panelId = (tab: CustomizeTab) => `${id}-panel-${tab}`;
  const dailySelected = build.dailyVariantId === dailySwitch.id;
  const badgeInk = luminance(dailySwitch.accentColor) > 0.179 ? '#000' : '#fff';

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % TABS.length; break;
      case 'ArrowLeft': next = (index + TABS.length - 1) % TABS.length; break;
      case 'Home': next = 0; break;
      case 'End': next = TABS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const tab = TABS[next].id;
    onSelectTab(tab);
    document.getElementById(tabId(tab))?.focus();
  };

  return (
    <aside className="customize-sheet" aria-label="Customize clicker" data-testid="customize-sheet">
      <div className="sheet-header">
        <div className="sheet-tabs" role="tablist" aria-label="Customizer categories">
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-controls={panelId(tab.id)}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onKeyDown={(event) => navigateTabs(event, index)}
              aria-selected={activeTab === tab.id}
              className={`sheet-tab ${activeTab === tab.id ? 'is-active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="sheet-header-actions">
          <button
            type="button"
            className="sheet-mini-btn sheet-dice"
            onClick={onRandomize}
            aria-label="Randomize build"
            title="Randomize build"
            data-testid="sheet-dice-btn"
          >
            <Dices size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sheet-mini-btn"
            onClick={onClose}
            aria-label="Close customizer"
            data-testid="close-customizer-btn"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      {notification}

      {TABS.filter(({ id: tab }) => tab !== activeTab).map(({ id: tab }) => (
        <div key={tab} hidden role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} />
      ))}
      <div key={activeTab} className="sheet-body" role="tabpanel" id={panelId(activeTab)} aria-labelledby={tabId(activeTab)}>
        {activeTab === 'switch' && (
          <div className="sheet-panel" data-testid="panel-switch">
            <button
              type="button"
              className={`daily-card ${dailySelected ? 'is-selected' : ''}`}
              aria-pressed={dailySelected}
              onClick={() => {
                const next: ClickerBuild = { ...build, switchType: dailySwitch.baseSwitch, dailyVariantId: dailySwitch.id };
                onChangeBuild({ switchType: dailySwitch.baseSwitch, dailyVariantId: dailySwitch.id });
                onPreviewClick(next);
              }}
              data-testid="switch-option-daily"
            >
              <span className="daily-card-badge" style={{ backgroundColor: dailySwitch.accentColor, color: badgeInk }}>
                <span className="daily-card-dot" aria-hidden="true" />
                Switch of the Day
              </span>
              <span className="daily-card-title">{dailySwitch.name}</span>
              <span className="daily-card-sub">{dailySwitch.subtitle}</span>
            </button>

            <div className="option-grid option-grid-2">
              {SWITCH_CATALOG.map((sw) => {
                const selected = !build.dailyVariantId && build.switchType === sw.id;
                return (
                  <button
                    key={sw.id}
                    type="button"
                    className={`option-card ${selected ? 'is-selected' : ''}`}
                    onClick={() => {
                      const next: ClickerBuild = { ...build, switchType: sw.id, dailyVariantId: null };
                      onChangeBuild({ switchType: sw.id, dailyVariantId: null });
                      onPreviewClick(next);
                    }}
                    aria-pressed={selected}
                    data-testid={`switch-option-${sw.id}`}
                  >
                    <div className="option-card-top">
                      <span className="stem-dot" style={{ backgroundColor: sw.stemColor }} aria-hidden="true" />
                      <span className="option-title">{sw.name}</span>
                    </div>
                    <span className="option-sub">{sw.tagline}</span>
                    <span className="option-meta">{sw.travelMm.toFixed(1)} mm travel</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'keycap' && (
          <div className="sheet-panel" data-testid="panel-keycap">
            <div className="field-group">
              <div className="field-label">Shape</div>
              <div className="chip-row">
                {KEYCAP_SHAPES.map((shape) => {
                  const selected = build.keycapShape === shape.id;
                  return (
                    <button
                      key={shape.id}
                      type="button"
                      className={`chip-btn ${selected ? 'is-selected' : ''}`}
                      onClick={() => onChangeBuild({ keycapShape: shape.id })}
                      aria-pressed={selected}
                      title={shape.desc}
                      data-testid={`shape-option-${shape.id}`}
                    >
                      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="chip-glyph">
                        <ShapeGlyph shape={shape.id} />
                      </svg>
                      {shape.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field-group">
              <div className="field-label">Color</div>
              <div className="swatch-grid">
                {COLOR_PALETTE.map((swatch) => {
                  const selected = build.keycapColor.toLowerCase() === swatch.hex.toLowerCase();
                  return (
                    <button
                      key={swatch.hex}
                      type="button"
                      className={`swatch-btn ${selected ? 'is-selected' : ''}`}
                      style={{ backgroundColor: swatch.hex }}
                      onClick={() => onChangeBuild({ keycapColor: swatch.hex })}
                      aria-label={`Color ${swatch.name}`}
                      aria-pressed={selected}
                      title={swatch.name}
                      data-testid={`color-option-${swatch.hex.slice(1)}`}
                    >
                      {selected && (
                        <Check
                          size={15}
                          strokeWidth={3}
                          aria-hidden="true"
                          color={luminance(swatch.hex) > 0.45 ? '#1F1A17' : '#FFFFFF'}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field-group">
              <div className="field-label">Finish</div>
              <div className="chip-row">
                {KEYCAP_FINISHES.map((fin) => {
                  const selected = build.keycapFinish === fin.id;
                  return (
                    <button
                      key={fin.id}
                      type="button"
                      className={`chip-btn ${selected ? 'is-selected' : ''}`}
                      onClick={() => onChangeBuild({ keycapFinish: fin.id })}
                      aria-pressed={selected}
                      title={fin.desc}
                      data-testid={`finish-option-${fin.id}`}
                    >
                      <span className={`finish-dot finish-${fin.id}`} aria-hidden="true" />
                      {fin.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'base' && (
          <div className="sheet-panel" data-testid="panel-base">
            <p className="panel-hint">The base colors the sound of the switch chamber — tap one to hear it.</p>
            <div className="option-grid option-grid-2">
              {BASE_MATERIALS.map((bm) => {
                const selected = build.baseMaterial === bm.id;
                return (
                  <button
                    key={bm.id}
                    type="button"
                    className={`option-card base-card ${selected ? 'is-selected' : ''}`}
                    onClick={() => {
                      const next: ClickerBuild = { ...build, baseMaterial: bm.id };
                      onChangeBuild({ baseMaterial: bm.id });
                      onPreviewClick(next);
                    }}
                    aria-pressed={selected}
                    data-testid={`base-option-${bm.id}`}
                  >
                    <span className="base-tile" style={BASE_TILE[bm.id]} aria-hidden="true" />
                    <span className="option-title">{bm.name}</span>
                    <span className="option-sub">{bm.tone}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'charm' && (
          <div className="sheet-panel" data-testid="panel-charm">
            <p className="panel-hint">Hangs on a little brass chain and swings with spring physics on every press.</p>
            <div className="charm-grid">
              {CHARM_CATALOG.map((ch) => {
                const selected = build.charm === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    className={`charm-card ${selected ? 'is-selected' : ''}`}
                    onClick={() => onChangeBuild({ charm: ch.id })}
                    aria-pressed={selected}
                    data-testid={`charm-option-${ch.id}`}
                  >
                    <span className="charm-icon">
                      <CharmIcon charm={ch.id} size={40} />
                    </span>
                    <span className="charm-name">{ch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
