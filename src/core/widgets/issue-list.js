// <fe-issue-list>: shows validation issues.
//
//   .issues   [{severity, location, message, ...}]
//
// Fires 'fe-issue-select' with detail.issue when an issue is clicked.

import { LitElement, html, css } from 'lit';
import { controls } from '../styles.js';

const ICON = { error: '●', warning: '▲', information: 'ℹ' };

export class IssueList extends LitElement {
  static properties = {
    issues: { attribute: false },
    _show: { state: true }
  };

  static styles = [controls, css`
    :host { display: block; }
    .filters { display: flex; gap: 12px; margin-bottom: 8px; }
    label { display: inline-flex; gap: 4px; align-items: center; }
    ul { list-style: none; margin: 0; padding: 0; }
    li {
      display: grid; grid-template-columns: 1.2em 1fr; gap: 6px;
      padding: 5px 6px; border-bottom: 1px solid var(--_border); cursor: pointer;
    }
    li:hover { background: var(--_surface); }
    .loc { font-family: var(--_mono); font-size: 0.8em; color: var(--_muted); }
  `];

  constructor() {
    super();
    this.issues = [];
    this._show = { error: true, warning: true, information: false };
  }

  _toggle(sev) {
    this._show = { ...this._show, [sev]: !this._show[sev] };
  }

  render() {
    const counts = { error: 0, warning: 0, information: 0 };
    for (const i of this.issues) counts[i.severity]++;
    const shown = this.issues.filter(i => this._show[i.severity]);
    return html`
      <div class="filters">
        ${['error', 'warning', 'information'].map(s => html`
          <label class="sev-${s}"><input type="checkbox" .checked=${this._show[s]} @change=${() => this._toggle(s)}>
            ${counts[s]} ${s === 'information' ? 'info' : s + (counts[s] === 1 ? '' : 's')}</label>`)}
      </div>
      ${shown.length === 0 ? html`<div class="empty">${this.issues.length ? 'No issues of the selected kinds' : 'No issues found'}</div>` : html`
        <ul>
          ${shown.map(i => html`
            <li @click=${() => this.dispatchEvent(new CustomEvent('fe-issue-select', { detail: { issue: i }, bubbles: true, composed: true }))}>
              <span class="sev-${i.severity}" title=${i.severity}>${ICON[i.severity]}</span>
              <div><div>${i.message}</div>${i.location ? html`<div class="loc">${i.location}</div>` : ''}</div>
            </li>`)}
        </ul>`}
    `;
  }
}

if (!customElements.get('fe-issue-list')) customElements.define('fe-issue-list', IssueList);
