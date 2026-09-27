// <cs-properties>: CodeSystem.property (the property definitions) and
// <cs-filters>: CodeSystem.filter.

import { LitElement, html, css } from 'lit';
import { live } from 'lit/directives/live.js';
import { controls } from '../core/styles.js';
import {
  PROPERTY_TYPES, FILTER_OPERATORS, propertyUsage, renamePropertyDefinition, changePropertyType, walk
} from './model.js';

const CP = 'http://hl7.org/fhir/concept-properties#';
export const STANDARD_PROPERTIES = [
  { code: 'status', uri: CP + 'status', type: 'code', description: 'A code that indicates the status of the concept' },
  { code: 'inactive', uri: CP + 'inactive', type: 'boolean', description: 'True if the concept is not considered active' },
  { code: 'effectiveDate', uri: CP + 'effectiveDate', type: 'dateTime', description: 'The date at which the concept status was last changed' },
  { code: 'deprecated', uri: CP + 'deprecated', type: 'dateTime', description: 'The date at which the concept was deprecated' },
  { code: 'retirementDate', uri: CP + 'retirementDate', type: 'dateTime', description: 'The date at which the concept was retired' },
  { code: 'notSelectable', uri: CP + 'notSelectable', type: 'boolean', description: 'The concept is not intended to be chosen by the user' },
  { code: 'parent', uri: CP + 'parent', type: 'code', description: 'The concept identified in this property is a parent of the concept' },
  { code: 'child', uri: CP + 'child', type: 'code', description: 'The concept identified in this property is a child of the concept' },
  { code: 'partOf', uri: CP + 'partOf', type: 'code', description: 'The concept identified in this property contains this concept' },
  { code: 'synonym', uri: CP + 'synonym', type: 'code', description: 'This property contains an alternative code that may be used to identify this concept' },
  { code: 'comment', uri: CP + 'comment', type: 'string', description: 'A string that provides additional detail pertinent to the use or understanding of the concept' },
  { code: 'itemWeight', uri: CP + 'itemWeight', type: 'decimal', description: 'A numeric value that allows the comparison (less than, greater than) or other numerical manipulation of a concept' }
];

const tableStyles = css`
  :host { display: block; }
  .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  td.num { text-align: right; color: var(--_muted); white-space: nowrap; padding-top: 7px; }
  .ops { display: flex; flex-wrap: wrap; gap: 3px; }
  .ops label {
    font-family: var(--_mono); font-size: 0.82em; padding: 1px 6px; border: 1px solid var(--_border);
    border-radius: 10px; cursor: pointer; user-select: none;
  }
  .ops label.on { background: var(--_select); border-color: var(--_accent); }
  .ops input { display: none; }
  .issue { font-size: 0.85em; }
`;

function issueLines(editor, prefix) {
  const list = editor.issues.filter(i => i.location?.startsWith(prefix));
  return list.length ? html`<div class="issue">${list.map(i => html`<div class="sev-${i.severity}">${i.message}</div>`)}</div>` : '';
}

export class CsProperties extends LitElement {
  static properties = {
    editor: { attribute: false },
    revision: { type: Number },
    ro: { type: Boolean },  // read-only; passed so that a change re-renders
    issues: { attribute: false }
  };

  static styles = [controls, tableStyles];

  constructor() {
    super();
    this._codeAtFocus = new Map();
  }

  _update(i, field, value) {
    this.editor.change(r => {
      if (value === '') delete r.property[i][field]; else r.property[i][field] = value;
    }, { coalesce: `prop:${i}:${field}` });
  }

  _codeFocus(i) {
    this._codeAtFocus.set(i, this.editor.resource.property[i].code);
  }

  _codeInput(i, value) {
    this._update(i, 'code', value.trim());
  }

  _codeChange(i) {
    // Concept property values follow the rename once the edit is finished, so that
    // passing through another property's code while typing doesn't merge them
    const old = this._codeAtFocus.get(i);
    const now = this.editor.resource.property[i].code;
    this._codeAtFocus.set(i, now);
    if (old && now && old !== now) {
      this.editor.change(r => {
        r.property[i].code = old;
        renamePropertyDefinition(r, old, now, i);
      });
    }
  }

