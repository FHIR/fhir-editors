// <cs-concept-detail>: everything about one concept - code, display, definition,
// designations, property values and children. Shown in a dialog from the
// concepts grid (double-click a code).

import { LitElement, html, css, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { controls } from '../core/styles.js';
import '../core/widgets/coding-input.js';
import {
  walk, getConcept, pathKey, retargetCodeReferences, valueKeyOf, valueKeyForType, typeOfValueKey,
  parsePropertyValue, isConceptReferenceProperty
} from './model.js';

const DESIGNATION_USES = [
  { system: 'http://snomed.info/sct', code: '900000000000003001', display: 'Fully specified name' },
  { system: 'http://snomed.info/sct', code: '900000000000013009', display: 'Synonym' },
  { system: 'http://terminology.hl7.org/CodeSystem/designation-usage', code: 'display', display: 'Display' },
  { system: 'http://terminology.hl7.org/CodeSystem/hl7TermMaintInfra', code: 'preferredForLanguage', display: 'Preferred For Language' }
];

const COMMON_LANGUAGES = ['en', 'en-US', 'en-GB', 'en-AU', 'fr', 'fr-CA', 'de', 'es', 'it', 'nl', 'pt', 'pt-BR',
  'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'ru', 'uk', 'ar', 'he', 'zh', 'zh-CN', 'zh-TW', 'ja', 'ko', 'hi'];


export class CsConceptDetail extends LitElement {
  static properties = {
    editor: { attribute: false },
    path: { attribute: false },
    revision: { type: Number },
    ro: { type: Boolean },  // read-only; passed so that a change re-renders
    issues: { attribute: false },
    _valueErrors: { state: true }
  };

  static styles = [controls, css`
    :host { display: block; padding-right: 4px; }
    .crumbs { font-size: 0.85em; color: var(--_muted); margin-bottom: 8px; }
    .crumbs button { font-family: var(--_mono); font-size: 1em; }
    .form { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; align-items: center; }
    .form label { color: var(--_muted); text-align: right; font-size: 0.92em; }
    .form label.top { align-self: start; padding-top: 5px; }
    .form input, .form textarea { width: 100%; }
    .bar { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
    .issues { margin: 8px 0; font-size: 0.9em; }
    .children { display: flex; flex-wrap: wrap; gap: 4px 10px; }
    .children button { font-family: var(--_mono); }
    .err { font-size: 0.8em; color: var(--_error); }
    .desig {
      display: grid; grid-template-columns: 8em minmax(0, 1fr) auto; gap: 4px 6px; align-items: center;
      padding: 6px 0; border-bottom: 1px solid var(--_border);
    }
    .desig .use-label { text-align: right; padding-right: 2px; }
    .desig .use { grid-column: 2 / 4; }
    td.pcode { width: 11em; }
    td.x { width: 1%; }
  `];

  constructor() {
    super();
    this._valueErrors = {};
    this._codeAtFocus = null;
  }

  get _r() { return this.editor.resource; }
  get _c() { return getConcept(this._r, this.path); }

  willUpdate(changed) {
    if (changed.has('path')) this._valueErrors = {};
  }

  focusCode() {
    const input = this.renderRoot.querySelector('#code');
    input?.focus();
    input?.select();
  }

  _set(field, value, coalesce = true) {
    const path = this.path;
    this.editor.change(r => {
      const c = getConcept(r, path);
      if (value === '' || value === undefined) delete c[field]; else c[field] = value;
    }, { coalesce: coalesce ? `concept:${pathKey(path)}:${field}` : undefined });
  }

  _codeChange() {
    const old = this._codeAtFocus;
    const now = this._c.code;
    this._codeAtFocus = now;
    if (!old || !now || old === now) return;
    let n = 0;
    this.editor.change(r => { n = retargetCodeReferences(r, old, now); });
    if (n) this.editor.message = { severity: 'information', text: `Updated ${n} property reference(s) from "${old}" to "${now}"` };
  }

  _listChange(list, fn, coalesce) {
    const path = this.path;
    this.editor.change(r => {
      const c = getConcept(r, path);
      c[list] ||= [];
      fn(c[list]);
      if (!c[list].length) delete c[list];
    }, { coalesce: coalesce ? `concept:${pathKey(path)}:${list}:${coalesce}` : undefined });
  }

  // --- designations ------------------------------------------------------------

  _designations() {
    const c = this._c;
    const ro = this.editor.isReadOnly;
    const list = c.designation || [];
    const upd = (i, field, v) => this._listChange('designation', l => {
      const d = { ...l[i] };
      if (v === '' || v === undefined) delete d[field]; else d[field] = v;
      l[i] = d;
    }, `${i}:${field}`);
    return html`
      <h3>Designations</h3>
      ${list.length ? html`
        <datalist id="langs">${COMMON_LANGUAGES.map(l => html`<option value=${l}></option>`)}</datalist>
        ${list.map((d, i) => html`
          <div class="desig">
            <input class="mono lang" list="langs" placeholder="language" aria-label="language" .value=${live(d.language || '')} ?disabled=${ro}
              @input=${e => upd(i, 'language', e.target.value.trim())}>
            <input aria-label="value" placeholder="value" class=${d.value ? '' : 'invalid'} .value=${live(d.value || '')} ?disabled=${ro}
              @input=${e => upd(i, 'value', e.target.value)}>
            <button class="icon" title="Remove designation" ?disabled=${ro}
              @click=${() => this._listChange('designation', l => l.splice(i, 1))}>✕</button>
            <span class="use-label muted small">use</span>
            <fe-coding-input class="use" .value=${d.use} .lookup=${this.editor.host?.lookup} .suggestions=${DESIGNATION_USES} ?disabled=${ro}
              @fe-change=${e => upd(i, 'use', e.detail.value)}></fe-coding-input>
          </div>`)}` : html`<div class="empty">No designations</div>`}
      <div class="bar"><button ?disabled=${ro} @click=${() => this._listChange('designation', l => l.push({ language: '', value: '' }))}>Add designation</button></div>
    `;
  }

  // --- properties --------------------------------------------------------------

  _valueEditor(p, i, def) {
    const ro = this.editor.isReadOnly;
    const key = valueKeyOf(p);
    const type = def?.type || (key ? typeOfValueKey(key) : 'string');
    const setValue = v => this._listChange('property', l => {
      const np = { code: l[i].code };
      for (const [k, val] of Object.entries(l[i])) if (!(k.startsWith('value') && /^[A-Z]/.test(k[5] || ''))) np[k] = val;
      if (v !== undefined) np[valueKeyForType(type)] = v;
      l[i] = np;
    }, `${i}:value`);
    const errKey = String(i);
    const mismatch = def && key && key !== valueKeyForType(def.type);
    if (mismatch) {
      return html`<span class="sev-error small">${typeOfValueKey(key)} value "${JSON.stringify(p[key])}" but the property is a ${def.type}</span>
        <button class="link" ?disabled=${ro} @click=${() => setValue(undefined)}>clear</button>`;
    }
    const value = key ? p[key] : undefined;
    switch (type) {
      case 'boolean':
        return html`<select aria-label="value" ?disabled=${ro} @change=${e => setValue(e.target.value === '' ? undefined : e.target.value === 'true')}>
          <option value="" ?selected=${value === undefined}>(none)</option>
          <option value="true" ?selected=${value === true}>true</option>
          <option value="false" ?selected=${value === false}>false</option></select>`;
      case 'Coding':
        return html`<fe-coding-input .value=${value} .lookup=${this.editor.host?.lookup} ?disabled=${ro}
          @fe-change=${e => setValue(e.detail.value)}></fe-coding-input>`;
      case 'integer':
      case 'decimal': {
        const err = this._valueErrors[errKey];
        return html`<input class=${err ? 'mono invalid' : 'mono'} aria-label="value" inputmode="decimal" ?disabled=${ro}
            .value=${live(err ? err.text : value === undefined ? '' : String(value))}
            @input=${e => {
              const text = e.target.value.trim();
              if (text === '') { this._valueErrors = { ...this._valueErrors, [errKey]: undefined }; setValue(undefined); return; }
              const parsed = parsePropertyValue(type, text);
              if (parsed.error) this._valueErrors = { ...this._valueErrors, [errKey]: { text, message: parsed.error } };
              else { this._valueErrors = { ...this._valueErrors, [errKey]: undefined }; setValue(parsed.value); }
            }}>
          ${err ? html`<div class="err">${err.message} - not saved</div>` : ''}`;
      }
      case 'code':
        return html`<input class="mono" aria-label="value" list=${isConceptReferenceProperty(def) ? this._codesListId : nothing} .value=${live(value ?? '')} ?disabled=${ro}
          @input=${e => setValue(e.target.value.trim() || undefined)}>`;
      case 'dateTime':
        return html`<input class="mono" aria-label="value" placeholder="YYYY-MM-DD" .value=${live(value ?? '')} ?disabled=${ro}
          @input=${e => setValue(e.target.value.trim() || undefined)}>`;
      default:
        return html`<input aria-label="value" .value=${live(value ?? '')} ?disabled=${ro}
          @input=${e => setValue(e.target.value === '' ? undefined : e.target.value)}>`;
    }
  }

  get _codesListId() { return 'cs-codes'; }

  _properties() {
    const c = this._c;
    const ro = this.editor.isReadOnly;
    const defs = this._r.property || [];
    const list = c.property || [];
    const usesCodes = list.some(p => isConceptReferenceProperty(defs.find(d => d.code === p.code)));
    const codes = [];
    if (usesCodes) walk(this._r, x => { if (x.code && codes.length < 5000) codes.push(x); });
    const addProp = code => {
      const def = defs.find(d => d.code === code);
      this._listChange('property', l => l.push({ code, [valueKeyForType(def?.type || 'string')]: def?.type === 'boolean' ? true : undefined }));
    };
    return html`
      <h3>Properties</h3>
      ${usesCodes ? html`<datalist id=${this._codesListId}>${codes.map(x => html`<option value=${x.code}>${x.display || ''}</option>`)}</datalist>` : ''}
      ${list.length ? html`
        <table class="grid">
          <thead><tr><th>Property</th><th>Value</th><th></th></tr></thead>
          <tbody>${list.map((p, i) => {
            const def = defs.find(d => d.code === p.code);
            return html`
              <tr>
                <td class="pcode">
                  <select aria-label="property" class=${def ? '' : 'invalid'} ?disabled=${ro}
                    @change=${e => this._listChange('property', l => { l[i] = { ...l[i], code: e.target.value }; })}>
                    ${!def ? html`<option selected>${p.code || '(none)'}</option>` : ''}
                    ${defs.filter(d => d.code).map(d => html`<option value=${d.code} ?selected=${d.code === p.code}>${d.code}</option>`)}
                  </select>
                  ${def ? html`<div class="muted small">${def.type}</div>` : html`<div class="err">not defined</div>`}
                </td>
                <td>${this._valueEditor(p, i, def)}</td>
                <td class="x"><button class="icon" title="Remove property" ?disabled=${ro}
                  @click=${() => this._listChange('property', l => l.splice(i, 1))}>✕</button></td>
              </tr>`;
          })}</tbody>
        </table>` : html`<div class="empty">No property values</div>`}
      <div class="bar">
        ${defs.length ? html`
          <select ?disabled=${ro} aria-label="Add a property value"
            @change=${e => { const v = e.target.value; e.target.value = ''; if (v) addProp(v); }}>
            <option value="">Add property…</option>
            ${defs.filter(d => d.code).map(d => html`<option value=${d.code}>${d.code} (${d.type})</option>`)}
          </select>` : html`<span class="muted small">Define properties on the Properties tab to use them here</span>`}
      </div>
    `;
  }

  render() {
    const c = this.editor?.resource ? this._c : null;
    if (!c) return html``;
    const ro = this.editor.isReadOnly;
    const key = pathKey(this.path);
    const issues = this.editor.issues.filter(i => i.conceptPath && pathKey(i.conceptPath) === key);
    const ancestors = this.path.slice(0, -1).map((_, i) => ({ path: this.path.slice(0, i + 1), c: getConcept(this._r, this.path.slice(0, i + 1)) }));
    const go = path => this.dispatchEvent(new CustomEvent('fe-select-concept', { detail: { path }, bubbles: true, composed: true }));
    return html`
      <div class="crumbs">
        ${ancestors.length ? html`${ancestors.map(a => html`<button class="link" @click=${() => go(a.path)}>${a.c.code}</button> › `)}` : html`Top level`}
      </div>
      <div class="form">
        <label for="code">Code</label>
        <input id="code" class=${issues.some(i => i.location.endsWith('.code') && i.severity === 'error') ? 'mono invalid' : 'mono'}
          .value=${live(c.code ?? '')} ?disabled=${ro}
          @focus=${() => { this._codeAtFocus = this._c.code; }}
          @input=${e => this._set('code', e.target.value)}
          @change=${this._codeChange}>
        <label for="display">Display</label>
        <input id="display" .value=${live(c.display ?? '')} ?disabled=${ro} @input=${e => this._set('display', e.target.value)}>
        <label class="top" for="definition">Definition</label>
        <textarea id="definition" rows="3" .value=${live(c.definition ?? '')} ?disabled=${ro}
          @input=${e => this._set('definition', e.target.value)}></textarea>
      </div>
      ${issues.length ? html`<div class="issues">${issues.map(i => html`<div class="sev-${i.severity}">${i.message}</div>`)}</div>` : ''}
      ${this._designations()}
      ${this._properties()}
      ${c.concept?.length ? html`
        <h3>Children (${c.concept.length})</h3>
        <div class="children">${c.concept.slice(0, 200).map((k, i) => html`
          <button class="link" title=${k.display || ''} @click=${() => go([...this.path, i])}>${k.code || '(no code)'}</button>`)}
          ${c.concept.length > 200 ? html`<span class="muted">…</span>` : ''}
        </div>` : ''}
    `;
  }
}


if (!customElements.get('cs-concept-detail')) customElements.define('cs-concept-detail', CsConceptDetail);
