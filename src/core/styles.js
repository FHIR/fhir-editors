// Shared styles for all editors. Everything visual is driven by --fe-* custom
// properties, which inherit through shadow roots, so a host can restyle an
// editor by setting them on the editor element or any ancestor, e.g.
//
//   cs-editor { --fe-accent: #b00020; --fe-font: 13px system-ui; }
//
// `theme` resolves those into private --_* variables, and belongs only on the
// top-level editor element (the one with the optional theme="light|dark"
// attribute). Components nested inside an editor use `controls` only and inherit
// the resolved --_* variables - if they re-declared them, they would ignore the
// editor's theme attribute.

import { css } from 'lit';

export const theme = css`
  :host {
    --_bg: var(--fe-bg, #ffffff);
    --_surface: var(--fe-surface, #f6f7f9);
    --_fg: var(--fe-fg, #1d2330);
    --_muted: var(--fe-muted, #5f6b7a);
    --_border: var(--fe-border, #d5dae1);
    --_accent: var(--fe-accent, #2563c9);
    --_accent-fg: var(--fe-accent-fg, #ffffff);
    --_select: var(--fe-select, #dbe7fb);
    --_error: var(--fe-error, #c62828);
    --_warning: var(--fe-warning, #a15c00);
    --_info: var(--fe-info, #2d6a8f);
    --_mono: var(--fe-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    --_radius: var(--fe-radius, 4px);
    color: var(--_fg);
    font: var(--fe-font, 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif);
  }
  @media (prefers-color-scheme: dark) {
    :host(:not([theme='light'])) {
      --_bg: var(--fe-bg, #1b1f26);
      --_surface: var(--fe-surface, #242a33);
      --_fg: var(--fe-fg, #e3e7ed);
      --_muted: var(--fe-muted, #9aa5b3);
      --_border: var(--fe-border, #3a424e);
      --_accent: var(--fe-accent, #6ea0f0);
      --_accent-fg: var(--fe-accent-fg, #0d1117);
      --_select: var(--fe-select, #2c3d5a);
      --_error: var(--fe-error, #ef7b7b);
      --_warning: var(--fe-warning, #e0a34a);
      --_info: var(--fe-info, #7fb5d8);
    }
  }
  :host([theme='dark']) {
    --_bg: var(--fe-bg, #1b1f26);
    --_surface: var(--fe-surface, #242a33);
    --_fg: var(--fe-fg, #e3e7ed);
    --_muted: var(--fe-muted, #9aa5b3);
    --_border: var(--fe-border, #3a424e);
    --_accent: var(--fe-accent, #6ea0f0);
    --_accent-fg: var(--fe-accent-fg, #0d1117);
    --_select: var(--fe-select, #2c3d5a);
    --_error: var(--fe-error, #ef7b7b);
    --_warning: var(--fe-warning, #e0a34a);
    --_info: var(--fe-info, #7fb5d8);
  }
`;

export const controls = css`
  * { box-sizing: border-box; }
  input, select, textarea, button { font: inherit; color: inherit; }
  input, select, textarea {
    background: var(--_bg);
    border: 1px solid var(--_border);
    border-radius: var(--_radius);
    padding: 4px 6px;
    min-width: 0;
  }
  input:focus, select:focus, textarea:focus, button:focus-visible {
    outline: 2px solid var(--_accent);
    outline-offset: -1px;
  }
  input:disabled, select:disabled, textarea:disabled { opacity: 0.7; }
  input.invalid, select.invalid, textarea.invalid { border-color: var(--_error); }
  textarea { resize: vertical; width: 100%; }
  .mono, input.mono { font-family: var(--_mono); font-size: 0.93em; }
  button {
    background: var(--_surface);
    border: 1px solid var(--_border);
    border-radius: var(--_radius);
    padding: 4px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover:not(:disabled) { border-color: var(--_accent); }
  button:disabled { opacity: 0.45; cursor: default; }
  button.primary { background: var(--_accent); color: var(--_accent-fg); border-color: var(--_accent); }
  button.icon { padding: 2px 7px; min-width: 28px; }
  button.link { background: none; border: none; color: var(--_accent); padding: 0; }
  table.grid { border-collapse: collapse; width: 100%; }
  table.grid th {
    text-align: left; font-weight: 600; color: var(--_muted); font-size: 0.85em;
    padding: 4px 6px; border-bottom: 1px solid var(--_border);
  }
  table.grid td { padding: 3px 4px; vertical-align: top; }
  table.grid td input, table.grid td select { width: 100%; }
  .muted { color: var(--_muted); }
  .small { font-size: 0.85em; }
  .sev-error { color: var(--_error); }
  .sev-warning { color: var(--_warning); }
  .sev-information { color: var(--_info); }
  .empty { color: var(--_muted); font-style: italic; padding: 8px 0; }
  h3 { font-size: 1em; margin: 16px 0 8px; }
  h3:first-child { margin-top: 0; }
`;
