import { history, useDocument } from '../document/store';
import { notify, setSelection, useEditor } from './store';

export function isEditable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

export function deleteSelection(): void {
  const ids = useEditor.getState().selection;
  if (ids.length === 0) return;
  const result = history.dispatch('elements.delete', { ids });
  notify(result.ok ? null : result.error);
}

export function selectAll(): void {
  const { doc, activeLevelId } = useDocument.getState();
  setSelection(
    Object.values(doc.elements)
      .filter((el) => el.levelId === activeLevelId && el.kind !== 'wallNode')
      .map((el) => el.id),
  );
}
