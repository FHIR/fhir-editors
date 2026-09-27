// <cs-metadata>: the CodeSystem's descriptive and structural elements.
// Elements it doesn't edit (contact, useContext, extension...) are listed so the
// author knows they are there; they are preserved and editable in the JSON view.

import { LitElement, html, css } from 'lit';
import { live } from 'lit/directives/live.js';
import { controls } from '../core/styles.js';
import { STATUS_CODES, CONTENT_CODES, HIERARCHY_CODES, countConcepts } from './model.js';

const EDITED = new Set([
  'resourceType', 'id', 'url', 'identifier', 'version', 'versionAlgorithmString', 'name', 'title',
  'status', 'experimental', 'date', 'publisher', 'description', 'purpose', 'copyright',
  'copyrightLabel', 'caseSensitive', 'valueSet', 'hierarchyMeaning', 'compositional',
  'versionNeeded', 'content', 'supplements', 'count', 'property', 'filter', 'concept'
]);

export class CsMetadata extends LitElement {
  static properties = {
    editor: { attribute: false },
    revision: { type: Number },
    ro: { type: Boolean },  // read-only; passed so that a change re-renders
    issues: { attribute: false }
  };

  static styles = [controls, css`
    :host { display: block; }
    .form { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; align-items: center; max-width: 900px; }
    .form label { color: var(--_muted); text-align: right; font-size: 0.92em; }
    .form label.top { align-self: start; padding-top: 5px; }
    .form input, .form select, .form textarea { width: 100%; }
    .form select { width: auto; min-width: 12em; justify-self: start; }
    .inline { display: flex; gap: 6px; align-items: center; }
    .inline input { flex: 1; }
    .section { grid-column: 1 / -1; margin: 14px 0 2px; font-weight: 600; border-bottom: 1px solid var(--_border); padding-bottom: 3px; }
    .section:first-child { margin-top: 0; }
    .ids { display: grid; gap: 4px; }
    .id-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 4px; }
    .issue { grid-column: 2; font-size: 0.85em; margin-top: -3px; }
    .other { grid-column: 1 / -1; margin-top: 12px; }
  `];

  get _r() { return this.editor.resource; }

  _set(key, value, coalesce = true) {
    this.editor.change(r => {
      if (value === undefined || value === '') delete r[key];
      else r[key] = value;
    }, { coalesce: coalesce ? `meta:${key}` : undefined });
  }

  _issues(key) {
    const loc = `CodeSystem.${key}`;
    return this.editor.issues.filter(i => i.location === loc);
  }

  _text(key, label, { mono = false, placeholder = '', type = 'text' } = {}) {
    const issues = this._issues(key);
    return html`
      <label for=${key}>${label}</label>
      <input id=${key} type=${type} class=${(mono ? 'mono ' : '') + (issues.some(i => i.severity === 'error') ? 'invalid' : '')}
        placeholder=${placeholder} .value=${live(this._r[key] ?? '')} ?disabled=${this.editor.isReadOnly}
        @input=${e => this._set(key, e.target.value)}>
      ${this._issueLine(issues)}`;
  }

  _area(key, label, rows = 3) {
    return html`
      <label class="top" for=${key}>${label}</label>
      <textarea id=${key} rows=${rows} .value=${live(this._r[key] ?? '')} ?disabled=${this.editor.isReadOnly}
        @input=${e => this._set(key, e.target.value)}></textarea>
      ${this._issueLine(this._issues(key))}`;
  }

  _select(key, label, codes, { allowEmpty = true } = {}) {
    const v = this._r[key] ?? '';
    const unknown = v && !codes.includes(v);
    return html`
      <label for=${key}>${label}</label>
      <select id=${key} ?disabled=${this.editor.isReadOnly} @change=${e => this._set(key, e.target.value, false)}>
        ${allowEmpty || !v ? html`<option value="" ?selected=${!v}>${allowEmpty ? '(not stated)' : '(choose)'}</option>` : ''}
        ${unknown ? html`<option value=${v} selected>${v} (unknown)</option>` : ''}
        ${codes.map(c => html`<option value=${c} ?selected=${c === v}>${c}</option>`)}
      </select>
      ${this._issueLine(this._issues(key))}`;
  }

  _bool(key, label) {
    const v = this._r[key];
    const s = v === true ? 'true' : v === false ? 'false' : '';
    return html`
      <label for=${key}>${label}</label>
      <select id=${key} ?disabled=${this.editor.isReadOnly}
        @change=${e => this._set(key, e.target.value === '' ? undefined : e.target.value === 'true', false)}>
        <option value="" ?selected=${s === ''}>(not stated)</option>
        <option value="true" ?selected=${s === 'true'}>true</option>
        <option value="false" ?selected=${s === 'false'}>false</option>
      </select>`;
  }

  _issueLine(issues) {
    return issues.length
      ? html`<div class="issue">${issues.map(i => html`<div class="sev-${i.severity}">${i.message}</div>`)}</div>`
      : '';
  }

  _nowDate() {
    // FHIR dateTime with timezone offset
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const tz = `${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`;
  }

