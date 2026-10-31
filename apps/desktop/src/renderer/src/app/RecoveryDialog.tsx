import { useEffect, useRef } from 'react';
import type { RecoveryEntry } from '../../../shared/ipc';

interface RecoveryDialogProps {
  entries: RecoveryEntry[];
  onRestore(entry: RecoveryEntry): void;
  onDiscard(entry: RecoveryEntry): void;
  onClose(): void;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'unknown time' : date.toLocaleString();
}

export function RecoveryDialog({ entries, onRestore, onDiscard, onClose }: RecoveryDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="modal" aria-labelledby="recovery-title" onCancel={onClose}>
      <h2 id="recovery-title" className="modal-title">
        Recover unsaved work
      </h2>
      <p className="modal-text">Framewright closed without saving these plans. Restore one to continue where you left off.</p>
      <ul className="recovery-list">
        {entries.map((entry) => (
          <li key={entry.docId} className="recovery-item">
            <div>
              <div className="recovery-name">{entry.title}</div>
              <div className="recovery-meta">
                Autosaved {when(entry.savedAt)}
                {entry.originalPath ? ` · ${entry.originalPath}` : ' · never saved'}
              </div>
            </div>
            <div className="recovery-actions">
              <button type="button" className="text-button primary" onClick={() => onRestore(entry)}>
                Restore
              </button>
              <button type="button" className="text-button" onClick={() => onDiscard(entry)}>
                Discard
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="modal-footer">
        <button type="button" className="text-button" onClick={onClose}>
          Decide later
        </button>
      </div>
    </dialog>
  );
}
