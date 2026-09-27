// Behaviour shared by every resource editor: loading and saving through the host,
// change tracking, undo/redo, validation scheduling and keyboard shortcuts.
//
// A subclass provides:
//   static resourceType            e.g. 'CodeSystem'
//   validateResource(resource)     -> issues (see codesystem/validation.js)
//   normalizeResource(resource)    -> the JSON to save
//   render()
//
// Sub-components edit this.resource in place, always inside change():
//
//   editor.change(r => { r.title = value; }, { coalesce: 'title' });
//
// change() takes an undo snapshot first (successive changes with the same
// coalesce key share one snapshot, so typing a word is one undo step), marks the
// editor dirty, bumps `revision` (which sub-components use to re-render) and
// schedules validation.
//
// Public API for hosts:
//   .host            the EditorHost (setting it loads the resource; null closes it)
//   .load()          (re)load from the host, discarding changes
//   .save()          save through the host
//   .getResource()   the normalized resource
//   .hasChanges      true if there are unsaved changes
//   readonly attribute, or host.readOnly
//   fhir-version attribute ('4.0.1' default; '5.0.0' shows R5-only elements)
//
// Events (bubbling, composed): fe-loaded, fe-change {dirty}, fe-saved {resource},
// fe-error {error}

import { LitElement } from 'lit';

const UNDO_LIMIT = 200;
const COALESCE_MS = 1500;

export class EditorBase extends LitElement {
  static properties = {
    host: { attribute: false },
    readonly: { type: Boolean, reflect: true },
    fhirVersion: { attribute: 'fhir-version' },
    resource: { state: true },
    revision: { state: true },
    issues: { state: true },
    dirty: { state: true },
    busy: { state: true },
    message: { state: true }
  };