  _nameFromTitle() {
    const words = (this._r.title || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    let name = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    if (name && !/^[A-Z]/.test(name)) name = 'CS' + name;
    if (name) this._set('name', name, false);
  }

  _identifiers() {
    const ids = this._r.identifier || [];
    const ro = this.editor.isReadOnly;
    const update = (i, field, value) => this.editor.change(r => {
      const id = { ...r.identifier[i] };
      if (value === '') delete id[field]; else id[field] = value;
      r.identifier[i] = id;
    }, { coalesce: `meta:identifier:${i}:${field}` });
    return html`
      <label class="top">Identifiers</label>
      <div class="ids">
        ${ids.map((id, i) => html`
          <div class="id-row">
            <input class="mono" placeholder="system" .value=${live(id.system || '')} ?disabled=${ro}
              @input=${e => update(i, 'system', e.target.value)}>
            <input class="mono" placeholder="value" .value=${live(id.value || '')} ?disabled=${ro}
              @input=${e => update(i, 'value', e.target.value)}>
            <button class="icon" title="Remove identifier" ?disabled=${ro}
              @click=${() => this.editor.change(r => { r.identifier.splice(i, 1); if (!r.identifier.length) delete r.identifier; })}>✕</button>
          </div>`)}
        <div><button ?disabled=${ro} @click=${() => this.editor.change(r => { (r.identifier ||= []).push({ system: 'urn:ietf:rfc:3986', value: '' }); })}>Add identifier</button></div>
      </div>`;
  }

  render() {
    if (!this.editor?.resource) return html``;
    const r = this._r;
    const ro = this.editor.isReadOnly;
    const actual = countConcepts(r);
    const others = Object.keys(r).filter(k => !EDITED.has(k) && !k.startsWith('_'));
    return html`
      <div class="form">
        <div class="section">Identity</div>
        ${this._text('url', 'URL', { mono: true, placeholder: 'http://example.org/fhir/CodeSystem/my-codes' })}
        ${this._text('id', 'Id', { mono: true })}
        ${this._identifiers()}
        ${this._text('version', 'Version', { mono: true })}
        ${this.editor.isR5 ? this._text('versionAlgorithmString', 'Version algorithm', { placeholder: 'e.g. semver' }) : ''}
        <label for="name">Name</label>
        <div class="inline">
          <input id="name" class=${this._issues('name').some(i => i.severity === 'error') ? 'mono invalid' : 'mono'}
            .value=${live(r.name ?? '')} ?disabled=${ro} @input=${e => this._set('name', e.target.value)}>
          <button ?disabled=${ro || !r.title} title="Derive the name from the title" @click=${this._nameFromTitle}>From title</button>
        </div>
        ${this._issueLine(this._issues('name'))}
        ${this._text('title', 'Title')}
        ${this._select('status', 'Status', STATUS_CODES, { allowEmpty: false })}
        ${this._bool('experimental', 'Experimental')}
        <label for="date">Date</label>
        <div class="inline">
          <input id="date" class=${this._issues('date').length ? 'mono invalid' : 'mono'} placeholder="YYYY-MM-DD"
            .value=${live(r.date ?? '')} ?disabled=${ro} @input=${e => this._set('date', e.target.value)}>
          <button ?disabled=${ro} @click=${() => this._set('date', this._nowDate(), false)}>Now</button>
        </div>
        ${this._issueLine(this._issues('date'))}
        ${this._text('publisher', 'Publisher')}

        <div class="section">Description</div>
        ${this._area('description', 'Description', 4)}
        ${this._area('purpose', 'Purpose', 2)}
        ${this._area('copyright', 'Copyright', 2)}
        ${this.editor.isR5 ? this._text('copyrightLabel', 'Copyright label') : ''}

        <div class="section">Content</div>
        ${this._select('content', 'Content', CONTENT_CODES, { allowEmpty: false })}
        ${r.content === 'supplement' || r.supplements ? this._text('supplements', 'Supplements', { mono: true, placeholder: 'canonical of the code system being supplemented' }) : ''}
        ${this._bool('caseSensitive', 'Case sensitive')}
        ${this._select('hierarchyMeaning', 'Hierarchy meaning', HIERARCHY_CODES)}
        ${this._text('valueSet', 'All-codes value set', { mono: true })}
        ${this._bool('compositional', 'Compositional')}
        ${this._bool('versionNeeded', 'Version needed')}
        <label for="count">Count</label>
        <div class="inline">
          <input id="count" type="number" min="0" style="max-width: 10em" .value=${live(r.count === undefined ? '' : String(r.count))} ?disabled=${ro}
            @input=${e => this._set('count', e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0))}>
          <span class="muted small">${actual} concept${actual === 1 ? '' : 's'} in this resource</span>
          ${r.count !== actual ? html`<button ?disabled=${ro} @click=${() => this._set('count', actual, false)}>Set to ${actual}</button>` : ''}
        </div>
        ${this._issueLine(this._issues('count'))}

        ${others.length ? html`<div class="other muted small">
          Also present, and preserved: ${others.map((k, i) => html`${i ? ', ' : ''}<span class="mono">${k}</span>${Array.isArray(r[k]) ? ` (${r[k].length})` : ''}`)}.
          Edit these in the JSON view.</div>` : ''}
      </div>
    `;
  }
}

customElements.define('cs-metadata', CsMetadata);
