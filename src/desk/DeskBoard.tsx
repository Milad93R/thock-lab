import type { CSSProperties } from 'react';
import type { BaseMaterial } from '../types/build';

type Cap = [code: string, legend: string, units?: number];
const digits: Cap[] = [...'1234567890'].map((digit) => ['Digit' + digit, digit]);
const letters = (row: string): Cap[] => [...row].map((letter) => ['Key' + letter, letter]);
const functions: Cap[] = Array.from({ length: 12 }, (_, index) => {
  const label = 'F' + (index + 1);
  return [label, label];
});

const rows: Cap[][] = [
  [['Escape', 'Esc'], ...functions, ['Delete', 'Del']],
  [['Backquote', '~'], ...digits, ['Minus', '−'], ['Equal', '='], ['Backspace', 'Back', 2], ['Home', 'Home']],
  [['Tab', 'Tab', 1.5], ...letters('QWERTYUIOP'), ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', 1.5], ['PageUp', 'PgUp']],
  [['CapsLock', 'Caps', 1.75], ...letters('ASDFGHJKL'), ['Semicolon', ';'], ['Quote', "'"], ['Enter', 'Enter', 2.25], ['PageDown', 'PgDn']],
  [['ShiftLeft', 'Shift', 2.25], ...letters('ZXCVBNM'), ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'Shift', 1.75], ['ArrowUp', '↑'], ['End', 'End']],
  [['ControlLeft', 'Ctrl', 1.25], ['MetaLeft', 'Meta', 1.25], ['AltLeft', 'Alt', 1.25], ['Space', '', 6.25], ['AltRight', 'Alt', 1], ['MetaRight', 'Meta'], ['ControlRight', 'Ctrl'], ['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→']],
];

export function DeskBoard({ pressed, base }: { pressed: ReadonlySet<string>; base: BaseMaterial }) {
  return (
    <div className="desk-board-stage" aria-hidden="true">
      <div className="desk-board" data-base={base} data-testid="desk-board">
        {rows.map((row) => (
          <div className="desk-board-row" key={row[0][0]}>
            {row.map(([code, legend, units = 1]) => (
              <div
                key={code}
                className="desk-key"
                data-code={code}
                data-down={pressed.has(code) || undefined}
                data-accent={code === 'Escape' || code === 'Enter'}
                style={{ '--units': units } as CSSProperties}
              >
                <span>{legend}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