  _uriChange(i, uri) {
    const std = STANDARD_PROPERTIES.find(p => p.uri === uri);
    this.editor.change(r => {
      const p = r.property[i];
      if (uri === '') delete p.uri; else p.uri = uri;
      if (std) {
        if (!p.code) p.code = std.code;
        if (!p.description) p.description = std.description;
        if (!p.type) p.type = std.type;
        else if (p.type !== std.type) changePropertyType(r, p.code, std.type);
      }
    }, { coalesce: std ? undefined : `prop:${i}:uri` });
  }

  _add(template) {
    this.editor.change(r => {
      (r.property ||= []).push(template ? { ...template } : { code: '', type: 'string' });
    });
  }

  _remove(i) {
    const code = this.editor.resource.property[i].code;
    let removed = 0;
    this.editor.change(r => {
      r.property.splice(i, 1);
      if (!r.property.length) delete r.property;
      if (code && !(r.property || []).some(p => p.code === code)) {
        walk(r, c => {
          if (!c.property) return;
          const before = c.property.length;
          c.property = c.property.filter(p => p.code !== code);
          removed += before - c.property.length;
          if (!c.property.length) delete c.property;
        });
      }
    });
    if (removed) {
      this.editor.message = { severity: 'information', text: `Removed property "${code}" and ${removed} value(s) from concepts (Undo to restore)` };
    }
  }

  render() {
    if (!this.editor?.resource) return html``;
    const r = this.editor.resource;
    const ro = this.editor.isReadOnly;
    const props = r.property || [];
    const usage = propertyUsage(r);
    const unused = STANDARD_PROPERTIES.filter(s => !props.some(p => p.uri === s.uri || p.code === s.code));
    return html`
      <div class="bar">
        <button ?disabled=${ro} @click=${() => this._add()}>Add property</button>
        ${unused.length ? html`
          <select ?disabled=${ro} aria-label="Add a standard property"
            @change=${e => { const s = unused.find(u => u.uri === e.target.value); e.target.value = ''; if (s) this._add(s); }}>
            <option value="">Add a standard property…</option>
            ${unused.map(s => html`<option value=${s.uri}>${s.code} (${s.type})</option>`)}
          </select>` : ''}
      </div>
      ${props.length === 0 ? html`<div class="empty">No properties are defined. Concepts can only have properties that are defined here.</div>` : html`
        <datalist id="std-uris">${STANDARD_PROPERTIES.map(s => html`<option value=${s.uri}>${s.code}</option>`)}</datalist>
        <table class="grid">
          <thead><tr><th style="width:15%">Code</th><th style="width:30%">URI</th><th>Description</th><th style="width:9em">Type</th><th>Used</th><th></th></tr></thead>
          <tbody>
            ${props.map((p, i) => html`
              <tr>
                <td><input class="mono" aria-label="code" .value=${live(p.code || '')} ?disabled=${ro}
                  @focus=${() => this._codeFocus(i)} @input=${e => this._codeInput(i, e.target.value)} @change=${() => this._codeChange(i)}></td>
                <td><input class="mono" aria-label="uri" list="std-uris" .value=${live(p.uri || '')} ?disabled=${ro}
                  @input=${e => this._uriChange(i, e.target.value.trim())}></td>
                <td><input aria-label="description" .value=${live(p.description || '')} ?disabled=${ro}
                  @input=${e => this._update(i, 'description', e.target.value)}></td>
                <td><select aria-label="type" ?disabled=${ro}
                  @change=${e => this.editor.change(r2 => changePropertyType(r2, r2.property[i].code, e.target.value))}>
                  ${!PROPERTY_TYPES.includes(p.type) ? html`<option selected value="">${p.type || '(none)'}</option>` : ''}
                  ${PROPERTY_TYPES.map(t => html`<option ?selected=${t === p.type}>${t}</option>`)}
                </select></td>
                <td class="num">${usage.get(p.code) || 0}</td>
                <td><button class="icon" title=${usage.get(p.code) ? `Remove, along with its ${usage.get(p.code)} value(s) on concepts` : 'Remove'}
                  ?disabled=${ro} @click=${() => this._remove(i)}>✕</button></td>
              </tr>
              ${issueLines(this.editor, `CodeSystem.property[${i}]`) ? html`<tr><td colspan="6">${issueLines(this.editor, `CodeSystem.property[${i}]`)}</td></tr>` : ''}
            `)}
          </tbody>
        </table>`}
    `;
  }
}

