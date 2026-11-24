import type { CSSProperties } from 'react';
import type { BaseMaterial } from '../types/build';

type Cap = [code: string, legend: string, units?: number, compact?: string];
const digits: Cap[] = [...'1234567890'].map((digit) => ['Digit' + digit, digit]);
const letters = (row: string): Cap[] => [...row].map((letter) => ['Key' + letter, letter]);
const functions: Cap[] = Array.from({ length: 12 }, (_, index) => {
  const label = 'F' + (index + 1);
  return [label, label];
});

const rows: Cap[][] = [
  [['Escape', 'Esc'], ...functions, ['Delete', 'Del']],
  [['Backquote', '~'], ...digits, ['Minus', '−'], ['Equal', '='], ['Backspace', 'Back', 2, 'Bk'], ['Home', 'Home', 1, 'Hm']],
  [['Tab', 'Tab', 1.5], ...letters('QWERTYUIOP'), ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', 1.5], ['PageUp', 'PgUp', 1, 'PU']],
  [['CapsLock', 'Caps', 1.75, 'Cap'], ...letters('ASDFGHJKL'), ['Semicolon', ';'], ['Quote', "'"], ['Enter', 'Enter', 2.25, 'Ent'], ['PageDown', 'PgDn', 1, 'PD']],
  [['ShiftLeft', 'Shift', 2.25, 'Shf'], ...letters('ZXCVBNM'), ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'Shift', 1.75, 'Shf'], ['ArrowUp', '↑'], ['End', 'End', 1, 'En']],
  [
    ['ControlLeft', 'Ctrl', 1.25, 'Ct'],
    ['MetaLeft', 'Meta', 1.25, 'Mt'],
    ['AltLeft', 'Alt', 1.25, 'Al'],
    ['Space', '', 6.25],
    ['AltRight', 'Alt', 1, 'Al'],
    ['MetaRight', 'Meta', 1, 'Mt'],
    ['ControlRight', 'Ctrl', 1, 'Ct'],
    ['ArrowLeft', '←'],
    ['ArrowDown', '↓'],
    ['ArrowRight', '→'],
  ],
];

export function DeskBoard({ pressed, base }: { pressed: ReadonlySet<string>; base: BaseMaterial }) {
  return (
    <div className="desk-board-stage" aria-hidden="true">
      <div className="desk-board" data-base={base} data-testid="desk-board">
        {rows.map((row) => (
          <div className="desk-board-row" key={row[0][0]}>
            {row.map(([code, legend, units = 1, compact]) => {
              const multi = legend.length > 1 || (compact ? compact.length > 1 : false);
              return (
                <div
                  key={code}
                  className="desk-key"
                  data-code={code}
                  data-down={pressed.has(code) || undefined}
                  data-accent={code === 'Escape' || code === 'Enter'}
                  data-multi={multi || undefined}
                  style={{ '--units': units } as CSSProperties}
                >
                  <span>
                    {compact ? (
                      <>
                        <b className="desk-legend-full">{legend}</b>
                        <b className="desk-legend-compact">{compact}</b>
                      </>
                    ) : (
                      legend
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
