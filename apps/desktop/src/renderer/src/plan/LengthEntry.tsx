import { useLayoutEffect, useRef, useState } from 'react';
import type { Vec2 } from '@framewright/core';

export interface LengthEntryState {
  length: string;
  angle: string;
  /** Screen position (CSS px within the plan view). */
  at: Vec2;
}

interface LengthEntryProps {
  state: LengthEntryState;
  onChange(state: LengthEntryState): void;
  /** Returns an error to keep the box open, or null when applied. */
  onCommit(length: string, angle: string): string | null;
  onCancel(): void;
}

/** Inline box that opens when you type while drawing: Enter applies, Tab moves to the angle, Escape cancels. */
export function LengthEntry({ state, onChange, onCommit, onCancel }: LengthEntryProps) {
  const lengthRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const input = lengthRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      setError(onCommit(state.length, state.angle));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="length-entry" style={{ left: state.at.x + 16, top: state.at.y + 16 }} role="group" aria-label="Typed length">
      <label className="length-entry-field">
        Length
        <input
          ref={lengthRef}
          className="field-input"
          aria-label="Wall length"
          aria-invalid={error !== null}
          value={state.length}
          onChange={(e) => onChange({ ...state, length: e.target.value })}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
      </label>
      <label className="length-entry-field">
        Angle
        <input
          className="field-input"
          aria-label="Wall angle"
          placeholder="auto"
          value={state.angle}
          onChange={(e) => onChange({ ...state, angle: e.target.value })}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
      </label>
      {error && (
        <p className="length-entry-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
