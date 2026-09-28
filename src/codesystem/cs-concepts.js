// <cs-concepts>: the concepts as a spreadsheet. One row per concept, in
// hierarchy order (the code column is indented, with a twisty to collapse), and
// columns for code, display, definition and each defined property.
//
// Double-click a code (or Alt+Enter, or the Details button) to see everything
// about the concept - designations, repeated or Coding property values, children
// - in <cs-concept-detail>, in a dialog.
//
// Only the rows in view are rendered, so big code systems stay responsive.
//
// Selection is held by the editor as a path (editor.selectedPath) so that undo
// can restore it. Collapsed state is keyed by code, so it survives moves and undo.

import { LitElement, html, css, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import { controls } from '../core/styles.js';
import './cs-concept-detail.js';
import {
  walk, getConcept, childrenOf, insertConcept, insertSiblingAfter, removeConcept, moveConcept,
  indentConcept, outdentConcept, reparentConcept, uniqueCode, searchConcepts, pathKey,
  retargetCodeReferences, valueKeyOf, valueKeyForType, typeOfValueKey, parsePropertyValue,
  countConcepts, isConceptReferenceProperty, propertyValues, setSingleProperty
} from './model.js';

const AUTO_COLLAPSE_OVER = 1000;
const ROW_H = 28;      // px - rows must all be this height for the virtual scrolling
const HEAD_H = 34;
const OVERSCAN = 15;   // rows rendered beyond the visible ones

const WIDTHS_KEY = 'fhir-editors.codesystem.column-widths';
const MIN_COL = 40;    // px
const DEFAULT_COL = { code: '18em', display: '16em', definition: '26em', prop: '10em' };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD = isMac ? '⌘' : 'Ctrl+';

export class CsConcepts extends LitElement {
  static properties = {
    editor: { attribute: false },
    revision: { type: Number },
    ro: { type: Boolean },  // read-only; passed so that a change re-renders
    issues: { attribute: false },
    selectedPath: { attribute: false },
    _search: { state: true },
    _drop: { state: true },
    _detailPath: { state: true },
    _scrollTop: { state: true },
    _viewH: { state: true }
  };

  static styles = [controls, css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .toolbar { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; align-items: center; }
    .toolbar .sep { width: 6px; }
    .toolbar input[type=search] { flex: 1; min-width: 12em; max-width: 30em; margin-left: 8px; }
    .scroll {
      flex: 1; min-height: 150px; overflow: auto; position: relative;
      border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_bg);
    }
    .row { display: grid; grid-template-columns: var(--cols); height: ${ROW_H}px; min-width: 100%; width: max-content; }
    .row > * { border-right: 1px solid var(--_border); border-bottom: 1px solid var(--_border); min-width: 0; }
    .row.head {
      position: sticky; top: 0; z-index: 2; height: ${HEAD_H}px; background: var(--_surface);
      font-weight: 600; color: var(--_muted);
    }
    /* font-size on the cells, not the row: the column widths are in em */
    .row.head > div { font-size: 0.82em; padding: 2px 6px; display: flex; flex-direction: column; justify-content: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .row.head .type { font-weight: normal; font-size: 0.9em; }
    .row.head > div { position: relative; }
    .resizer {
      position: absolute; top: 0; right: -1px; width: 7px; height: 100%; cursor: col-resize;
      touch-action: none; z-index: 1;
    }
    .resizer:hover, .resizer.active { background: var(--_accent); opacity: 0.5; }
    .row.sel > * { background: var(--_select); }
    .row.dim input, .row.dim select, .row.dim .text { opacity: 0.5; }
    .row.drop-before > * { box-shadow: inset 0 2px 0 var(--_accent); }
    .row.drop-after > * { box-shadow: inset 0 -2px 0 var(--_accent); }
    .row.drop-into > * { background: var(--_select); box-shadow: inset 0 0 0 1px var(--_accent); }
    .cell input, .cell select {
      width: 100%; height: 100%; border: none; border-radius: 0; background: transparent; padding: 0 6px;
    }
    .cell select { padding: 0 2px; }
    .cell input:focus, .cell select:focus { outline: 2px solid var(--_accent); outline-offset: -2px; background: var(--_bg); }
    .cell input.invalid { color: var(--_error); box-shadow: inset 0 -2px 0 var(--_error); }
    .code { display: flex; align-items: center; }
    .code input { font-family: var(--_mono); font-size: 0.92em; cursor: text; }
    .twisty { flex: none; width: 16px; text-align: center; color: var(--_muted); cursor: pointer; font-size: 0.75em; user-select: none; }
    .grip { cursor: grab; color: var(--_muted); text-align: center; line-height: ${ROW_H - 1}px; user-select: none; font-size: 0.8em; }
    .text { padding: 0 6px; line-height: ${ROW_H - 1}px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: default; }
    .text.multi { color: var(--_muted); font-style: italic; }
    .marks { display: flex; align-items: center; justify-content: center; gap: 3px; font-size: 0.75em; cursor: pointer; }
    .badge { color: var(--_muted); border: 1px solid var(--_border); border-radius: 8px; padding: 0 4px; font-size: 0.9em; }
    mark { background: #fde68a; color: inherit; }
    .empty { padding: 20px; text-align: center; color: var(--_muted); }
    .hint { font-size: 0.8em; color: var(--_muted); margin-top: 4px; }
    dialog {
      width: min(960px, 92vw); max-height: 88vh; padding: 0; border: 1px solid var(--_border);
      border-radius: 6px; background: var(--_bg); color: var(--_fg); overflow: hidden;
    }
    dialog[open] { display: flex; flex-direction: column; }
    dialog::backdrop { background: rgba(0, 0, 0, 0.35); }
    dialog header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--_surface); border-bottom: 1px solid var(--_border); }
    dialog header .t { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    dialog .body { overflow: auto; padding: 12px; }
  `];

  constructor() {
    super();
    this._search = '';
    this._collapsed = new Set();
    this._autoCollapsedFor = null;
    this._drop = null;
    this._detailPath = null;
    this._scrollTop = 0;
    this._viewH = 600;
    this._cellErrors = new Map();
    this._codeAtFocus = null;
    this._rows = [];
    this._pendingFocus = null;
    this._widths = loadWidths();
  }

  get _r() { return this.editor.resource; }
  get _sel() { return this.editor.selectedPath; }
  get _scroller() { return this.renderRoot.querySelector('.scroll'); }

  connectedCallback() {
    super.connectedCallback();
    this._resize = new ResizeObserver(() => {
      const h = this._scroller?.clientHeight;
      if (h && h !== this._viewH) this._viewH = h;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resize?.disconnect();
  }

  firstUpdated() {
    this._resize.observe(this._scroller);
    this._viewH = this._scroller.clientHeight || this._viewH;
  }

  // --- rows ----------------------------------------------------------------------

  _visibleRows() {
    const rows = [];
    const r = this._r;
    if (this._search.trim()) {
      const hits = searchConcepts(r, this._search);
      const hitKeys = new Set(hits.map(pathKey));
      const show = new Set();
      for (const h of hits) for (let i = 1; i <= h.length; i++) show.add(pathKey(h.slice(0, i)));
      walk(r, (c, path, depth) => {
        const k = pathKey(path);
        if (show.has(k)) rows.push({ c, path, key: k, depth, hit: hitKeys.has(k), open: true });
      });
      return { rows, hits };
    }
    const visit = (list, prefix, depth) => {
      list.forEach((c, i) => {
        const path = [...prefix, i];
        const open = !this._collapsed.has(c.code);
        rows.push({ c, path, key: pathKey(path), depth, open });
        if (c.concept && open) visit(c.concept, path, depth + 1);
      });
    };
    visit(r.concept || [], [], 0);
    return { rows, hits: null };
  }

  _toggle(c) {
    if (this._collapsed.has(c.code)) this._collapsed.delete(c.code); else this._collapsed.add(c.code);
    this.requestUpdate();
  }

  _setAll(open) {
    walk(this._r, c => {
      if (!c.concept) return;
      if (open) this._collapsed.delete(c.code); else this._collapsed.add(c.code);
    });
    if (!open && this._sel?.length > 1) this.editor.selectedPath = this._sel.slice(0, 1);
    this.requestUpdate();
  }

  // --- selection and focus -------------------------------------------------------

  /** Selects a concept, expanding its ancestors and scrolling it into view. */
  select(path, { focusCol = null, selectText = false } = {}) {
    this.editor.selectedPath = path;
    if (!path) return;
    for (let i = 1; i < path.length; i++) {
      const a = getConcept(this._r, path.slice(0, i));
      if (a) this._collapsed.delete(a.code);
    }
    this._pendingFocus = { key: pathKey(path), col: focusCol, selectText, scroll: true };
    this.requestUpdate();
  }

  _ensureVisible(index) {
    const el = this._scroller;
    if (!el) return;
    const top = index * ROW_H;
    const viewRows = el.clientHeight - HEAD_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + viewRows) el.scrollTop = top + ROW_H - viewRows;
    this._scrollTop = el.scrollTop;
  }

  _onScroll() {
    if (this._scrollRaf) return;
    this._scrollRaf = requestAnimationFrame(() => {
      this._scrollRaf = null;
      this._scrollTop = this._scroller.scrollTop;
    });
  }

  _onFocusIn(e) {
    const cell = e.composedPath().find(n => n.dataset?.key !== undefined && n.dataset?.col !== undefined);
    if (!cell) return;
    const row = this._rows.find(r => r.key === cell.dataset.key);
    if (row && (!this._sel || pathKey(this._sel) !== row.key)) this.editor.selectedPath = row.path;
  }

  // --- editing operations --------------------------------------------------------

  _new() {
    return { code: uniqueCode(this._r), display: '' };
  }

  addTop() {
    const p = this.editor.change(r => insertConcept(r, [], this._new()));
    if (p) this.select(p, { focusCol: 'code', selectText: true });
  }

  addSibling() {
    if (!this._sel) return this.addTop();
    const p = this.editor.change(r => insertSiblingAfter(r, this._sel, this._new()));
    if (p) this.select(p, { focusCol: 'code', selectText: true });
  }

  addChild() {
    if (!this._sel) return this.addTop();
    this._collapsed.delete(getConcept(this._r, this._sel)?.code);
    const p = this.editor.change(r => insertConcept(r, this._sel, this._new()));
    if (p) this.select(p, { focusCol: 'code', selectText: true });
  }

  deleteSelected() {
    const path = this._sel;
    if (!path) return;
    const c = getConcept(this._r, path);
    const n = c?.concept ? countConcepts({ concept: c.concept }) : 0;
    const col = this._focusedCol();
    this.editor.change(r => removeConcept(r, path));
    if (n) this.editor.message = { severity: 'information', text: `Deleted "${c.code}" and ${n} descendant(s) (Undo to restore)` };
    const siblings = childrenOf(this._r, path.slice(0, -1));
    const i = path[path.length - 1];
    if (siblings.length) this.select([...path.slice(0, -1), Math.min(i, siblings.length - 1)], { focusCol: col });
    else this.select(path.length > 1 ? path.slice(0, -1) : null, { focusCol: col });
  }

  _op(fn, possible) {
    const path = this._sel;
    if (!path || !possible(path, childrenOf(this._r, path.slice(0, -1)).length)) return;
    const col = this._focusedCol();
    const result = this.editor.change(r => fn(r, path));
    if (result) {
      if (result.length > 1) this._collapsed.delete(getConcept(this._r, result.slice(0, -1))?.code);
      this.select(result, { focusCol: col });
    }
  }

  moveUp() { this._op((r, p) => moveConcept(r, p, -1), p => p[p.length - 1] > 0); }
  moveDown() { this._op((r, p) => moveConcept(r, p, 1), (p, n) => p[p.length - 1] < n - 1); }
  indent() { this._op(indentConcept, p => p[p.length - 1] > 0); }
  outdent() { this._op(outdentConcept, p => p.length > 1); }

  _focusedCol() {
    const a = this.renderRoot.activeElement;
    return a?.dataset?.col ?? null;
  }

  // --- details dialog ------------------------------------------------------------

  async openDetails(path = this._sel) {
    if (!path || !getConcept(this._r, path)) return;
    this.editor.selectedPath = path;
    this._detailPath = path;
    await this.updateComplete;
    const d = this.renderRoot.querySelector('dialog');
    if (!d.open) d.showModal();
  }

  _closeDetails() {
    const d = this.renderRoot.querySelector('dialog');
    if (d?.open) d.close();
  }

  _dialogClosed() {
    const path = this._detailPath;
    this._detailPath = null;
    if (path && getConcept(this._r, path)) this.select(path, { focusCol: 'code' });
  }

  // --- cell editing --------------------------------------------------------------

  _setField(path, field, value) {
    this.editor.change(r => {
      const c = getConcept(r, path);
      if (!c) return;
      if (value === '' || value === undefined) delete c[field]; else c[field] = value;
    }, { coalesce: `cell:${pathKey(path)}:${field}` });
  }

  _codeFocus(row) {
    this._codeAtFocus = { key: row.key, code: row.c.code };
  }

  _codeChange(row) {
    const f = this._codeAtFocus;
    const now = getConcept(this._r, row.path)?.code;
    this._codeAtFocus = { key: row.key, code: now };
    if (!f || f.key !== row.key || !f.code || !now || f.code === now) return;
    // collapsed state is keyed by code
    if (this._collapsed.delete(f.code)) this._collapsed.add(now);
    let n = 0;
    this.editor.change(r => { n = retargetCodeReferences(r, f.code, now); });
    if (n) this.editor.message = { severity: 'information', text: `Updated ${n} property reference(s) from "${f.code}" to "${now}"` };
  }

  _setProp(row, def, value) {
    this.editor.change(r => setSingleProperty(r, row.path, def.code, def.type, value),
      { coalesce: `cell:${row.key}:p:${def.code}` });
  }

  _propCell(row, def, col) {
    const ro = this.editor.isReadOnly;
    const values = propertyValues(row.c, def.code);
    const cellAttrs = { key: row.key, col };
    const text = (content, cls = '', title = '') => html`<div class="cell text ${cls}" title=${title || nothing}
      @dblclick=${() => this.openDetails(row.path)}>${content}</div>`;
    if (values.length > 1) {
      const all = values.map(v => { const k = valueKeyOf(v); return k ? JSON.stringify(v[k]) : '?'; }).join(', ');
      return text(`${values.length} values`, 'multi', `${all} - double-click to edit`);
    }
    const p = values[0];
    const key = p && valueKeyOf(p);
    if (key && def.type && key !== valueKeyForType(def.type)) {
      return text(html`<span class="sev-error">${typeOfValueKey(key)}: ${JSON.stringify(p[key])}</span>`, '', `The value is a ${typeOfValueKey(key)}, but the property is a ${def.type}`);
    }
    const value = key ? p[key] : undefined;
    switch (def.type) {
      case 'boolean':
        return html`<div class="cell"><select data-key=${cellAttrs.key} data-col=${col} aria-label=${def.code} ?disabled=${ro}
            @change=${e => this._setProp(row, def, e.target.value === '' ? undefined : e.target.value === 'true')}>
          <option value="" ?selected=${value === undefined}></option>
          <option value="true" ?selected=${value === true}>true</option>
          <option value="false" ?selected=${value === false}>false</option></select></div>`;
      case 'Coding':
        return text(value ? `${value.display || value.code || ''}${value.display && value.code ? ` (${value.code})` : ''}` : '', '',
          value ? `${value.system || ''}|${value.code || ''} - double-click to edit` : 'double-click to edit');
      case 'integer':
      case 'decimal': {
        const ek = `${row.key}|${def.code}`;
        const err = this._cellErrors.get(ek);
        return html`<div class="cell"><input data-key=${cellAttrs.key} data-col=${col} aria-label=${def.code} inputmode="decimal"
          class=${err ? 'mono invalid' : 'mono'} title=${err?.message || nothing} ?readonly=${ro}
          .value=${live(err ? err.text : value === undefined ? '' : String(value))}
          @input=${e => {
            const t = e.target.value.trim();
            if (t === '') { this._cellErrors.delete(ek); this._setProp(row, def, undefined); return; }
            const parsed = parsePropertyValue(def.type, t);
            if (parsed.error) { this._cellErrors.set(ek, { text: e.target.value, message: `${parsed.error} - not saved` }); this.requestUpdate(); }
            else { this._cellErrors.delete(ek); this._setProp(row, def, parsed.value); }
          }}></div>`;
      }
      default: {
        const mono = def.type === 'code' || def.type === 'dateTime';
        return html`<div class="cell"><input data-key=${cellAttrs.key} data-col=${col} aria-label=${def.code} class=${mono ? 'mono' : ''}
          list=${isConceptReferenceProperty(def) ? 'cs-codes' : nothing} placeholder=${def.type === 'dateTime' ? '' : nothing}
          ?readonly=${ro} .value=${live(value ?? '')}
          @input=${e => {
            const v = def.type === 'string' ? e.target.value : e.target.value.trim();
            this._setProp(row, def, v === '' ? undefined : v);
          }}></div>`;
      }
    }
  }

  // --- keyboard ------------------------------------------------------------------

  _onKey(e) {
    const target = e.composedPath()[0];
    const key = target?.dataset?.key;
    const col = target?.dataset?.col;
    if (key === undefined || col === undefined) return;
    const rows = this._rows;
    const idx = rows.findIndex(r => r.key === key);
    if (idx < 0) return;
    const mod = e.ctrlKey || e.metaKey;
    const ro = this.editor.isReadOnly;
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    const go = i => { if (i >= 0 && i < rows.length) this.select(rows[i].path, { focusCol: col }); };

    if (e.altKey && e.key === 'Enter') { done(); this.openDetails(rows[idx].path); return; }
    if (mod && e.key === 'Enter' && !ro) { done(); if (e.shiftKey) this.addChild(); else this.addSibling(); return; }
    if (e.altKey && !mod && !ro && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      done();
      if (e.key === 'ArrowUp') this.moveUp(); else this.moveDown();
      return;
    }
    if (mod && !ro && (e.key === ']' || e.key === '[')) { done(); if (e.key === ']') this.indent(); else this.outdent(); return; }
    if (mod && e.shiftKey && !ro && (e.key === 'Backspace' || e.key === 'Delete')) { done(); this.deleteSelected(); return; }
    if (e.altKey || mod) return;
    const isSelect = target.tagName === 'SELECT';
    if (e.key === 'ArrowDown' && !isSelect) { done(); go(idx + 1); }
    else if (e.key === 'ArrowUp' && !isSelect) { done(); go(idx - 1); }
    else if (e.key === 'Enter' && !isSelect) { done(); go(e.shiftKey ? idx - 1 : idx + 1); }
  }

  // --- drag and drop -------------------------------------------------------------

  _dragStart(e, row) {
    e.dataTransfer.setData('application/x-fhir-concept-path', row.key);
    e.dataTransfer.effectAllowed = 'move';
    const rowEl = e.target.closest('.row');
    if (rowEl) e.dataTransfer.setDragImage(rowEl, 10, ROW_H / 2);
    this._dragFrom = row.path;
  }

  _dragOver(e, row) {
    const from = this._dragFrom;
    if (!from) return;
    const path = row.path;
    if (path.length >= from.length && from.every((v, i) => path[i] === v)) return; // into itself
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const zone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    if (this._drop?.key !== row.key || this._drop.zone !== zone) this._drop = { key: row.key, zone };
  }

  _dropOn(e, row) {
    e.preventDefault();
    const from = this._dragFrom;
    const zone = this._drop?.zone;
    this._drop = null;
    this._dragFrom = null;
    if (!from || !zone) return;
    let result;
    if (zone === 'into') {
      this._collapsed.delete(row.c.code);
      result = this.editor.change(r => reparentConcept(r, from, row.path));
    } else {
      const parent = row.path.slice(0, -1);
      const index = row.path[row.path.length - 1] + (zone === 'after' ? 1 : 0);
      result = this.editor.change(r => reparentConcept(r, from, parent, index));
    }
    if (result) this.select(result);
  }

  _dragEnd() {
    this._drop = null;
    this._dragFrom = null;
  }

  // --- column widths -------------------------------------------------------------
  // Drag the right edge of a column header to resize it; double-click the edge to
  // go back to the default width. Widths are remembered (per browser profile) by
  // column: code, display, definition, and p:<property code>.

  _cols(keys) {
    const w = k => (this._widths[k] ? `${this._widths[k]}px` : DEFAULT_COL[k] || DEFAULT_COL.prop);
    return ['22px', ...keys.map(w), '52px'].join(' ');
  }

  _resizer(key, keys) {
    return html`<span class="resizer" title="Drag to resize, double-click to reset"
      @pointerdown=${e => this._resizeStart(e, key, keys)}
      @dblclick=${e => { e.stopPropagation(); delete this._widths[key]; saveWidths(this._widths); this.requestUpdate(); }}></span>`;
  }

  _resizeStart(e, key, keys) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startW = handle.parentElement.getBoundingClientRect().width;
    const scroller = this._scroller;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    let width = startW;
    const move = ev => {
      width = Math.max(MIN_COL, Math.round(startW + ev.clientX - startX));
      // update the grid directly while dragging, rather than re-rendering every row
      const saved = this._widths;
      this._widths = { ...saved, [key]: width };
      scroller.style.setProperty('--cols', this._cols(keys));
      this._widths = saved;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('active');
      if (width !== startW) {
        this._widths = { ...this._widths, [key]: width };
        saveWidths(this._widths);
      }
      this.requestUpdate();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  // --- lifecycle -----------------------------------------------------------------

  willUpdate() {
    // Each time a resource is loaded: reset, and collapse big hierarchies
    if (this.editor?.resource && this._autoCollapsedFor !== this.editor.loadCount) {
      this._autoCollapsedFor = this.editor.loadCount;
      this._search = '';
      this._collapsed.clear();
      this._cellErrors.clear();
      this._detailPath = null;
      if (this._scroller) this._scroller.scrollTop = 0;
      this._scrollTop = 0;
      if (countConcepts(this.editor.resource) > AUTO_COLLAPSE_OVER) this._setAll(false);
    }
    // numeric cells with unsaved invalid text: drop them if the concept is gone
    if (this._detailPath && !getConcept(this.editor.resource, this._detailPath)) this._closeDetails();
  }

  async updated() {
    const f = this._pendingFocus;
    if (!f) return;
    const index = this._rows.findIndex(r => r.key === f.key);
    if (index < 0) { this._pendingFocus = null; return; }
    if (f.scroll) {
      f.scroll = false;
      this._ensureVisible(index);
      if (this.isUpdatePending) return; // scrolling re-renders; finish on the next update
    }
    this._pendingFocus = null;
    if (!f.col) return;
    const el = this.renderRoot.querySelector(`[data-key="${f.key}"][data-col="${f.col}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (f.selectText && el.select) el.select();
    }
  }

  _highlight(text) {
    const t = this._search.trim();
    if (!t || !text) return text || '';
    const i = text.toLowerCase().indexOf(t.toLowerCase());
    if (i < 0) return text;
    return html`${text.slice(0, i)}<mark>${text.slice(i, i + t.length)}</mark>${text.slice(i + t.length)}`;
  }

  // --- render --------------------------------------------------------------------

  render() {
    if (!this.editor?.resource) return html``;
    const r = this._r;
    const ro = this.editor.isReadOnly;
    const { rows, hits } = this._visibleRows();
    this._rows = rows;
    const sel = this._sel ? pathKey(this._sel) : null;
    const selected = this._sel ? getConcept(r, this._sel) : null;
    const defs = (r.property || []).filter(d => d.code);
    const colKeys = ['code', 'display', 'definition', ...defs.map(d => `p:${d.code}`)];
    const cols = this._cols(colKeys);

    const issueByConcept = new Map();
    for (const i of this.editor.issues) {
      if (!i.conceptPath || i.severity === 'information') continue;
      const k = pathKey(i.conceptPath);
      if (!issueByConcept.has(k)) issueByConcept.set(k, []);
      issueByConcept.get(k).push(i);
    }

    const needCodes = defs.some(isConceptReferenceProperty);
    const codes = [];
    if (needCodes) walk(r, x => { if (x.code && codes.length < 5000) codes.push(x); });

    const viewRows = Math.max(1, Math.ceil((this._viewH - HEAD_H) / ROW_H));
    const start = Math.max(0, Math.floor(this._scrollTop / ROW_H) - OVERSCAN);
    const end = Math.min(rows.length, start + viewRows + OVERSCAN * 2);
    const slice = rows.slice(start, end);
    const canDrag = !ro && !this._search.trim();

    return html`
      <div class="toolbar">
        <button ?disabled=${ro} title="Add a concept after the selected one (${MOD}Enter)" @click=${this.addSibling}>+ Concept</button>
        <button ?disabled=${ro || !selected} title="Add a child of the selected concept (${MOD}Shift+Enter)" @click=${this.addChild}>+ Child</button>
        <span class="sep"></span>
        <button class="icon" ?disabled=${ro || !selected} title="Move up (Alt+↑)" @click=${this.moveUp}>↑</button>
        <button class="icon" ?disabled=${ro || !selected} title="Move down (Alt+↓)" @click=${this.moveDown}>↓</button>
        <button class="icon" ?disabled=${ro || !selected} title="Make a child of the previous concept (${MOD}])" @click=${this.indent}>→</button>
        <button class="icon" ?disabled=${ro || !selected} title="Move up a level (${MOD}[)" @click=${this.outdent}>←</button>
        <span class="sep"></span>
        <button class="icon" ?disabled=${ro || !selected} title="Delete the concept and its children (${MOD}Shift+Delete)" @click=${this.deleteSelected}>✕</button>
        <span class="sep"></span>
        <button class="icon" title="Expand all" @click=${() => this._setAll(true)}>⊞</button>
        <button class="icon" title="Collapse all" @click=${() => this._setAll(false)}>⊟</button>
        <span class="sep"></span>
        <button ?disabled=${!selected} title="Designations, all property values and children (double-click a code, or Alt+Enter)" @click=${() => this.openDetails()}>Details…</button>
        <input type="search" placeholder="Find code, display or definition" aria-label="Find concepts" .value=${this._search}
          @input=${e => {
            this._search = e.target.value;
            this._scroller.scrollTop = 0;
            this._scrollTop = 0;
            // back to the full list: keep the selected concept in view
            if (!this._search.trim() && this._sel) this._pendingFocus = { key: pathKey(this._sel), col: null, scroll: true };
          }}
          @keydown=${e => {
            if (e.key === 'Enter' && hits?.length) {
              const cur = hits.findIndex(h => pathKey(h) === sel);
              this.select(hits[(cur + 1) % hits.length]);
            }
          }}>
        ${hits ? html`<span class="muted small">${hits.length} found</span>` : ''}
      </div>
      ${needCodes ? html`<datalist id="cs-codes">${codes.map(x => html`<option value=${x.code}>${x.display || ''}</option>`)}</datalist>` : ''}
      <div class="scroll" style="--cols: ${cols}" @scroll=${this._onScroll} @focusin=${this._onFocusIn} @keydown=${this._onKey}>
        <div class="row head" role="row">
          <div></div>
          <div>Code${this._resizer('code', colKeys)}</div>
          <div>Display${this._resizer('display', colKeys)}</div>
          <div>Definition${this._resizer('definition', colKeys)}</div>
          ${defs.map(d => html`<div title=${d.description || d.uri || d.code}>${d.code}<span class="type">${d.type || ''}</span>${this._resizer(`p:${d.code}`, colKeys)}</div>`)}
          <div></div>
        </div>
        ${rows.length === 0 ? html`<div class="empty">${this._search ? 'Nothing matches' : 'No concepts yet'}</div>` : ''}
        <div style="height:${start * ROW_H}px"></div>
        ${repeat(slice, row => row.c, row => {
          const k = row.key;
          const c = row.c;
          const issues = issueByConcept.get(k) || [];
          const sev = issues.some(i => i.severity === 'error') ? 'error' : issues.length ? 'warning' : null;
          const codeError = issues.some(i => i.severity === 'error' && i.location.endsWith('.code'));
          const dropCls = this._drop?.key === k ? ` drop-${this._drop.zone}` : '';
          const nDesig = c.designation?.length || 0;
          return html`
            <div class="row${k === sel ? ' sel' : ''}${this._search && !row.hit ? ' dim' : ''}${dropCls}" role="row"
              aria-level=${row.depth + 1} aria-expanded=${c.concept ? String(row.open) : nothing}
              @dragover=${e => this._dragOver(e, row)}
              @dragleave=${() => { if (this._drop?.key === k) this._drop = null; }}
              @drop=${e => this._dropOn(e, row)}>
              <div class="grip" draggable=${canDrag ? 'true' : 'false'} title=${canDrag ? 'Drag to move' : ''}
                @dragstart=${e => this._dragStart(e, row)} @dragend=${this._dragEnd}>${canDrag ? '⋮⋮' : ''}</div>
              <div class="cell code" style="padding-left:${row.depth * 16}px">
                <span class="twisty" @click=${() => { if (c.concept && !this._search) this._toggle(c); }}>${c.concept ? (row.open ? '▼' : '▶') : ''}</span>
                <input data-key=${k} data-col="code" aria-label="code" class=${codeError ? 'invalid' : ''} ?readonly=${ro}
                  title="Double-click for details" .value=${live(c.code ?? '')}
                  @focus=${() => this._codeFocus(row)}
                  @input=${e => this._setField(row.path, 'code', e.target.value)}
                  @change=${() => this._codeChange(row)}
                  @dblclick=${e => { e.preventDefault(); this.openDetails(row.path); }}>
              </div>
              <div class="cell"><input data-key=${k} data-col="display" aria-label="display" ?readonly=${ro} .value=${live(c.display ?? '')}
                @input=${e => this._setField(row.path, 'display', e.target.value)}></div>
              <div class="cell"><input data-key=${k} data-col="definition" aria-label="definition" ?readonly=${ro} title=${c.definition || nothing}
                .value=${live(c.definition ?? '')} @input=${e => this._setField(row.path, 'definition', e.target.value)}></div>
              ${defs.map((d, i) => this._propCell(row, d, `p${i}`))}
              <div class="marks" @click=${() => this.openDetails(row.path)}
                title=${[nDesig ? `${nDesig} designation(s)` : '', ...issues.map(i => i.message)].filter(Boolean).join('\n') || nothing}>
                ${nDesig ? html`<span class="badge">${nDesig}</span>` : ''}
                ${sev ? html`<span class="sev-${sev}">${sev === 'error' ? '●' : '▲'}</span>` : ''}
              </div>
            </div>`;
        })}
        <div style="height:${(rows.length - end) * ROW_H}px"></div>
      </div>
      <div class="hint">
        Double-click a code for details · ↑↓ Enter move between rows · ${MOD}Enter add · Alt+↑↓ move · ${MOD}] ${MOD}[ indent
        ${canDrag ? ' · drag ⋮⋮ to rearrange' : ''}
      </div>
      <dialog @close=${this._dialogClosed} aria-label="Concept details">
        ${this._detailPath && getConcept(r, this._detailPath) ? html`
          <header>
            <span class="t">${getConcept(r, this._detailPath).code || '(no code)'}${getConcept(r, this._detailPath).display ? ` - ${getConcept(r, this._detailPath).display}` : ''}</span>
            <button @click=${this._closeDetails}>Close</button>
          </header>
          <div class="body">
            <cs-concept-detail .editor=${this.editor} .path=${this._detailPath} .revision=${this.revision} .ro=${ro} .issues=${this.editor.issues}
              @fe-select-concept=${e => { this._detailPath = e.detail.path; this.editor.selectedPath = e.detail.path; }}></cs-concept-detail>
          </div>` : ''}
      </dialog>
    `;
  }
}

if (!customElements.get('cs-concepts')) customElements.define('cs-concepts', CsConcepts);

function loadWidths() {
  try {
    const w = JSON.parse(localStorage.getItem(WIDTHS_KEY) || '{}');
    return w && typeof w === 'object' ? w : {};
  } catch {
    return {};
  }
}

function saveWidths(widths) {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // storage unavailable (private window, blocked) - widths just aren't remembered
  }
}