  constructor() {
    super();
    this.resource = null;
    this.revision = 0;
    this.issues = [];
    this.dirty = false;
    this.busy = false;
    this.message = null;
    this.loadCount = 0;
    this.fhirVersion = '4.0.1';
    this._undo = [];
    this._redo = [];
    this._lastCoalesce = null;
    this._validateTimer = null;
    this._onKey = this._onKey.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this._onKey);
    clearTimeout(this._validateTimer);
  }

  willUpdate(changed) {
    if (!changed.has('host')) return;
    if (this.host) {
      this.load({ newHost: true });
    } else if (this.resource) {
      // host removed: close the resource (hosts check hasChanges first)
      this._clear();
    }
  }

  _clear() {
    if (this.resource) {
      this.resource = null;
      this.issues = [];
      this.dirty = false;
      this.message = null;
      this._undo = [];
      this._redo = [];
      this.loadCount++;
      this.resetUiState?.();
      this._emit('fe-change', { dirty: false });
    }
  }

  get isR5() {
    return /^5|^6/.test(this.fhirVersion || '');
  }

  get isReadOnly() {
    return this.readonly || !!this.host?.readOnly;
  }

  get hasChanges() {
    return this.dirty;
  }

  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }

  // --- loading and saving --------------------------------------------------

  async load({ newHost = false } = {}) {
    if (!this.host) return;
    const host = this.host;
    this.busy = true;
    this.message = null;
    try {
      const r = await host.load();
      if (this.host !== host) return; // replaced while loading
      const type = this.constructor.resourceType;
      if (!r || r.resourceType !== type) {
        throw new Error(`Expected a ${type}, but got ${r?.resourceType || 'nothing'}`);
      }
      this.loadCount++;
      this.resetUiState?.();
      this._setResource(r);
      this.dirty = false;
      this._undo = [];
      this._redo = [];
      this._emit('fe-loaded', { resource: r });
    } catch (e) {
      if (this.host !== host) return;
      // A resource from the previous host must not stay open: saving it would
      // write it to the new host's file
      if (newHost) this._clear();
      this._fail('Unable to load', e);
    } finally {
      this.busy = false;
    }
  }

  async save() {
    if (!this.host || !this.resource || this.isReadOnly || this.busy) return false;
    this.busy = true;
    this.message = null;
    try {
      this.beforeSave?.();
      const out = this.normalizeResource(this.resource);
      const stored = await this.host.save(out);
      if (stored && stored.resourceType === out.resourceType) {
        // e.g. a server assigned a new meta.versionId - adopt it, but keep undo history
        this.resource = stored;
        this.revision++;
      }
      this.dirty = false;
      this._lastCoalesce = null;
      this.message = { severity: 'information', text: `Saved ${new Date().toLocaleTimeString()}` };
      this._emit('fe-saved', { resource: out });
      this._emit('fe-change', { dirty: false });
      return true;
    } catch (e) {
      this._fail('Unable to save', e);
      return false;
    } finally {
      this.busy = false;
    }
  }

  getResource() {
    return this.resource ? this.normalizeResource(this.resource) : null;
  }

  /** Replaces the whole resource (e.g. from the JSON view) as an undoable change */
  replaceResource(r) {
    this._snapshot(null);
    this._setResource(r, true);
    this._changed();
  }

  _setResource(r, keepHistory = false) {
    this.resource = r;
    this.revision++;
    if (!keepHistory) this._lastCoalesce = null;
    this.validateNow();
  }

  _fail(what, e) {
    const text = `${what}: ${e?.message || e}`;
    this.message = { severity: 'error', text };
    this._emit('fe-error', { error: e, message: text });
  }

  // --- changes and undo ------------------------------------------------------

  change(fn, { coalesce } = {}) {
    if (!this.resource || this.isReadOnly) return undefined;
    const now = Date.now();
    const c = this._lastCoalesce;
    if (!(coalesce && c && c.key === coalesce && now - c.at < COALESCE_MS)) {
      this._snapshot(coalesce);
    }
    if (coalesce) this._lastCoalesce = { key: coalesce, at: now };
    const result = fn(this.resource);
    this._changed();
    return result;
  }

  _snapshot(coalesce) {
    this._undo.push({ json: JSON.stringify(this.resource), state: this.captureUiState?.() });
    if (this._undo.length > UNDO_LIMIT) this._undo.shift();
    this._redo = [];
    if (!coalesce) this._lastCoalesce = null;
  }

  _changed() {
    this.revision++;
    if (!this.dirty) {
      this.dirty = true;
      this._emit('fe-change', { dirty: true });
    }
    this.scheduleValidation();
  }

  undo() { this._restore(this._undo, this._redo); }
  redo() { this._restore(this._redo, this._undo); }

  _restore(from, to) {
    if (!from.length || this.isReadOnly) return;
    to.push({ json: JSON.stringify(this.resource), state: this.captureUiState?.() });
    const s = from.pop();
    this._lastCoalesce = null;
    this.resource = JSON.parse(s.json);
    this.revision++;
    this.restoreUiState?.(s.state);
    if (!this.dirty) this.dirty = true;
    this._emit('fe-change', { dirty: true });
    this.validateNow();
  }

  // --- validation ------------------------------------------------------------

  scheduleValidation() {
    clearTimeout(this._validateTimer);
    this._validateTimer = setTimeout(() => this.validateNow(), 250);
  }

  validateNow() {
    clearTimeout(this._validateTimer);
    this.issues = this.resource ? this.validateResource(this.resource) : [];
  }

  /** Runs host.validate (if the host has it) and merges its issues */
  async validateWithHost() {
    this.validateNow();
    if (!this.host?.validate || !this.resource) return;
    this.busy = true;
    try {
      const extra = await this.host.validate(this.normalizeResource(this.resource));
      this.issues = [...this.issues, ...(extra || []).map(i => ({ ...i, fromHost: true }))];
      this.message = { severity: 'information', text: `Validated: ${extra?.length || 0} issue(s) from ${this.host.label || 'host'}` };
    } catch (e) {
      this._fail('Validation failed', e);
    } finally {
      this.busy = false;
    }
  }

  // --- keyboard --------------------------------------------------------------

  _onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      this.save();
      return;
    }
    // Leave text fields their own undo
    const target = e.composedPath()[0];
    const inText = target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type !== 'checkbox'));
    if (inText) return;
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); this.redo(); }
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}
