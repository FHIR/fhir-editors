// <cs-editor>: the CodeSystem editor.
//
//   const ed = document.createElement('cs-editor');
//   ed.host = someHost;          // loads the CodeSystem (see core/host.js)
//   document.body.append(ed);
//
// Give it a height (it fills its box and scrolls internally), e.g.
//   cs-editor { display: block; height: 100vh; }
//
// See core/editor-base.js for the API and events common to all editors.

import { html, css } from 'lit';
import { live } from 'lit/directives/live.js';
import { EditorBase } from '../core/editor-base.js';
import { theme, controls } from '../core/styles.js';
import { toJson } from '../core/fhir-json.js';
import '../core/widgets/issue-list.js';
import { normalize, getConcept, countConcepts } from './model.js';
import { validateCodeSystem, sortIssues } from './validation.js';
import './cs-metadata.js';
import './cs-properties.js';
import './cs-concepts.js';

const TABS = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'filters', label: 'Filters' },
  { id: 'properties', label: 'Properties' },
  { id: 'concepts', label: 'Concepts' },
  { id: 'json', label: 'JSON' },
  { id: 'issues', label: 'Issues' }
];

export class CodeSystemEditor extends EditorBase {
  static resourceType = 'CodeSystem';

  static properties = {
    ...EditorBase.properties,
    tab: { reflect: true },
    selectedPath: { state: true },
    _jsonText: { state: true },
    _jsonError: { state: true }
  };

  static styles = [theme, controls, css`
    :host {
      display: flex; flex-direction: column; min-height: 400px;
      background: var(--_bg); border: 1px solid var(--_border); border-radius: var(--_radius);
      overflow: hidden;
    }
    header {
      display: flex; align-items: center; gap: 8px; padding: 6px 10px;
      background: var(--_surface); border-bottom: 1px solid var(--_border); flex-wrap: wrap;
    }
    .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
    .where { color: var(--_muted); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .dirty { color: var(--_warning); font-size: 0.85em; }
    .ro { font-size: 0.8em; border: 1px solid var(--_border); border-radius: 10px; padding: 0 6px; color: var(--_muted); }
    nav { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--_border); background: var(--_surface); }
    nav button {
      border: none; background: none; border-bottom: 2px solid transparent; border-radius: 0;
      padding: 6px 12px; color: var(--_muted);
    }
    nav button[aria-selected='true'] { color: var(--_fg); border-bottom-color: var(--_accent); }
    .count { font-size: 0.8em; margin-left: 3px; }
    main { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
    main.fill { display: flex; flex-direction: column; overflow: hidden; }
    main.fill > * { flex: 1; min-height: 0; }
    .message { padding: 4px 10px; font-size: 0.9em; border-bottom: 1px solid var(--_border); display: flex; gap: 8px; }
    .message span { flex: 1; }
    .json { display: flex; flex-direction: column; gap: 6px; }
    .json textarea { flex: 1; font-family: var(--_mono); font-size: 0.85em; resize: none; white-space: pre; tab-size: 2; }
    .json .bar { display: flex; gap: 8px; align-items: center; }
    .loading { padding: 40px; text-align: center; color: var(--_muted); }
  `];

  constructor() {
    super();
    this.tab = 'metadata';
    this.selectedPath = null;
    this._jsonText = null;
    this._jsonError = null;
  }

  validateResource(r) { return sortIssues(validateCodeSystem(r)); }
  normalizeResource(r) { return normalize(r); }

  resetUiState() {
    this.selectedPath = null;
    this._jsonText = null;
    this._jsonError = null;
  }

  captureUiState() { return { selectedPath: this.selectedPath, tab: this.tab }; }
  restoreUiState(s) {
    const p = s?.selectedPath;
    this.selectedPath = p && getConcept(this.resource, p) ? p : null;
  }

  beforeSave() {
    // Unapplied JSON edits would otherwise be silently lost
    if (this.tab === 'json' && this._jsonText !== null) {
      if (!this._applyJson()) throw new Error('The JSON has errors - fix them, or discard the JSON edits, before saving');
    }
  }

  // --- tabs --------------------------------------------------------------------

  showTab(id) {
    if (id === this.tab) return;
    if (this.tab === 'json' && this._jsonText !== null) {
      if (!this._applyJson()) return; // stay, showing the error
    }
    this.tab = id;
  }

  // --- JSON view ---------------------------------------------------------------

  _applyJson() {
    if (this._jsonText === null) return true;
    let parsed;
    try {
      parsed = JSON.parse(this._jsonText);
    } catch (e) {
      this._jsonError = e.message;
      return false;
    }
    if (parsed?.resourceType !== 'CodeSystem') {
      this._jsonError = `resourceType must be CodeSystem`;
      return false;
    }
    this._jsonText = null;
    this._jsonError = null;
    if (JSON.stringify(normalize(parsed)) !== JSON.stringify(normalize(this.resource))) {
      this.replaceResource(parsed);
      if (this.selectedPath && !getConcept(this.resource, this.selectedPath)) this.selectedPath = null;
    }
    return true;
  }

