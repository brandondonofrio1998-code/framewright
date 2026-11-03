import { produce } from 'immer';
import { TEXT_SIZE, type PlanDocument, type Vec2 } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Tool, ToolContext } from './types';

/** Click where the note goes, type it, and press Enter. */
export function createTextTool(): Tool {
  let anchor: Vec2 | null = null;
  let draft = '';

  const place = (ctx: ToolContext) => {
    if (!anchor) return;
    const text = draft.trim();
    if (text.length < 1) {
      ctx.notify('Type the note, then press Enter.');
      return;
    }
    const result = dispatch('text.create', { levelId: ctx.levelId(), p: anchor, text });
    ctx.notify(result.ok ? null : result.error);
    if (result.ok) {
      ctx.setSelection([result.value]);
      anchor = null;
      draft = '';
    }
    ctx.redraw();
  };

  return {
    id: 'text',
    cursor: 'crosshair',
    move(_e, ctx) {
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      if (anchor && draft.trim()) place(ctx);
      anchor = ctx.snap(e.model).p;
      draft = '';
      ctx.notify('Type the note, then press Enter.');
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key === 'Escape') {
        if (anchor) {
          anchor = null;
          draft = '';
          ctx.notify(null);
          ctx.redraw();
        } else ctx.setTool('select');
        return true;
      }
      if (!anchor) return false;
      if (e.key === 'Enter') {
        place(ctx);
        return true;
      }
      if (e.key === 'Backspace') {
        draft = draft.slice(0, -1);
        ctx.redraw();
        return true;
      }
      if (e.key.length === 1 && draft.length < 250) {
        draft += e.key;
        ctx.redraw();
        return true;
      }
      return false;
    },
    cancel() {
      anchor = null;
      draft = '';
    },
    preview(doc, ctx): PlanDocument | null {
      if (!anchor) return null;
      const at = anchor;
      const text = draft.length > 0 ? draft : 'Text';
      return produce(doc, (draftDoc) => {
        draftDoc.elements['text-preview'] = { id: 'text-preview', kind: 'text', levelId: ctx.levelId(), p: at, text, size: TEXT_SIZE };
      });
    },
  };
}
