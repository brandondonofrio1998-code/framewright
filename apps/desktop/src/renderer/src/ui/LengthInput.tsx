import { useState, type KeyboardEvent } from 'react';
import { formatLength, parseLength, type LengthFormat, type LengthParseContext } from '@framewright/core';

export function parseContextFor(format: LengthFormat): LengthParseContext {
  return format.system === 'imperial' ? { system: 'imperial' } : { system: 'metric', metricUnit: format.unit };
}

interface DraftField {
  /** Text being edited, or null when the field shows the committed value. */
  draft: string | null;
  error: string | null;
}

function useDraftField(): [DraftField, (next: DraftField) => void] {
  return useState<DraftField>({ draft: null, error: null });
}

/** Enter commits (via blur); Escape restores the committed value and keeps focus. */
function editKeys(event: KeyboardEvent<HTMLInputElement>, cancel: () => void): void {
  if (event.key === 'Enter') event.currentTarget.blur();
  if (event.key === 'Escape') cancel();
}

interface LengthInputProps {
  value: number;
  format: LengthFormat;
  label: string;
  /** Return an error message to reject the value, or null to accept it. */
  onCommit: (inches: number) => string | null;
  disabled?: boolean;
}

export function LengthInput({ value, format, label, onCommit, disabled = false }: LengthInputProps) {
  const [field, setField] = useDraftField();
  const formatted = formatLength(value, format);

  const commit = () => {
    if (field.draft === null) return;
    const parsed = parseLength(field.draft, parseContextFor(format));
    const error = parsed.ok ? onCommit(parsed.inches) : parsed.error;
    setField(error === null ? { draft: null, error: null } : { draft: field.draft, error });
  };

  return (
    <input
      className="field-input length-input"
      aria-label={label}
      aria-invalid={field.error !== null}
      title={field.error ?? undefined}
      value={field.draft ?? formatted}
      disabled={disabled}
      onFocus={(e) => {
        if (field.draft === null) setField({ draft: formatted, error: null });
        e.currentTarget.select();
      }}
      onChange={(e) => setField({ draft: e.target.value, error: field.error })}
      onBlur={commit}
      onKeyDown={(e) => editKeys(e, () => setField({ draft: null, error: null }))}
      spellCheck={false}
    />
  );
}

interface TextInputProps {
  value: string;
  label: string;
  onCommit: (text: string) => string | null;
}

export function TextInput({ value, label, onCommit }: TextInputProps) {
  const [field, setField] = useDraftField();

  const commit = () => {
    if (field.draft === null) return;
    const error = field.draft === value ? null : onCommit(field.draft);
    setField(error === null ? { draft: null, error: null } : { draft: field.draft, error });
  };

  return (
    <input
      className="field-input"
      aria-label={label}
      aria-invalid={field.error !== null}
      title={field.error ?? undefined}
      value={field.draft ?? value}
      onFocus={() => {
        if (field.draft === null) setField({ draft: value, error: null });
      }}
      onChange={(e) => setField({ draft: e.target.value, error: field.error })}
      onBlur={commit}
      onKeyDown={(e) => editKeys(e, () => setField({ draft: null, error: null }))}
      spellCheck={false}
    />
  );
}
