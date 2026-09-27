// <fe-coding-input>: edits a Coding (system, code, display).
//
//   .value      the Coding object (or undefined)
//   .lookup     optional host.lookup; when present, the code is checked on blur
//   .suggestions  [{system, code, display}] offered as quick picks
//   ?disabled
//
// Fires 'fe-change' with detail.value = the new Coding (undefined when empty).

import { LitElement, html, css } from 'lit';
import { live } from 'lit/directives/live.js';
import { controls } from '../styles.js';

export class CodingInput extends LitElement {
  static properties = {
    value: { attribute: false },
    lookup: { attribute: false },
    suggestions: { attribute: false },
    disabled: { type: Boolean },
    _check: { state: true }
  };

  static styles = [controls, css`
    :host { display: block; }
    .row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.2fr) auto; gap: 4px; }
    .check { font-size: 0.85em; margin-top: 2px; }
    select.pick { width: 4.5em; }
  `];

  constructor() {
    super();
    this.suggestions = [];
    this._check = null;
  }

  _set(field, v) {
    const next = { ...(this.value || {}) };
    if (v === '') delete next[field]; else next[field] = v;
    this.value = Object.keys(next).length ? next : undefined;
    this._check = null;
    this.dispatchEvent(new CustomEvent('fe-change', { detail: { value: this.value }, bubbles: true, composed: true }));
  }

  _pick(e) {
    const s = this.suggestions[Number(e.target.value)];
    e.target.value = '';
    if (!s) return;
    this.value = { ...(this.value || {}), system: s.system, code: s.code, display: s.display };
    this._check = null;
    this.dispatchEvent(new CustomEvent('fe-change', { detail: { value: this.value }, bubbles: true, composed: true }));
  }

  async _verify() {
    const v = this.value;
    if (!this.lookup || !v?.system || !v?.code) return;
    const key = `${v.system}|${v.code}`;
    this._check = { key, pending: true };
    const r = await this.lookup(v.system, v.code, v.version);
    if (this._check?.key !== key) return;
    this._check = { key, ...r };
  }

  _useDisplay() {
    this._set('display', this._check.display);
  }

  render() {
    const v = this.value || {};
    const c = this._check;
    return html`
      <div class="row">
        <input class="mono" placeholder="system" aria-label="system" .value=${live(v.system || '')} ?disabled=${this.disabled}
          @input=${e => this._set('system', e.target.value.trim())} @change=${this._verify}>
        <input class="mono" placeholder="code" aria-label="code" .value=${live(v.code || '')} ?disabled=${this.disabled}
          @input=${e => this._set('code', e.target.value.trim())} @change=${this._verify}>
        <input placeholder="display" aria-label="display" .value=${live(v.display || '')} ?disabled=${this.disabled}
          @input=${e => this._set('display', e.target.value)}>
        ${this.suggestions.length ? html`
          <select class="pick" aria-label="choose a common value" ?disabled=${this.disabled} @change=${this._pick}>
            <option value="">…</option>
            ${this.suggestions.map((s, i) => html`<option value=${i}>${s.display || s.code}</option>`)}
          </select>` : ''}
      </div>
      ${c ? html`<div class="check">
        ${c.pending ? html`<span class="muted">checking…</span>`
          : c.found ? html`<span class="sev-information">✓ ${c.display || 'found'}</span>
              ${c.display && c.display !== v.display ? html` <button class="link" @click=${this._useDisplay}>use this display</button>` : ''}`
          : html`<span class=${c.unreachable ? 'muted' : 'sev-warning'}>${c.message || 'not found'}</span>`}
      </div>` : ''}
    `;
  }
}

if (!customElements.get('fe-coding-input')) customElements.define('fe-coding-input', CodingInput);