export class CsFilters extends LitElement {
  static properties = {
    editor: { attribute: false },
    revision: { type: Number },
    ro: { type: Boolean },  // read-only; passed so that a change re-renders
    issues: { attribute: false }
  };

  static styles = [controls, tableStyles];

  _update(i, field, value) {
    this.editor.change(r => {
      if (value === '' || (Array.isArray(value) && !value.length)) delete r.filter[i][field];
      else r.filter[i][field] = value;
    }, { coalesce: Array.isArray(value) ? undefined : `filter:${i}:${field}` });
  }

  _toggleOp(i, op) {
    const ops = new Set(this.editor.resource.filter[i].operator || []);
    if (ops.has(op)) ops.delete(op); else ops.add(op);
    this._update(i, 'operator', FILTER_OPERATORS.filter(o => ops.has(o)).concat([...ops].filter(o => !FILTER_OPERATORS.includes(o))));
  }

  render() {
    if (!this.editor?.resource) return html``;
    const r = this.editor.resource;
    const ro = this.editor.isReadOnly;
    const filters = r.filter || [];
    return html`
      <div class="bar">
        <button ?disabled=${ro} @click=${() => this.editor.change(r2 => { (r2.filter ||= []).push({ code: '', operator: ['='], value: '' }); })}>Add filter</button>
        <span class="muted small">Filters that value sets can use to select concepts from this code system</span>
      </div>
      ${filters.length === 0 ? html`<div class="empty">No filters are defined.</div>` : html`
        <table class="grid">
          <thead><tr><th style="width:15%">Code</th><th style="width:25%">Description</th><th>Operators</th><th style="width:20%">Value</th><th></th></tr></thead>
          <tbody>
            ${filters.map((f, i) => html`
              <tr>
                <td><input class="mono" aria-label="code" .value=${live(f.code || '')} ?disabled=${ro} @input=${e => this._update(i, 'code', e.target.value.trim())}></td>
                <td><input aria-label="description" .value=${live(f.description || '')} ?disabled=${ro} @input=${e => this._update(i, 'description', e.target.value)}></td>
                <td><div class="ops">
                  ${[...FILTER_OPERATORS, ...(f.operator || []).filter(o => !FILTER_OPERATORS.includes(o))].map(op => html`
                    <label class=${(f.operator || []).includes(op) ? 'on' : ''}>
                      <input type="checkbox" ?disabled=${ro} .checked=${(f.operator || []).includes(op)} @change=${() => this._toggleOp(i, op)}>${op}</label>`)}
                </div></td>
                <td><input aria-label="value" placeholder="what the value is" .value=${live(f.value || '')} ?disabled=${ro} @input=${e => this._update(i, 'value', e.target.value)}></td>
                <td><button class="icon" title="Remove" ?disabled=${ro}
                  @click=${() => this.editor.change(r2 => { r2.filter.splice(i, 1); if (!r2.filter.length) delete r2.filter; })}>✕</button></td>
              </tr>
              ${issueLines(this.editor, `CodeSystem.filter[${i}]`) ? html`<tr><td colspan="5">${issueLines(this.editor, `CodeSystem.filter[${i}]`)}</td></tr>` : ''}
            `)}
          </tbody>
        </table>`}
    `;
  }
}

customElements.define('cs-properties', CsProperties);
customElements.define('cs-filters', CsFilters);