  _renderJson() {
    const ro = this.isReadOnly;
    const text = this._jsonText ?? toJson(normalize(this.resource));
    return html`
      <div class="json">
        <div class="bar">
          <button class="primary" ?disabled=${ro || this._jsonText === null} @click=${() => this._applyJson()}>Apply</button>
          <button ?disabled=${this._jsonText === null} @click=${() => { this._jsonText = null; this._jsonError = null; }}>Discard edits</button>
          ${this._jsonError ? html`<span class="sev-error small">${this._jsonError}</span>`
            : html`<span class="muted small">${ro ? 'Read only' : 'Edits here apply when you leave this tab, or press Apply'}</span>`}
        </div>
        <textarea spellcheck="false" aria-label="Resource JSON" ?readonly=${ro} .value=${live(text)}
          @input=${e => { this._jsonText = e.target.value; this._jsonError = null; }}
          @keydown=${e => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              const t = e.target;
              t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end');
              this._jsonText = t.value;
            }
          }}></textarea>
      </div>`;
  }

  // --- issues ------------------------------------------------------------------

  _selectIssue(issue) {
    if (issue.conceptPath) {
      this.tab = 'concepts';
      this.updateComplete.then(() => this.renderRoot.querySelector('cs-concepts')?.select(issue.conceptPath, { focusCol: 'code' }));
    } else if (issue.section && issue.section !== 'issues') {
      this.showTab(issue.section);
    }
  }

  // --- render ------------------------------------------------------------------

  render() {
    if (!this.resource) {
      return html`
        ${this.message ? html`<div class="message sev-${this.message.severity}"><span>${this.message.text}</span></div>` : ''}
        <div class="loading">${this.busy ? 'Loading…' : this.host ? '' : 'Nothing open'}</div>`;
    }
    const r = this.resource;
    const ro = this.isReadOnly;
    const errors = this.issues.filter(i => i.severity === 'error').length;
    const warnings = this.issues.filter(i => i.severity === 'warning').length;
    const counts = {
      concepts: countConcepts(r),
      properties: (r.property || []).length,
      filters: (r.filter || []).length
    };
    return html`
      <header>
        <span class="title">${r.title || r.name || r.id || 'CodeSystem'}</span>
        ${ro ? html`<span class="ro">read only</span>` : ''}
        <span class="where" title=${this.host?.label || ''}>${this.host?.label || ''}</span>
        ${this.dirty ? html`<span class="dirty">● unsaved changes</span>` : ''}
        <button class="icon" title="Undo (Ctrl/Cmd+Z)" ?disabled=${ro || !this.canUndo} @click=${() => this.undo()}>↶</button>
        <button class="icon" title="Redo (Ctrl/Cmd+Shift+Z)" ?disabled=${ro || !this.canRedo} @click=${() => this.redo()}>↷</button>
        ${this.host?.validate ? html`<button ?disabled=${this.busy} @click=${() => this.validateWithHost()}>Validate</button>` : ''}
        <button class="primary" title="Save (Ctrl/Cmd+S)" ?disabled=${ro || this.busy || !this.dirty} @click=${() => this.save()}>
          ${this.busy ? 'Working…' : 'Save'}</button>
      </header>
      ${this.message ? html`<div class="message sev-${this.message.severity}">
        <span>${this.message.text}</span><button class="link" @click=${() => { this.message = null; }}>dismiss</button></div>` : ''}
      <nav role="tablist">
        ${TABS.map(t => html`
          <button role="tab" aria-selected=${this.tab === t.id} @click=${() => this.showTab(t.id)}>
            ${t.label}${counts[t.id] !== undefined ? html`<span class="count muted">${counts[t.id]}</span>` : ''}
            ${t.id === 'issues' && (errors || warnings) ? html`<span class="count ${errors ? 'sev-error' : 'sev-warning'}">${errors ? `${errors}●` : ''}${warnings ? ` ${warnings}▲` : ''}</span>` : ''}
          </button>`)}
      </nav>
      <main class=${this.tab === 'concepts' || this.tab === 'json' ? 'fill' : ''}>
        ${this._renderTab()}
      </main>
    `;
  }

  _renderTab() {
    switch (this.tab) {
      case 'concepts':
        return html`<cs-concepts .editor=${this} .revision=${this.revision} .ro=${this.isReadOnly} .issues=${this.issues} .selectedPath=${this.selectedPath}></cs-concepts>`;
      case 'properties':
        return html`<cs-properties .editor=${this} .revision=${this.revision} .ro=${this.isReadOnly} .issues=${this.issues}></cs-properties>`;
      case 'filters':
        return html`<cs-filters .editor=${this} .revision=${this.revision} .ro=${this.isReadOnly} .issues=${this.issues}></cs-filters>`;
      case 'json':
        return this._renderJson();
      case 'issues':
        return html`<fe-issue-list .issues=${this.issues} @fe-issue-select=${e => this._selectIssue(e.detail.issue)}></fe-issue-list>`;
      default:
        return html`<cs-metadata .editor=${this} .revision=${this.revision} .ro=${this.isReadOnly} .issues=${this.issues}></cs-metadata>`;
    }
  }
}

if (!customElements.get('cs-editor')) customElements.define('cs-editor', CodeSystemEditor);
