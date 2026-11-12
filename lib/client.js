/**
 * Client half: the DeepMemory console.
 *
 * Registered in four slots — `sidebar.panellist` owns the icon and resolves its
 * label from list metadata, `main` renders under that same key when the entry is
 * selected, `conversation.input.right` puts the four memory switches at the
 * composer's edge, and `conversation.view` adds a per-conversation memory tab.
 * The first two must share one id.
 *
 * Two rules shaped the styling:
 *
 * 1. Every colour is a `--dsw-alias-*` token, never a literal. The theme package
 *    declares the light palette on `body` and the dark one on
 *    `body[data-ds-dark-theme]`, so referencing the alias is all it takes for a
 *    control to follow the active theme — a media query would be wrong here,
 *    because the user can pick light/dark independently of the OS.
 * 2. The rules live in a real stylesheet injected into `document.head`, not in
 *    inline `style` props. Hover, focus rings, transitions and scrollbar styling
 *    are not expressible inline, and the rule text stays readable.
 *
 * No host data is imported: everything comes from `/api/deepmemory/*` on the
 * same origin, which carries the browser's authority-bound cookie. Two plain
 * React packages are required — `react` for the components and `react-dom` for
 * `createPortal`, which the switch menu needs because both places it opens from
 * clip their overflow. Every control is built here, so the bundle stays
 * independent of the host's client packages.
 */
window.__ModuleLoader__.load({
  id: '@emo-bird/dsh-deepmemory',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'deepmemory'
    const API = '/api/deepmemory'
    const STYLE_MARK = 'deepmemory/console.css'

    const TABS = [
      { id: 'overview', label: '概览' },
      { id: 'search', label: '搜索' },
      { id: 'memory', label: '记忆' },
      { id: 'sessions', label: '会话' },
      { id: 'settings', label: '设置' },
    ]

    // ------------------------------------------------------------------ style

    /**
     * Token cheat-sheet, because three families are easy to confuse:
     * - `brand-primary` is monochrome (near-black in light, near-white in dark).
     *   It is a contrast fill, NOT an accent colour.
     * - `button-primary-fill` and `label-primary-foreground` are a pair: fill
     *   with the former, paint text with the latter, and contrast survives the
     *   palette flip.
     * - `link` is the one real blue, legible on both backgrounds.
     */
    const CSS = `
.dm-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.dm-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 0 18px 28px; }
.dm-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 20px 18px 14px;
  flex-wrap: wrap;
}
.dm-title-row { display: flex; align-items: center; gap: 6px; }
.dm-title-icon { display: inline-flex; align-items: center; color: var(--dsw-alias-brand-primary); }
.dm-title { font-size: 17px; font-weight: 600; }
.dm-sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dm-spacer { flex: 1; }
/* Tab text has to land on the same left spine as the cards below it: the cards
   start at the scroll padding (18px), so the strip carries 8px and each tab
   10px of its own. */
.dm-tabs {
  display: flex;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  margin-bottom: 14px;
}
.dm-tab {
  cursor: pointer;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              border-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-tab:hover { color: var(--dsw-alias-label-primary); }
.dm-tab[data-active='true'] {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  border-bottom-color: var(--dsw-alias-label-primary);
}
.dm-btn {
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dm-btn[data-kind='primary'] {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dm-btn[data-kind='primary']:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill));
}
.dm-btn:disabled { opacity: .5; cursor: default; }
.dm-card {
  border: 1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  padding: 14px 16px;
  margin-bottom: 10px;
}
.dm-card-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.dm-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-bottom: 6px; }
.dm-meta {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  margin-top: 6px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.dm-body { font-size: 14px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.dm-body-sm { font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.dm-empty { font-size: 13px; color: var(--dsw-alias-label-tertiary); padding: 28px 0; text-align: center; }
.dm-error {
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 6px 10px;
  margin: 0 18px 10px;
}
/* The missed-day reminder: a warm strip, not an alarm, and never a modal. */
.dm-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 9px 12px;
  border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-state-warn-secondary);
  background: var(--dsw-alias-state-warn-tertiary);
}
.dm-notice-text { flex: 1 1 240px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-state-warn-label); }
.dm-notice-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.dm-notice-note { flex-basis: 100%; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dm-toolbar { display: flex; gap: 8px; align-items: center; margin-top: 16px; margin-bottom: 0; flex-wrap: wrap; }
.dm-input {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 5px 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  outline: none;
  transition: border-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-input:focus { border-color: var(--dsw-alias-label-tertiary); }
.dm-input::placeholder { color: var(--dsw-alias-label-tertiary); }
/* A fixed four-column grid instead of a wrapping flex row: with flex the
   fourth tile dropped onto its own line as soon as the window narrowed a
   little, which broke the alignment against the cards underneath. */
.dm-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
@media (max-width: 720px) { .dm-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.dm-stat {
  border: 1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  padding: 14px 16px;
  min-width: 0;
}
.dm-stat-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dm-stat-value { font-size: 26px; font-weight: 600; line-height: 1.3; font-variant-numeric: tabular-nums; }
.dm-actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
/* ------------------------------------------------------------- model list
   One row per model, laid out as a card rather than a six-column table: the
   table forced the note into a narrow column and wrapped the buttons onto two
   lines at panel width. */
.dm-models { display: flex; flex-direction: column; gap: 8px; }
.dm-model {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
}
.dm-model[data-active='true'] { border-color: var(--dsw-alias-link); }
.dm-model-main { min-width: 0; flex: 1; }
.dm-model-title { display: flex; align-items: center; gap: 8px; }
.dm-model-name { font-weight: 600; }
.dm-model-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dm-model-meta code { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dm-model-note { margin-top: 5px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dm-model-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; min-width: 150px; }
.dm-model-job { width: 150px; }
.dm-model-job-text { margin-top: 3px; font-size: 11px; color: var(--dsw-alias-label-tertiary); text-align: right; }
.dm-badge {
  font-size: 11px;
  line-height: 1.5;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dm-badge-quiet { background: transparent; color: var(--dsw-alias-label-tertiary); border: 1px solid var(--dsw-alias-border-l2); }
.dm-preset-id { font-size: 12px; font-weight: 600; color: var(--dsw-alias-link); margin-bottom: 4px; }
/* Presets as side-by-side cards. A profile holds half a dozen presets, and as a
   vertical stack each one took a full row for two short switch triggers. The
   grid wraps on its own, so a narrow panel simply gets fewer columns. */
.dm-preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(176px, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.dm-preset-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
}
.dm-preset-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; margin-bottom: 2px; }
.dm-preset-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dm-preset-head .dm-preset-id { margin-bottom: 0; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.dm-textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 72px; font: inherit; line-height: 1.5; }
.dm-filter-row .dm-input { flex: 1 1 160px; min-width: 120px; }
    .dm-select { flex: 0 1 300px; min-width: 200px; cursor: pointer; font: inherit; }
.dm-toggle { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; cursor: pointer; }
.dm-toggle input { margin-top: 3px; cursor: pointer; accent-color: var(--dsw-alias-link); }
.dm-toggle-text { display: flex; flex-direction: column; }
.dm-toggle-label { font-size: 13px; }
.dm-toggle-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dm-inline { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
/* The four memory switches, as one trigger plus the host's own menu card.
   The trigger is deliberately plain — it sits in the composer strip beside the
   model and mode pickers, and in a list row beside the session name — so it
   borrows their shape instead of inventing a second visual language. */
.dm-flags { display: inline-flex; align-items: center; }
.dm-flags-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  box-sizing: border-box;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm);
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
              color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dm-flags-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dm-flags-btn[aria-expanded='true'] { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
.dm-flags-glyph { font-size: 11px; font-weight: 600; }
.dm-flags-count { font-variant-numeric: tabular-nums; }
/* The menu card copies the host's Menu primitive rule for rule: same surface,
   same elevation, same row metrics. It is portalled to the body and positioned
   from the trigger's rect, because the composer and the list row both clip
   their overflow. */
.dm-menu {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  padding: 4px;
  display: flex;
  flex-direction: column;
  border: 0;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-menu-surface-fill);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  box-shadow: var(--dsw-elevation-prominent);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
}
.dm-menu-label {
  padding: 6px 8px;
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
}
.dm-menu-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  min-height: 30px;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.dm-menu-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dm-menu-row[data-busy='true'] { opacity: .6; }
.dm-menu-glyph {
  width: 16px;
  flex: none;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-menu-icon);
}
.dm-menu-row[data-on='true'] .dm-menu-glyph { color: var(--dsw-alias-state-success-primary); }
.dm-menu-text { flex: 1; min-width: 0; }
.dm-menu-state { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dm-menu-row[data-on='true'] .dm-menu-state { color: var(--dsw-alias-state-success-primary); }
.dm-menu-sep { height: .5px; margin: 3px 8px; background: var(--dsw-alias-border-l2); }
.dm-menu-error { padding: 4px 8px; font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.dm-preset-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 0; }
.dm-preset-row-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dm-role {
  font-size: 10px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dm-role[data-role='assistant'] {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  max-width: 380px;
}
.dm-hit {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dm-hit:last-child { border-bottom: 0; }
.dm-hit-kind {
  flex: none;
  min-width: 34px;
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dm-hit-body { flex: 1; min-width: 0; word-break: break-word; }
.dm-sid {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  word-break: break-all;
  color: var(--dsw-alias-label-tertiary);
}
.dm-progress {
  height: 6px;
  border-radius: 3px;
  background: var(--dsw-alias-bg-layer-3);
  overflow: hidden;
  margin: 6px 0 4px;
}
.dm-progress-fill {
  height: 100%;
  background: var(--dsw-alias-link);
  transition: width var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease);
}
.dm-mark { background: transparent; color: var(--dsw-alias-link); font-weight: 600; }

/* ---------------------------------------------------------------- overview */

/* Both columns stretch to the taller one, so the page ends on one straight
   line instead of a ragged pair of stacks. The panel that absorbs the slack
   clips its own body rather than pushing the column past its neighbour. */
.dm-grid-ov { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: stretch; }
@media (max-width: 900px) { .dm-grid-ov { grid-template-columns: minmax(0, 1fr); } }
.dm-sec { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dm-panel.dm-fill { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.dm-panel {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1);
  padding: 14px 16px;
  margin-bottom: 0;
  min-width: 0;
  box-sizing: border-box;
}
.dm-panel-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.dm-panel-title { font-size: 14px; font-weight: 600; }
.dm-panel-sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
/* The contribution wall: one column per week, one cell per day, five tints of
   the same token. Values 0..4 are a bucket, never a raw count, because the wall
   compares days to each other rather than reporting a number. */
.dm-wall { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 2px; }
.dm-wall-dow {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  gap: 3px;
  flex: none;
  padding-top: 15px;
}
.dm-wall-dow span { font-size: 9px; line-height: 11px; color: var(--dsw-alias-label-tertiary); }
.dm-wall-weeks { display: flex; gap: 3px; }
.dm-wall-week { display: grid; grid-template-rows: repeat(7, 11px); gap: 3px; }
.dm-wall-cell {
  width: 11px;
  height: 11px;
  box-sizing: border-box;
  border-radius: 2px;
  background: var(--dsw-alias-bg-layer-3);
  transition: outline-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
  outline: 1px solid transparent;
  outline-offset: -1px;
}
.dm-wall-cell[data-level='1'] { background: var(--dsw-alias-brand-primary); opacity: .22; }
.dm-wall-cell[data-level='2'] { background: var(--dsw-alias-brand-primary); opacity: .42; }
.dm-wall-cell[data-level='3'] { background: var(--dsw-alias-brand-primary); opacity: .68; }
.dm-wall-cell[data-level='4'] { background: var(--dsw-alias-brand-primary); opacity: 1; }
.dm-wall-cell[data-out='true'] { visibility: hidden; }
.dm-wall-cell[data-today='true'] { outline-color: var(--dsw-alias-label-secondary); }
.dm-wall-cell[data-selected='true'] { outline-color: var(--dsw-alias-label-primary); outline-width: 2px; }
.dm-wall-cell[data-gap='true'] { box-shadow: inset 0 0 0 1px var(--dsw-alias-state-warn-primary); }
.dm-wall-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  flex-wrap: wrap;
}
.dm-wall-legend { display: flex; align-items: center; gap: 3px; }
.dm-wall-legend .dm-wall-cell { cursor: default; }
.dm-list-item {
  padding: 9px 10px;
  margin: 0 -10px;
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-list-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
/* A list row that is also a control: the button element must not bring its own
   font, width or focus ring shape, or it will not line up with the rows above. */
.dm-row-hit {
  display: block;
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
}
.dm-row-hit:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
/* One row shape for all three previews (事实 / 片段 / 日记). The overview, the
   day panel and the session list all read the same way, so a reader never has
   to relearn where the kind, the time and the text sit. */
.dm-item-kind { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
.dm-item-kind[data-kind='diary'] { color: var(--dsw-alias-brand-primary); }
.dm-wall-wrap { position: relative; }
/* The tooltip is ours rather than the browser title attribute: a native one waits
   about a second and shows one line, and this wall is dense enough that the
   hover has to answer immediately. */
.dm-wall-tip {
  position: absolute;
  z-index: 30;
  transform: translate(-50%, -100%);
  margin-top: -6px;
  min-width: 132px;
  padding: 7px 9px;
  box-sizing: border-box;
  pointer-events: none;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 8px);
  box-shadow: 0 8px 24px var(--dsw-alias-bg-mask-3);
}
.dm-wall-tip-day { font-variant-numeric: tabular-nums; margin-bottom: 2px; }
.dm-wall-tip-row { display: flex; gap: 8px; justify-content: space-between; color: var(--dsw-alias-label-secondary); }
.dm-wall-tip-row b { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dm-wall-tip-hint { margin-top: 3px; font-size: 11px; color: var(--dsw-alias-state-warn-primary); }
.dm-wall-cell { cursor: pointer; }
.dm-wall-cell:hover { outline-color: var(--dsw-alias-label-tertiary); }
/* The session list keeps every page's grammar: panels, list rows, chips. It
   used to be two tables, which read as a different product. */
.dm-sess-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 9px 10px;
  margin: 0 -10px;
  border-radius: var(--dsw-radius-sm, 8px);
}
.dm-sess-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dm-sess-main { flex: 1; min-width: 0; cursor: pointer; }
.dm-sess-title { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.dm-sess-first { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; overflow-wrap: anywhere; }
.dm-sess-side { flex: none; display: flex; align-items: center; gap: 4px; }
.dm-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ------------------------------------------------------------------ memory */

.dm-mem { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 820px) { .dm-mem { grid-template-columns: minmax(0, 1fr); } }
.dm-mem-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dm-cal-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.dm-cal-month { flex: 1; text-align: center; font-size: 12px; font-weight: 600; }
.dm-cal-dow { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px; }
.dm-cal-dow span { text-align: center; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dm-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.dm-cal-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: pointer;
  border: 1px solid transparent;
  box-sizing: border-box;
  transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-cal-cell:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dm-cal-cell[data-out='true'] { opacity: .35; }
.dm-cal-cell[data-today='true'] { border-color: var(--dsw-alias-border-l2); }
.dm-cal-cell[data-selected='true'] { border-color: var(--dsw-alias-label-primary); }
.dm-cal-shade {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--dsw-alias-label-primary);
  opacity: 0;
  pointer-events: none;
}
.dm-cal-shade[data-level='1'] { opacity: .06; }
.dm-cal-shade[data-level='2'] { opacity: .12; }
.dm-cal-shade[data-level='3'] { opacity: .2; }
.dm-cal-shade[data-level='4'] { opacity: .3; }
.dm-cal-num { position: relative; font-size: 11px; }
.dm-cal-gap {
  position: absolute;
  right: 4px;
  bottom: 3px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
}
/* The three catalogues read as a file tree, not as a row of chips: the two
   with children indent those children under themselves, so the shape of the
   column says "this one opens" before anything is clicked. Rows are 30px tall
   with a 16px icon, which is what the workspace tree beside the panel uses. */
.dm-tree { display: flex; flex-direction: column; gap: 1px; }
.dm-tree-row {
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px 5px 4px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-tree-row:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dm-tree-row[data-on='true'] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
.dm-tree-caret {
  flex: none;
  width: 14px;
  text-align: center;
  font-size: 9px;
  line-height: 1;
  color: var(--dsw-alias-label-tertiary);
  transition: transform var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-tree-caret[data-open='true'] { transform: rotate(90deg); }
.dm-tree-icon { flex: none; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; }
.dm-tree-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-tree-count {
  flex: none;
  font-size: 11px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
/* Children hang under their parent: a leaf keeps the caret column (so the row
   height matches) and pads past where the parent's icon sits, which puts its
   label 16px deeper than the parent's - 62px against the parent's 46px. */
.dm-tree-leaf { padding-left: 42px; font-size: 12px; }
.dm-tree-empty { padding: 3px 8px 3px 62px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dm-day-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.dm-day-title { font-size: 13px; font-weight: 600; }
.dm-empty-action { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 0; }
.dm-filter-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.dm-filter-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); min-width: 56px; }
.dm-group-title { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin: 12px 0 6px; }
.dm-group-title:first-child { margin-top: 0; }
/* Panels no longer carry their own bottom margin (the overview grid needs the
   gap on the grid, not on each child), so pages that stack panels say so. */
.dm-stack { display: flex; flex-direction: column; gap: 16px; }
`

    /**
     * Injects the stylesheet once. The host loads each bundle's client module
     * in its own `__ModuleLoader__` call, so a re-activation (HMR, plugin
     * reload) would otherwise stack duplicates; the marker attribute makes the
     * second install a no-op.
     */
    function installStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_MARK}"]`) !== null) return
      const style = document.createElement('style')
      style.dataset.plugin = '@emo-bird/dsh-deepmemory'
      style.dataset.pluginCss = STYLE_MARK
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ------------------------------------------------------------------- data

    async function apiGet(path, params) {
      const query = params === undefined ? '' : `?${new URLSearchParams(params).toString()}`
      const response = await fetch(`${API}${path}${query}`, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`${path} ${response.status}`)
      return response.json()
    }

    async function apiPost(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${path} ${response.status}`)
      return response.json()
    }

    const fmtTime = (ms) => {
      const d = new Date(Number(ms))
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    // -------------------------------------------------------------- primitives

    function Button({ children, onClick, kind, disabled, title }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dm-btn',
          'data-kind': kind ?? 'ghost',
          onClick: disabled ? undefined : onClick,
          disabled: disabled === true,
          title,
        },
        children,
      )
    }

    function Toggle({ checked, onChange, label, hint }) {
      return h(
        'label',
        { className: 'dm-toggle' },
        h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }),
        h(
          'span',
          { className: 'dm-toggle-text' },
          h('span', { className: 'dm-toggle-label' }, label),
          hint === undefined ? null : h('span', { className: 'dm-toggle-hint' }, hint),
        ),
      )
    }

    const Card = ({ children, title }) =>
      h(
        'div',
        { className: 'dm-card' },
        title === undefined ? null : h('div', { className: 'dm-card-title' }, title),
        children,
      )

    const Empty = ({ children }) => h('div', { className: 'dm-empty' }, children)

    const Toolbar = ({ children }) => h('div', { className: 'dm-toolbar' }, children)

    const ErrorBar = ({ error }) => (error === null ? null : h('div', { className: 'dm-error' }, error))

    const MB = 1024 * 1024
    const megabytes = (bytes) => (Math.max(0, Number(bytes) || 0) / MB).toFixed(1)

    /**
     * "12.4 MB / 320.0 MB (4%)" with a bar underneath.
     *
     * The denominator is the host's estimate, not a measured total, so the bar
     * is a progress hint rather than a countdown. When the install finishes the
     * number shown is the real size on disk.
     */
    function renderProgress(progress, installing) {
      if (progress === null || progress === undefined) return null
      if (progress.phase === 'idle') return null
      const bytes = Number(progress.bytes) || 0
      const total = Number(progress.totalBytes) || 0
      const pct = total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : 0
      const label = `${megabytes(bytes)} MB / ${total > 0 ? `${megabytes(total)} MB` : '—'}${total > 0 ? `（${pct}%）` : ''}`
      const note =
        progress.phase === 'error'
          ? `安装失败：${progress.error ?? '未知错误'}`
          : installing || progress.phase === 'installing'
            ? `正在写入 ${label}`
            : `已落盘 ${label}`
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dm-progress' },
          h('div', {
            className: 'dm-progress-fill',
            style: { width: `${installing || progress.phase === 'installing' ? Math.max(2, pct) : 100}%` },
          }),
        ),
        h('div', { className: 'dm-meta', style: { marginTop: 0 } }, note),
      )
    }

    // -------------------------------------------------------------- date helpers

    const pad2 = (n) => String(n).padStart(2, '0')
    const dayFromDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    const todayKey = () => dayFromDate(new Date())
    const monthOf = (day) => String(day).slice(0, 7)

    /** A `YYYY-MM-DD` key as a local Date. Monday-first maths depends on the weekday. */
    function parseDay(day) {
      const [year, month, date] = String(day).split('-').map(Number)
      return new Date(year, (month ?? 1) - 1, date ?? 1, 12, 0, 0, 0)
    }


    const shiftMonth = (month, delta) => {
      const [year, index] = String(month).split('-').map(Number)
      const moved = new Date(year, index - 1 + delta, 1)
      return `${moved.getFullYear()}-${pad2(moved.getMonth() + 1)}`
    }

    /**
     * Every cell of the month grid, Monday first.
     *
     * The leading and trailing days of the neighbouring months are included so
     * the grid is always seven columns wide; the calendar greys them out rather
     * than leaving holes, which is also why the range request covers them.
     */
    function monthCells(month) {
      const [year, index] = String(month).split('-').map(Number)
      const first = new Date(year, index - 1, 1)
      const days = new Date(year, index, 0).getDate()
      const lead = (first.getDay() + 6) % 7
      const total = Math.ceil((lead + days) / 7) * 7
      const cells = []
      for (let step = 0; step < total; step += 1) {
        cells.push(dayFromDate(new Date(year, index - 1, 1 - lead + step)))
      }
      return cells
    }

    // ------------------------------------------------------------------ items

    const ROLE_LABEL = { user: '你', assistant: '它' }

    const shortTime = (ms) => {
      const d = new Date(Number(ms))
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    }

    function FactCard({ item, onForget }) {
      return h(
        'div',
        { className: 'dm-card' },
        h('div', { className: 'dm-body' }, item.text),
        h(
          'div',
          { className: 'dm-meta' },
          h('span', null, `权重 ${item.weight}`),
          item.subject === '' || item.subject === undefined ? null : h('span', null, `对象 ${item.subject}`),
          h('span', null, fmtTime(item.createdAt)),
          h('span', { className: 'dm-spacer' }),
          onForget === undefined
            ? null
            : h(Button, {
                onClick: () => {
                  if (!window.confirm('删掉这条事实？删了就找不回来。')) return
                  void onForget(item)
                },
              }, '删除'),
        ),
      )
    }

    function FragmentCard({ item, onForget }) {
      return h(
        'div',
        { className: 'dm-card' },
        h(
          'div',
          { className: 'dm-meta', style: { marginTop: 0, marginBottom: 4 } },
          h('span', { className: 'dm-role', 'data-role': item.role }, ROLE_LABEL[item.role] ?? item.role),
          h('span', null, shortTime(item.createdAt)),
          item.presetId === undefined || item.presetId === '' ? null : h('span', null, item.presetId),
          h('span', { className: 'dm-spacer' }),
          onForget === undefined
            ? null
            : h(Button, {
                onClick: () => {
                  if (!window.confirm('删掉这条片段？删了就找不回来。')) return
                  void onForget(item)
                },
              }, '删除'),
        ),
        h('div', { className: 'dm-body-sm' }, item.text),
      )
    }

    /**
     * One preview row, shared by every list that mixes the three tables.
     *
     * The overview's diary preview used to be its own thing — a paragraph that
     * clipped and a whole-card click target — while the fragments beside it were
     * rows with meta, a clamp and term highlighting. Same data, two grammars.
     * This is the one row: kind, who said it, when, two clamped lines, and an
     * optional delete. A row that navigates is a button for the keyboard; a row
     * that only reports is a div.
     */
    function MemoryRow({ kind, item, query, onClick, onForget, extra }) {
      const interactive = typeof onClick === 'function'
      const meta = [
        kind === 'episode'
          ? h('span', { key: 'role', className: 'dm-role', 'data-role': item.role }, ROLE_LABEL[item.role] ?? item.role)
          : null,
        h('span', { key: 'kind', className: 'dm-item-kind', 'data-kind': kind }, KIND_LABEL[kind] ?? kind),
        h('span', { key: 'when' }, shortTime(item.createdAt)),
        extra === undefined ? null : h('span', { key: 'extra' }, extra),
      ].filter(Boolean)
      return h(
        interactive ? 'button' : 'div',
        {
          type: interactive ? 'button' : undefined,
          className: 'dm-list-item dm-row-hit',
          onClick,
          onKeyDown: interactive
            ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onClick()
              }
            : undefined,
          title: interactive ? '打开这一天' : undefined,
        },
        h(
          'div',
          { className: 'dm-meta', style: { marginTop: 0, marginBottom: 2 } },
          meta,
          onForget === undefined
            ? null
            : h(
                Button,
                {
                  onClick: (event) => {
                    if (event?.stopPropagation) event.stopPropagation()
                    if (!window.confirm('删掉这条记录？删了就找不回来。')) return
                    void onForget(item)
                  },
                },
                '删除',
              ),
        ),
        h('div', { className: 'dm-body-sm dm-clamp-2' }, highlight(item.text, query)),
      )
    }

    // ------------------------------------------------------------------ calendar

    /**
     * One month at a time, each day tinted by how much was recorded.
     *
     * Two independent signals share a cell: the fill says how active the day was
     * (relative to the busiest day in view, so the scale always uses the whole
     * range), and the dot says a page is missing for a day that had material.
     * The fill is the label colour at low opacity rather than a hard-coded
     * grey, so it flips with the theme.
     */
    function Calendar({ month, days, selected, onSelect, onShift, showMissing }) {
      const cells = monthCells(month)
      const counts = cells.map((day) => {
        const row = days[day]
        return row === undefined ? 0 : (Number(row.episodes) || 0) + (Number(row.facts) || 0)
      })
      const top = Math.max(1, ...counts)
      const level = (count) => (count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((count / top) * 4))))
      const today = todayKey()
      return h(
        'div',
        { className: 'dm-panel' },
        h(
          'div',
          { className: 'dm-cal-head' },
          h(Button, { onClick: () => onShift(-1), title: '上个月' }, '‹'),
          h('span', { className: 'dm-cal-month' }, month.replace('-', ' 年 ') + ' 月'),
          h(Button, { onClick: () => onShift(1), title: '下个月' }, '›'),
        ),
        h(
          'div',
          { className: 'dm-cal-dow' },
          ['一', '二', '三', '四', '五', '六', '日'].map((name) => h('span', { key: name }, name)),
        ),
        h(
          'div',
          { className: 'dm-cal-grid' },
          cells.map((day, index) =>
            h(
              'div',
              {
                key: day,
                className: 'dm-cal-cell',
                'data-out': monthOf(day) === month ? 'false' : 'true',
                'data-today': day === today ? 'true' : 'false',
                'data-selected': day === selected ? 'true' : 'false',
                title: `${day}：${counts[index]} 条${
                  showMissing === true && days[day]?.missing === true ? '（缺日记）' : ''
                }`,
                onClick: () => onSelect(day),
              },
              h('span', { className: 'dm-cal-shade', 'data-level': level(counts[index]) }),
              h('span', { className: 'dm-cal-num' }, String(Number(day.slice(8)))),
              showMissing === true && days[day]?.missing === true
                ? h('span', { className: 'dm-cal-gap' })
                : null,
            ),
          ),
        ),
      )
    }

    // --------------------------------------------------------------- memory page

    const MEMORY_CATEGORIES = {
      day: [
        { id: 'diary', label: '日记', count: (row) => row?.diary ?? 0 },
        // 片段 ahead of 事实 on purpose: fragments are what a day actually
        // accumulates, so the catalogue opens on the populated branch instead of
        // leading with an empty one.
        { id: 'episodes', label: '片段', count: (row) => row?.episodes ?? 0 },
        { id: 'facts', label: '事实', count: (row) => row?.facts ?? 0 },
      ],
      session: [
        { id: 'episodes', label: '片段', count: (row) => row?.episodes ?? 0 },
        { id: 'facts', label: '事实', count: (row) => row?.facts ?? 0 },
      ],
    }

    /**
     * The catalogues, drawn as a file tree.
     *
     * `日记` is the only one with children - a day can hold one page per
     * delivery - so it gets a caret and lists its pages underneath. 事实 and
     * 片段 have no children: clicking them puts the day's rows on the right
     * immediately. The caret only rotates when the row is open; an empty day
     * still opens and says so, because "nothing here" is information too.
     */
    const TREE_ICON = {
      diary: 'M3.5 2.5h6L12.5 5.5v8h-9z M9.5 2.5v3h3',
      facts: 'M8 2.4l5.6 5.6L8 13.6 2.4 8z',
      episodes: 'M3 4h10 M3 8h10 M3 12h7',
    }

    function TreeIcon({ kind }) {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: TREE_ICON[kind] ?? TREE_ICON.facts }),
      )
    }

    function CategoryTree({ categories, counts, kind, onPick, pages, pageId, onPickPage }) {
      const rows = []
      for (const category of categories) {
        const count = category.count(counts)
        const active = kind === category.id
        const hasChildren = category.id === 'diary'
        rows.push(
          h(
            'button',
            {
              key: category.id,
              type: 'button',
              className: 'dm-tree-row',
              'data-on': active ? 'true' : 'false',
              onClick: () => onPick(category.id),
            },
            hasChildren
              ? h('span', { className: 'dm-tree-caret', 'data-open': active ? 'true' : 'false' }, '▶')
              : h('span', { className: 'dm-tree-caret' }),
            h('span', { className: 'dm-tree-icon' }, h(TreeIcon, { kind: category.id })),
            h('span', { className: 'dm-tree-label' }, category.label),
            h('span', { className: 'dm-tree-count' }, String(count)),
          ),
        )
        if (!hasChildren || !active) continue
        if (pages.length === 0) {
          rows.push(
            h('div', { key: `${category.id}-empty`, className: 'dm-tree-empty' }, '这一天还没有日记'),
          )
          continue
        }
        pages.forEach((page, index) => {
          rows.push(
            h(
              'button',
              {
                key: page.id,
                type: 'button',
                className: 'dm-tree-row dm-tree-leaf',
                'data-on': pageId === page.id ? 'true' : 'false',
                onClick: () => onPickPage(page),
              },
              h('span', { className: 'dm-tree-caret' }),
              h('span', { className: 'dm-tree-label' }, `第 ${index + 1} 篇 · ${shortTime(page.createdAt)}`),
            ),
          )
        })
      }
      return h('div', { className: 'dm-tree' }, rows)
    }

    /**
     * The memory page, and the conversation tab that mirrors it.
     *
     * `sessionId` is the only difference: with it the calendar, the categories
     * and the day request are all narrowed to one conversation, and the diary
     * category disappears (a page belongs to a day, not to a session). The
     * layout is the same otherwise, which is why this is one component.
     */
    function MemoryBoard({ sessionId, focus }) {
      const scope = sessionId === undefined ? 'day' : 'session'
      const categories = MEMORY_CATEGORIES[scope]
      const [month, setMonth] = useState(monthOf(focus?.day ?? todayKey()))
      const [selected, setSelected] = useState(focus?.day ?? todayKey())
      const [kind, setKind] = useState(focus?.kind ?? categories[0].id)
      const [pageId, setPageId] = useState(null)
      const [days, setDays] = useState({})
      const [detail, setDetail] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState(null)
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)

      const scopeParam = sessionId === undefined ? {} : { sessionId }

      const loadMonth = useCallback(async () => {
        const cells = monthCells(month)
        try {
          const body = await apiGet('/calendar', { from: cells[0], to: cells[cells.length - 1], ...scopeParam })
          const next = {}
          for (const row of body.days ?? []) next[row.day] = row
          setDays(next)
        } catch (cause) {
          setError(`读取日历失败：${String(cause?.message ?? cause)}`)
        }
      }, [month, sessionId])

      const loadDetail = useCallback(async () => {
        setLoading(true)
        try {
          const body = await apiGet('/day', { day: selected, ...scopeParam })
          setDetail(body)
        } catch (cause) {
          setError(`读取当日内容失败：${String(cause?.message ?? cause)}`)
          setDetail(null)
        } finally {
          setLoading(false)
        }
      }, [selected, sessionId])

      useEffect(() => {
        void loadMonth()
      }, [loadMonth])

      useEffect(() => {
        void loadDetail()
      }, [loadDetail])

      useEffect(() => {
        if (focus?.day === undefined) return
        setSelected(focus.day)
        setMonth(monthOf(focus.day))
        if (focus.kind !== undefined) setKind(focus.kind)
      }, [focus])

      // 补写 fills a day that has no page; 重写 asks for another page on a day
      // that already has one. Both are one-shots aimed at the clicked day: the
      // recurring task derives its day from the clock, so running it would write
      // today instead of whatever was clicked.
      const writeDay = async (mode) => {
        setBusy(true)
        setNote('')
        const rewrite = mode === 'rewrite'
        try {
          await apiPost('/backfill', { day: selected, mode: rewrite ? 'rewrite' : 'fill' })
          setNote(
            rewrite
              ? `已排一个重写 ${selected} 的一次性任务：会加一篇新的，旧的那篇不动。`
              : `已排一个只写 ${selected} 的一次性任务。`,
          )
          window.setTimeout(() => {
            void loadMonth()
            void loadDetail()
          }, 4000)
        } catch (cause) {
          setNote(`${rewrite ? '重写' : '补写'}没排上：${String(cause?.message ?? cause)}`)
        } finally {
          setBusy(false)
        }
      }

      const forget = async (payload) => {
        setBusy(true)
        try {
          await apiPost('/forget', payload)
          await loadDetail()
          await loadMonth()
        } finally {
          setBusy(false)
        }
      }

      const row = days[selected]
      const pages = detail?.diary ?? []
      const facts = detail?.facts ?? []
      const episodes = detail?.episodes ?? []
      // Counts come from the day itself, not from the calendar row: the row can
      // be a neighbouring-month cell or a stale one right after a write.
      const counts = detail?.counts ?? { diary: row?.diary ?? 0, facts: row?.facts ?? 0, episodes: row?.episodes ?? 0 }
      // The tree picks a page, not a day: a day can hold several, and the right
      // side then shows that one instead of stacking them all.
      const activePage = pages.find((page) => page.id === pageId) ?? pages[0] ?? null

      let content = null
      if (loading && detail === null) content = h(Empty, null, '读取中…')
      else if (kind === 'diary') {
        content =
          activePage === null
            ? h(
                'div',
                { className: 'dm-empty-action' },
                h('div', { className: 'dm-empty', style: { padding: 0 } }, '这一天没有日记。'),
                detail?.missing === true
                  ? h(Button, { kind: 'primary', disabled: busy, onClick: () => void writeDay('fill') }, '补写这一天')
                  : h('div', { className: 'dm-hint' }, '这一天也没有素材，补写会直接跳过。'),
              )
            : h(
                'div',
                null,
                activePage.origin === '' ? null : h('div', { className: 'dm-badge dm-badge-quiet', style: { marginBottom: 6, display: 'inline-block' } }, '定时任务'),
                h('div', { className: 'dm-body' }, activePage.text),
                h(
                  'div',
                  { className: 'dm-meta' },
                  h('span', null, fmtTime(activePage.createdAt)),
                  h('span', { className: 'dm-spacer' }),
                  h(
                    Button,
                    { disabled: busy, onClick: () => forget({ kind: 'diary', id: activePage.id }) },
                    '删除这篇',
                  ),
                ),
              )
      } else if (kind === 'facts') {
        content =
          facts.length === 0
            ? h(Empty, null, '这一天没有新事实。')
            : facts.map((item) =>
                h(FactCard, {
                  key: item.id,
                  item,
                  onForget: (target) => forget({ kind: 'fact', id: target.id }),
                }),
              )
      } else {
        content =
          episodes.length === 0
            ? h(Empty, null, '这一天没有片段。')
            : episodes.map((item) =>
                h(FragmentCard, {
                  key: item.id,
                  item,
                  onForget: (target) => forget({ kind: 'episode', id: target.id }),
                }),
              )
      }

      return h(
        'div',
        null,
        h(ErrorBar, { error }),
        // The reminder belongs to the panel's own scope: a per-conversation view
        // must not claim a day the whole profile missed.
        scope === 'day'
          ? h(MissedNotice, {
              onDone: () => {
                void loadMonth()
                void loadDetail()
              },
            })
          : null,
        h(
          'div',
          { className: 'dm-mem' },
          h(
            'div',
            { className: 'dm-mem-side' },
            h(Calendar, {
              month,
              days,
              selected,
              onSelect: (day) => {
                setSelected(day)
                setPageId(null)
              },
              onShift: (delta) => setMonth(shiftMonth(month, delta)),
              showMissing: scope === 'day',
            }),
            h(
              'div',
              { className: 'dm-panel' },
              h(
                'div',
                { className: 'dm-panel-head' },
                // No title on purpose: the day is already in the panel above and
                // in the right-hand header, and a third "目录" label added a word
                // without adding information.
                h('span', { className: 'dm-panel-sub' }, selected),
              ),
              h(CategoryTree, {
                categories,
                counts,
                kind,
                onPick: (id) => {
                  setKind(id)
                  setPageId(null)
                },
                pages,
                pageId: activePage?.id ?? null,
                onPickPage: (page) => {
                  setKind('diary')
                  setPageId(page.id)
                },
              }),
            ),
          ),
          h(
            'div',
            { className: 'dm-panel' },
            h(
              'div',
              { className: 'dm-day-head' },
              h('span', { className: 'dm-day-title' }, selected),
              h(
                'span',
                { className: 'dm-panel-sub' },
                `片段 ${counts.episodes} · 事实 ${counts.facts}` + (scope === 'day' ? ` · 日记 ${counts.diary}` : ''),
              ),
              h('span', { className: 'dm-spacer' }),
              // One action per state: a day with no page gets 补写, a day that has
              // one gets 重写 (which adds a page instead of replacing it). Showing
              // both would only ask the reader to know which one they need.
              scope === 'day' && kind === 'diary'
                ? pages.length === 0
                  ? detail?.missing === true
                    ? h(Button, { kind: 'primary', disabled: busy, onClick: () => void writeDay('fill') }, '补写')
                    : null
                  : h(Button, { disabled: busy, onClick: () => void writeDay('rewrite') }, '重写这一天')
                : null,
            ),
            note === '' ? null : h('div', { className: 'dm-hint' }, note),
            content,
          ),
        ),
      )
    }

    // ------------------------------------------------------------------ overview

    function Metrics({ stats }) {
      const rows = [
        ['事实', stats?.facts ?? 0],
        ['片段', stats?.episodes ?? 0],
        ['日记', stats?.diary ?? 0],
        ['覆盖天数', stats?.days ?? 0],
      ]
      return h(
        'div',
        { className: 'dm-stats', style: { marginBottom: 0 } },
        rows.map(([label, value]) =>
          h(
            'div',
            { key: label, className: 'dm-stat' },
            h('div', { className: 'dm-stat-label' }, label),
            h('div', { className: 'dm-stat-value' }, String(value)),
          ),
        ),
      )
    }

    /**
     * The contribution wall, laid out like a year of a code-hosting profile.
     *
     * One column per week, Monday at the top like the calendar beside it, one
     * cell per day. The tint is a bucket rather than a raw number: the busiest
     * quarter of days is full strength, the quietest tinted once, and a day with
     * nothing stays the surface colour. That is what makes a year readable at a
     * glance — the absolute count only appears in the tooltip.
     *
     * The bucket edges come from the non-empty days themselves (the 25th, 50th
     * and 75th percentile), so a month of ten-a-day days and a month of
     * one-a-day days both show contrast instead of one flat tint.
     */
    const WALL_DOW = ['一', '二', '三', '四', '五', '六', '日']

    /** Bucket edges for one set of counts: three ascending thresholds. */
    function wallThresholds(values) {
      const filled = values.filter((value) => value > 0).sort((left, right) => left - right)
      if (filled.length === 0) return [1, 2, 3]
      const at = (fraction) => filled[Math.min(filled.length - 1, Math.floor(filled.length * fraction))]
      return [at(0.25), at(0.5), at(0.75)]
    }

    function ActivityWall({ days, onJump }) {
      const rows = Array.isArray(days) ? days : []
      const counts = {}
      for (const row of rows) counts[row.day] = (Number(row.episodes) || 0) + (Number(row.facts) || 0)
      const values = rows.map((row) => counts[row.day])
      const [low, mid, high] = wallThresholds(values)
      const level = (value) => (value <= 0 ? 0 : value <= low ? 1 : value <= mid ? 2 : value <= high ? 3 : 4)
      const today = todayKey()
      const total = values.reduce((sum, value) => sum + value, 0)
      // Hover is tracked here rather than left to the native `title`: a native
      // tooltip waits ~1s before appearing and then shows one line of plain
      // text, which is too little for a cell that stands for a whole day.
      const [tip, setTip] = useState(null)
      const wrapRef = React.useRef(null)

      // Pad to whole weeks so every column is seven cells tall: the leading and
      // trailing blanks are real grid cells with `data-out`, not gaps.
      const padded = []
      if (rows.length > 0) {
        const first = parseDay(rows[0].day)
        const lead = (first.getDay() + 6) % 7
        for (let step = 0; step < lead; step += 1) padded.push(null)
        for (const row of rows) padded.push(row)
        while (padded.length % 7 !== 0) padded.push(null)
      }
      const weeks = []
      for (let index = 0; index < padded.length; index += 7) weeks.push(padded.slice(index, index + 7))

      const hover = (cell, event) => {
        const wrap = wrapRef.current
        if (wrap === null) return
        const box = wrap.getBoundingClientRect()
        const own = event.currentTarget.getBoundingClientRect()
        setTip({
          day: cell.day,
          episodes: Number(cell.episodes) || 0,
          facts: Number(cell.facts) || 0,
          diary: Number(cell.diary) || 0,
          missing: cell.missing === true,
          left: own.left - box.left + own.width / 2,
          top: own.top - box.top,
        })
      }

      const tipNode =
        tip === null
          ? null
          : h(
              'div',
              { className: 'dm-wall-tip', style: { left: tip.left + 'px', top: tip.top + 'px' } },
              h('div', { className: 'dm-wall-tip-day' }, tip.day),
              h(
                'div',
                { className: 'dm-wall-tip-row' },
                h('span', null, '片段'),
                h('b', null, String(tip.episodes)),
              ),
              h('div', { className: 'dm-wall-tip-row' }, h('span', null, '事实'), h('b', null, String(tip.facts))),
              h('div', { className: 'dm-wall-tip-row' }, h('span', null, '日记'), h('b', null, String(tip.diary))),
              tip.missing ? h('div', { className: 'dm-wall-tip-hint' }, '这一天有素材但没有日记') : null,
            )

      return h(
        'div',
        { className: 'dm-panel' },
        h(
          'div',
          { className: 'dm-panel-head' },
          h('span', { className: 'dm-panel-title' }, '活跃度'),
          h('span', { className: 'dm-panel-sub' }, `近一年 · 片段 + 事实`),
          h('span', { className: 'dm-spacer' }),
          h('span', { className: 'dm-panel-sub' }, `${total} 条`),
        ),
        rows.length === 0
          ? h(Empty, null, '还没有记录。')
          : h(
              'div',
              { className: 'dm-wall-wrap', ref: wrapRef },
              tipNode,
              h(
                'div',
                { className: 'dm-wall', onMouseLeave: () => setTip(null) },
                h(
                  'div',
                  { className: 'dm-wall-dow' },
                  WALL_DOW.map((name) => h('span', { key: name }, name)),
                ),
                h(
                  'div',
                  { className: 'dm-wall-weeks' },
                  weeks.map((week, weekIndex) =>
                    h(
                      'div',
                      { key: `w${weekIndex}`, className: 'dm-wall-week' },
                      week.map((cell, dayIndex) => {
                        if (cell === null) {
                          return h('div', {
                            key: `e${weekIndex}-${dayIndex}`,
                            className: 'dm-wall-cell',
                            'data-out': 'true',
                          })
                        }
                        const value = counts[cell.day] ?? 0
                        return h('div', {
                          key: cell.day,
                          className: 'dm-wall-cell',
                          'data-level': String(level(value)),
                          'data-today': cell.day === today ? 'true' : 'false',
                          'data-gap': cell.missing === true ? 'true' : 'false',
                          'aria-label': `${cell.day}：${value} 条`,
                          onMouseEnter: (event) => hover(cell, event),
                          onClick: () => onJump?.(cell.day, 'episodes'),
                        })
                      }),
                    ),
                  ),
                ),
              ),
            ),
        h(
          'div',
          { className: 'dm-wall-foot' },
          h('span', null, '越活跃颜色越深'),
          h('span', { className: 'dm-spacer' }),
          h(
            'span',
            { className: 'dm-wall-legend' },
            h('span', null, '少'),
            [0, 1, 2, 3, 4].map((step) =>
              h('span', { key: `l${step}`, className: 'dm-wall-cell', 'data-level': String(step) }),
            ),
            h('span', null, '多'),
          ),
        ),
      )
    }

    /**
     * One line for a scheduled delivery that slipped past its own day.
     *
     * The Host replays only the latest missed occurrence after downtime, so the
     * day that occurrence was supposed to write never got a page. The user asked
     * to be *told*, not to have it quietly written: the strip carries 补写 for
     * that day and disappears once the day has a page, so nothing has to be
     * dismissed by hand and nothing is written behind their back.
     */
    function MissedNotice({ onDone }) {
      const [items, setItems] = useState([])
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')

      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const body = await apiGet('/missed')
            if (alive) setItems(Array.isArray(body?.items) ? body.items : [])
          } catch {
            // The panel is perfectly usable without the reminder.
          }
        })()
        return () => {
          alive = false
        }
      }, [])

      if (items.length === 0) return null

      const fill = async (day) => {
        setBusy(true)
        setNote('')
        try {
          await apiPost('/backfill', { day, mode: 'fill' })
          setNote(`已排一个只写 ${day} 的一次性任务。`)
          setItems((current) => current.filter((item) => item.day !== day))
          onDone?.()
        } catch (cause) {
          setNote(`补写没排上：${String(cause?.message ?? cause)}`)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'dm-notice' },
        h(
          'div',
          { className: 'dm-notice-text' },
          items.length === 1
            ? `定时任务错过了 ${items[0].day} 这一天：日记还没写。`
            : `定时任务错过了 ${items.length} 天（${items.map((item) => item.day).join('、')}）：日记都还没写。`,
        ),
        h(
          'div',
          { className: 'dm-notice-actions' },
          items.map((item) =>
            h(
              Button,
              { key: item.day, kind: 'primary', disabled: busy, onClick: () => void fill(item.day) },
              `补写 ${item.day}`,
            ),
          ),
        ),
        note === '' ? null : h('div', { className: 'dm-notice-note' }, note),
      )
    }

    function Overview({ stats, activity, latest, facts, episodes, onReload, onJump }) {
      const [note, setNote] = useState('')
      const preview = latest ?? null
      const recentPages = Array.isArray(latest) ? latest : preview === null ? [] : [preview]
      return h(
        'div',
        { className: 'dm-stack' },
        h(MissedNotice, { onDone: onReload }),
        h(Metrics, { stats }),
        h(ActivityWall, { days: activity, onJump }),
        h(
          'div',
          { className: 'dm-grid-ov' },
          h(
            'div',
            { className: 'dm-sec' },
            // Four recent pages instead of one, drawn with the same row as the
            // fragments beside it: the diary gets its own grammar only in the
            // memory page, where a day's pages really are a list of documents.
            h(
              'div',
              { className: 'dm-panel dm-fill' },
              h(
                'div',
                { className: 'dm-panel-head' },
                h('span', { className: 'dm-panel-title' }, '最近日记'),
                h('span', { className: 'dm-panel-sub' }, preview === null ? '还没有' : preview.day),
              ),
              recentPages.length === 0
                ? h(Empty, null, '还没有日记。到「记忆」页选一天补写。')
                : recentPages.map((page) =>
                    h(MemoryRow, {
                      key: page.id,
                      kind: 'diary',
                      item: page,
                      onClick: () => onJump?.(page.day, 'diary'),
                      extra: page.day,
                    }),
                  ),
            ),
          ),
          h(
            'div',
            { className: 'dm-sec' },
            h(
              'div',
              { className: 'dm-panel' },
              h(
                'div',
                { className: 'dm-panel-head' },
                h('span', { className: 'dm-panel-title' }, '最近 3 条事实'),
              ),
              (facts ?? []).length === 0
                ? h(Empty, null, '还没有事实。')
                : (facts ?? []).slice(0, 3).map((item) =>
                    h(MemoryRow, {
                      key: item.id,
                      kind: 'fact',
                      item,
                      onClick: () => onJump?.(dayFromDate(new Date(Number(item.createdAt))), 'facts'),
                    }),
                  ),
            ),
            h(
              'div',
              { className: 'dm-panel' },
              h(
                'div',
                { className: 'dm-panel-head' },
                h('span', { className: 'dm-panel-title' }, '最近 5 条片段'),
              ),
              (episodes ?? []).length === 0
                ? h(Empty, null, '还没有片段。')
                : (episodes ?? []).slice(0, 5).map((item) =>
                    h(MemoryRow, {
                      key: item.id,
                      kind: 'episode',
                      item,
                      onClick: () => onJump?.(dayFromDate(new Date(Number(item.createdAt))), 'episodes'),
                    }),
                  ),
            ),
          ),
        ),
        h(
          Toolbar,
          null,
          h(Button, { onClick: onReload }, '刷新'),
          h(
            Button,
            {
              onClick: async () => {
                setNote('重建中…')
                try {
                  const body = await apiPost('/rebuild', {})
                  setNote(
                    `已重建：事实 ${body?.facts ?? 0} 条、片段 ${body?.episodes ?? 0} 条、日记 ${body?.diary ?? 0} 篇。`,
                  )
                } catch (cause) {
                  setNote(`重建失败：${String(cause?.message ?? cause)}`)
                }
                onReload()
              },
            },
            '重建检索索引',
          ),
          note === '' ? null : h('span', { className: 'dm-hint', style: { marginBottom: 0 } }, note),
        ),
      )
    }

    // -------------------------------------------------------------------- search

    const RANGES = [
      { id: 'all', label: '全部' },
      { id: '7', label: '近 7 天' },
      { id: '30', label: '近 30 天' },
      { id: '90', label: '近 90 天' },
    ]

    const rangeBounds = (id) => {
      if (id === 'all') return {}
      const days = Number(id)
      const to = todayKey()
      const start = new Date()
      start.setDate(start.getDate() - (days - 1))
      return { from: dayFromDate(start), to }
    }

    function SearchPage({ query, hits, searching, onQuery, onSearch, onReload, onJump }) {
      const [range, setRange] = useState('all')
      const [kinds, setKinds] = useState({ fact: true, episode: true, diary: true })
      const [busy, setBusy] = useState(false)
      const list = Array.isArray(hits) ? hits : []
      const selectedKinds = Object.keys(kinds).filter((kind) => kinds[kind] === true)

      const run = (text) => {
        onSearch(text ?? query, { kinds: selectedKinds, ...rangeBounds(range) })
      }

      const remove = async (hit) => {
        if (!window.confirm('删掉这条记录？删了就找不回来。')) return
        setBusy(true)
        try {
          if (hit.kind === 'diary') await apiPost('/forget', { kind: 'diary', id: hit.id })
          else await apiPost('/forget', { kind: hit.kind, id: hit.id })
          onReload()
          run()
        } finally {
          setBusy(false)
        }
      }

      const groups = ['fact', 'episode', 'diary']
        .map((kind) => [kind, list.filter((hit) => hit.kind === kind)])
        .filter(([, items]) => items.length > 0)

      return h(
        'div',
        { className: 'dm-stack' },
        h(
          'div',
          { className: 'dm-panel' },
          h(
            'div',
            { className: 'dm-search', style: { maxWidth: 'none' } },
            h('input', {
              className: 'dm-input',
              value: query,
              placeholder: '搜索事实、片段、日记（回车）',
              onChange: (event) => onQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                run(event.currentTarget.value)
              },
              style: { flex: 1 },
            }),
            h(Button, { kind: 'primary', disabled: searching, onClick: () => run() }, searching ? '搜索中' : '搜索'),
          ),
        ),
        h(
          'div',
          { className: 'dm-panel' },
          h(
            'div',
            { className: 'dm-filter-row' },
            h('span', { className: 'dm-filter-label' }, '时间范围'),
            RANGES.map((item) =>
              h(
                Button,
                { key: item.id, kind: range === item.id ? 'primary' : 'ghost', onClick: () => setRange(item.id) },
                item.label,
              ),
            ),
          ),
          h(
            'div',
            { className: 'dm-filter-row', style: { marginBottom: 0 } },
            h('span', { className: 'dm-filter-label' }, '类别'),
            ['fact', 'episode', 'diary'].map((kind) =>
              h(
                Button,
                {
                  key: kind,
                  kind: kinds[kind] ? 'primary' : 'ghost',
                  onClick: () => {
                    const next = { ...kinds, [kind]: !kinds[kind] }
                    // One category left is the floor: a search with no kind to
                    // look in can only return nothing, which reads as a bug.
                    if (!Object.values(next).some(Boolean)) return
                    setKinds(next)
                  },
                },
                KIND_LABEL[kind],
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dm-panel' },
          h(
            'div',
            { className: 'dm-panel-head' },
            h(
              'span',
              { className: 'dm-panel-title' },
              query.trim() === '' ? '搜索结果' : `「${query.trim()}」的搜索结果 ${list.length} 条`,
            ),
            h('span', { className: 'dm-spacer' }),
            h(Button, { onClick: () => run() }, '重新搜索'),
          ),
          list.length === 0
            ? h(Empty, null, query.trim() === '' ? '在上面输入关键词，回车。' : '没有命中。换几个词，或者放宽时间范围与类别。')
            : groups.map(([kind, items]) =>
                h(
                  'div',
                  { key: kind },
                  h('div', { className: 'dm-group-title' }, `${KIND_LABEL[kind]}（${items.length}）`),
                  items.map((hit) =>
                    h(
                      'div',
                      { key: `${hit.kind}:${hit.id}`, className: 'dm-hit' },
                      h('span', { className: 'dm-hit-kind' }, KIND_LABEL[hit.kind] ?? hit.kind),
                      h(
                        'div',
                        { className: 'dm-hit-body' },
                        h(
                          'div',
                          {
                            style: { cursor: 'pointer' },
                            onClick: () => onJump?.(hit.day, hit.kind === 'diary' ? 'diary' : hit.kind === 'fact' ? 'facts' : 'episodes'),
                          },
                          highlight(hit.text, query),
                        ),
                        h(
                          'div',
                          { className: 'dm-meta', style: { marginTop: 2 } },
                          h('span', null, hit.day ?? fmtTime(hit.createdAt)),
                          hit.sessionId === undefined ? null : h('span', { className: 'dm-sid' }, hit.sessionId),
                        ),
                      ),
                      h(Button, { disabled: busy, onClick: () => remove(hit) }, '删除'),
                    ),
                  ),
                ),
              ),
        ),
      )
    }

    const FLAG_COLUMNS = [
      { key: 'recall', label: '读', title: '读取记忆' },
      { key: 'write', label: '写', title: '写入记忆' },
      { key: 'diary', label: '日', title: '计入日记' },
      { key: 'forget', label: '删', title: '允许删除记忆' },
    ]

    /**
     * A preset's switches as the user should see them: resolved, not as a diff.
     *
     * The file only stores what differs from the layer below (that is what makes
     * "inherit" the natural state), so the checkboxes have to be rendered from
     * the merge — a diff-based row would show everything off.
     */
    function effectivePresetFlags(snapshot, id, kind) {
      const defaults = snapshot?.defaults ?? {}
      const entry = snapshot?.presets?.[id] ?? {}
      const own = kind === 'subagent' ? entry.subagent : entry.flags
      const base = kind === 'subagent' ? { ...defaults, ...(entry.flags ?? {}) } : defaults
      return { ...base, ...(own ?? {}) }
    }

    /**
     * A model choice is two ids travelling together, so the `<select>` carries
     * them as one string and these three functions are the only code that knows
     * the encoding. Tab cannot appear in a provider id or a model id, which is
     * why it is the separator.
     */
    const MODEL_PICK_SEP = '\t'

    function modelPick(provider, model) {
      return provider === '' || model === '' ? '' : `${provider}${MODEL_PICK_SEP}${model}`
    }

    function splitModelPick(value) {
      const at = String(value ?? '').indexOf(MODEL_PICK_SEP)
      if (at < 0) return { provider: String(value ?? ''), model: '' }
      return { provider: value.slice(0, at), model: value.slice(at + 1) }
    }

    /**
     * The dropdown body: "follow the global default" first, then one
     * `<optgroup>` per provider.
     *
     * A saved pair that the host no longer advertises keeps its own option.
     * Without it the `<select>` would silently snap to the first entry and the
     * next save would quietly change the model the diary runs on.
     */
    function modelOptions(catalog, provider, model) {
      const groups = Array.isArray(catalog?.providers) ? catalog.providers : []
      const fallback = catalog?.default ?? null
      const current = modelPick(provider, model)
      const known =
        provider !== '' &&
        groups.some(
          (group) => group?.id === provider && (Array.isArray(group?.models) ? group.models : []).some((row) => row?.id === model),
        )
      const options = [
        h(
          'option',
          { key: '__follow', value: '' },
          fallback === null ? '跟随全局默认模型' : `跟随全局默认（${fallback.provider} / ${fallback.model}）`,
        ),
      ]
      if (current !== '' && !known) {
        options.push(h('option', { key: '__stale', value: current }, `（列表里没有）${provider} / ${model}`))
      }
      for (const group of groups) {
        const id = String(group?.id ?? '')
        if (id === '') continue
        const models = Array.isArray(group.models) ? group.models : []
        options.push(
          h(
            'optgroup',
            { key: `p:${id}`, label: String(group.name ?? '') === '' ? id : String(group.name) },
            models.map((row) =>
              h(
                'option',
                { key: `m:${id}:${String(row?.id ?? '')}`, value: `${id}${MODEL_PICK_SEP}${String(row?.id ?? '')}` },
                String(row?.name ?? '') === '' ? String(row?.id ?? '') : String(row.name),
              ),
            ),
          ),
        )
      }
      return options
    }

    /**
     * The four switches as one trigger and one menu — the only place they are
     * drawn, so a session row, a preset row and the composer cannot drift.
     *
     * Opening is a portal to `document.body` on purpose: both hosts clip their
     * overflow (the composer strip is inside a scrolling column, the session list
     * scrolls), and the host's own menus portal for the same reason. The card
     * then sits at the trigger's rect, above it when the composer is at the
     * bottom of the window and below it when there is room.
     */
    const MENU_WIDTH = 196
    const MENU_GAP = 6

    function FlagsMenu({
      label,
      flags,
      busy,
      error,
      onFlip,
      onReset,
      resetTitle,
      title,
      glyph,
      count,
    }) {
      const [open, setOpen] = useState(false)
      const [pos, setPos] = useState(null)
      const buttonRef = useRef(null)
      const menuRef = useRef(null)

      const place = useCallback(
        (measured) => {
          const button = buttonRef.current
          if (button === null) return
          const rect = button.getBoundingClientRect()
          const height = measured ?? menuRef.current?.getBoundingClientRect().height ?? 0
          const width = Math.min(MENU_WIDTH, Math.max(160, window.innerWidth - 16))
          const left = Math.min(
            Math.max(8, rect.right - width),
            Math.max(8, window.innerWidth - width - 8),
          )
          const below = window.innerHeight - rect.bottom
          const above = rect.top
          // Prefer opening away from the edge the trigger sits nearest.
          const down = below >= height + MENU_GAP || below >= above
          const top = down ? rect.bottom + MENU_GAP : rect.top - height - MENU_GAP
          setPos({
            left,
            top: Math.max(8, Math.min(top, Math.max(8, window.innerHeight - height - 8))),
            width,
            height,
          })
        },
        [],
      )

      useEffect(() => {
        if (!open) return undefined
        place()
        const onDown = (event) => {
          const target = event.target
          if (buttonRef.current?.contains(target) === true) return
          if (menuRef.current?.contains(target) === true) return
          setOpen(false)
        }
        const onMove = () => place()
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        window.addEventListener('resize', onMove)
        window.addEventListener('scroll', onMove, true)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', onMove)
          window.removeEventListener('scroll', onMove, true)
        }
      }, [open, place])

      // The first placement runs before the card exists, so it guesses a height
      // of zero and settles for "below". One measured pass fixes that — and only
      // when the real height disagrees, so this cannot loop.
      useEffect(() => {
        if (!open || pos === null) return
        const height = menuRef.current?.getBoundingClientRect().height ?? 0
        if (height === 0 || Math.abs(height - pos.height) < 1) return
        place(height)
      }, [open, pos, place])

      const onCount = FLAG_COLUMNS.filter((column) => flags?.[column.key] === true).length

      const menu =
        !open || pos === null
          ? null
          : ReactDOM.createPortal(
              h(
                'div',
                {
                  className: 'dm-menu',
                  ref: menuRef,
                  role: 'menu',
                  style: { left: pos.left + 'px', top: pos.top + 'px', width: pos.width + 'px' },
                },
                label === undefined ? null : h('div', { className: 'dm-menu-label' }, label),
                FLAG_COLUMNS.map((column) =>
                  h(
                    'button',
                    {
                      key: column.key,
                      type: 'button',
                      role: 'menuitemcheckbox',
                      className: 'dm-menu-row',
                      'aria-checked': flags?.[column.key] === true ? 'true' : 'false',
                      'data-on': flags?.[column.key] === true ? 'true' : 'false',
                      'data-busy': busy === true ? 'true' : 'false',
                      onClick: () => onFlip(column.key),
                    },
                    h('span', { className: 'dm-menu-glyph' }, column.label),
                    h('span', { className: 'dm-menu-text' }, column.title),
                    h(
                      'span',
                      { className: 'dm-menu-state' },
                      flags?.[column.key] === true ? '开' : '关',
                    ),
                  ),
                ),
                onReset === undefined
                  ? null
                  : h('div', { className: 'dm-menu-sep', role: 'separator' }),
                onReset === undefined
                  ? null
                  : h(
                      'button',
                      {
                        type: 'button',
                        role: 'menuitem',
                        className: 'dm-menu-row',
                        onClick: () => {
                          setOpen(false)
                          onReset()
                        },
                      },
                      h('span', { className: 'dm-menu-glyph' }, '↺'),
                      h('span', { className: 'dm-menu-text' }, resetTitle ?? '恢复继承'),
                      h('span', { className: 'dm-menu-state' }, ''),
                    ),
                error === undefined || error === '' ? null : h('div', { className: 'dm-menu-error' }, error),
              ),
              document.body,
            )

      return h(
        'span',
        { className: 'dm-flags' },
        h(
          'button',
          {
            type: 'button',
            className: 'dm-flags-btn',
            ref: buttonRef,
            'aria-haspopup': 'menu',
            'aria-expanded': open ? 'true' : 'false',
            title: title,
            onClick: () => setOpen(!open),
          },
          h('span', { className: 'dm-flags-glyph' }, glyph ?? '记'),
          h('span', { className: 'dm-flags-count' }, count ?? `${onCount}/${FLAG_COLUMNS.length}`),
        ),
        menu,
      )
    }

    /**
     * The switch menu for one conversation, as a `conversation.input.right` cell.
     *
     * It lives at the composer's right edge, beside the model and mode pickers,
     * because that is where the decision is made: this conversation, before the
     * next message. The same switches exist per preset in the panel; a session
     * reads its preset once, at creation, and owns these from then on.
     */
    function ComposerFlags({ sessionId }) {
      const [flags, setFlags] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const id = sessionId === undefined ? undefined : String(sessionId)

      const load = useCallback(async () => {
        if (id === undefined) return
        try {
          const body = await apiGet('/session-flags', { sessionId: id })
          setFlags(body.effective)
          setError('')
        } catch (cause) {
          setFlags(null)
          setError(String(cause?.message ?? cause))
        }
      }, [id])

      useEffect(() => {
        load()
        flagWatchers.add(load)
        return () => {
          flagWatchers.delete(load)
        }
      }, [load])

      if (id === undefined || flags === null) return null

      const flip = async (key) => {
        if (busy) return
        setBusy(true)
        try {
          const body = await apiPost('/session-flags', {
            sessionId: id,
            flags: { [key]: flags[key] !== true },
          })
          setFlags(body.effective)
          announceFlags()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      return h(FlagsMenu, {
        label: '本会话记忆',
        title: '这个会话的记忆开关',
        flags,
        busy,
        error,
        onFlip: flip,
      })
    }

    /**
     * Per-session control, as a list per scope.
     *
     * A row is one conversation, and the four switches are its memory policy:
     * read, write, count toward the diary, and allow deletion. There is no
     * preset layer any more — a session reads the global defaults once, when
     * it is created, and owns its values from then on, so editing the defaults
     * never reaches back into a conversation the user already has.
     *
     * The subagent list is the second layer: a child agent follows its parent
     * conversation unless the parent pinned something else for its children,
     * which is what lets one conversation keep a quiet delegating style while
     * another lets children write memories.
     */
    function SessionsView({ snapshot, sessions, onReload, onOpenSession }) {
      const rows = Array.isArray(sessions) ? sessions : []
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [query, setQuery] = useState('')
      /**
       * Switches written in this view, keyed by "scope:sessionId".
       *
       * The rows come from one read of /sessions. Re-reading them after every
       * toggle is what made the panel flash, but the checkboxes render from
       * that same data, so a written value has to be remembered here or the box
       * snaps back to the stale one.
       */
      const [drafts, setDrafts] = useState({})
      const draftOf = (scope, row) => {
        const written = drafts[scope + ':' + row.sessionId]
        const base = scope === 'subagent' ? row.subagent ?? row.effective : row.effective
        return written === undefined ? base : { ...base, ...written }
      }

      const save = useCallback(async (scope, id, flags) => {
        // Optimistic in place: re-reading every list on each toggle is what
        // made the panel flash. Only a failure needs the host to speak up.
        setBusy(true)
        setError('')
        try {
          await apiPost('/settings', { scope, id, flags })
          setDrafts((current) => ({ ...current, [scope + ':' + id]: { ...(current[scope + ':' + id] ?? {}), ...flags } }))
          announceFlags()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
          onReload()
        } finally {
          setBusy(false)
        }
      }, [onReload])

      const shown = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (needle === '') return rows
        return rows.filter((row) =>
          [row.title, row.firstLine ?? '', row.sessionId, row.presetId ?? ''].join(' ').toLowerCase().includes(needle),
        )
      }, [rows, query])

      const restore = async (id, subagent) => {
        const scope = subagent === true ? 'subagent' : 'session'
        setBusy(true)
        try {
          await apiPost('/settings', { scope: 'clear-session', id, subagent: subagent === true })
          setDrafts((current) => {
            const next = { ...current }
            delete next[scope + ':' + id]
            return next
          })
          announceFlags()
          onReload()
        } finally {
          setBusy(false)
        }
      }

      /**
       * One session, drawn like every other list in the panel.
       *
       * This used to be two tables with four checkbox columns and three inline
       * links per row, which read as a different product in the same window.
       * The row now opens that session's memory on click - the same gesture the
       * overview uses on a fragment - and the switches live in one small chip
       * per row instead of a matrix.
       */
      const rowNode = (row, subagent) => {
        const scope = subagent === true ? 'subagent' : 'session'
        const openId = scope + ':' + row.sessionId
        const own = subagent === true ? row.subagentOwn : row.own
        const drafted = drafts[scope + ':' + row.sessionId] !== undefined
        const overridden = drafted || (own !== null && own !== undefined)
        const flags = draftOf(scope, row)
        const onCount = FLAG_COLUMNS.filter((column) => flags[column.key] === true).length
        return h(
          'div',
          { key: (subagent ? 'sub:' : '') + row.sessionId, className: 'dm-sess-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'dm-sess-main dm-row-hit',
              title: '打开这个会话的记忆',
              onClick: () => onOpenSession?.(row.sessionId),
            },
            h('div', { className: 'dm-sess-title' }, row.title === '' ? row.sessionId : row.title),
            h(
              'div',
              { className: 'dm-meta', style: { marginTop: 2 } },
              h('span', { className: 'dm-sid' }, row.sessionId),
              subagent ? null : row.presetId === null ? null : h('span', null, row.presetId),
              subagent && !overridden ? h('span', null, '跟随本会话') : null,
              overridden ? h('span', { className: 'dm-preset-id' }, '已覆盖') : null,
            ),
            row.firstLine === '' || row.firstLine === undefined
              ? null
              : h('div', { className: 'dm-sess-first dm-clamp-2' }, row.firstLine),
          ),
          h(
            'div',
            { className: 'dm-sess-side' },
            // The four switches live behind one trigger: the menu is the same
            // component the composer and the preset rows use, so the list stays
            // a list and still owns the policy.
            h(FlagsMenu, {
              label: '记忆开关',
              title: FLAG_COLUMNS.map((column) => `${column.title}：${flags[column.key] === true ? '开' : '关'}`).join('；'),
              flags,
              busy,
              onFlip: (key) => {
                void save(scope, row.sessionId, { [key]: flags[key] !== true })
              },
              onReset: !drafted && (own === null || own === undefined) ? undefined : () => {
                void restore(row.sessionId, subagent)
              },
              resetTitle: '恢复继承',
            }),
          ),
        )
      }

      return h(
        'div',
        { className: 'dm-stack' },
        h(ErrorBar, { error: error === '' ? null : error }),
        h(
          'div',
          { className: 'dm-panel' },
          h(
            'div',
            { className: 'dm-panel-head' },
            h('span', { className: 'dm-panel-title' }, '会话'),
            h('span', { className: 'dm-panel-sub' }, `${rows.length} 个`),
            h('span', { className: 'dm-spacer' }),
            h(Button, { onClick: onReload, disabled: busy }, '刷新'),
          ),
          h(
            'div',
            { className: 'dm-filter-row' },
            h('input', {
              className: 'dm-input',
              value: query,
              placeholder: '按标题、首句、id 或 preset 过滤…',
              onChange: (event) => setQuery(event.target.value),
              style: { flex: 1, minWidth: 180 },
            }),
          ),
          shown.length === 0
            ? h(Empty, null, rows.length === 0 ? '没有读到已存储的会话。' : '没有匹配的会话。')
            : shown.map((row) => rowNode(row, false)),
        ),
        h(
          'div',
          { className: 'dm-panel' },
          h(
            'div',
            { className: 'dm-panel-head' },
            h('span', { className: 'dm-panel-title' }, '子代理默认值'),
          ),
          h(
            'div',
            { className: 'dm-hint' },
            '子代理默认跟随发起它的会话；点开一个会话就能单独给它定一套。子代理说的话记在父会话名下，关掉「写」只影响它能不能新增片段，不会另起一条记忆线。',
          ),
          shown.length === 0
            ? h(Empty, null, '没有可设置的会话。')
            : shown.map((row) => rowNode(row, true)),
        ),
      )
    }
    function Settings({ snapshot, onReload }) {
      const [busy, setBusy] = useState(false)
      const [dependency, setDependency] = useState(null)
      const [installing, setInstalling] = useState(false)
      const [progress, setProgress] = useState(null)
      const [diaryTask, setDiaryTask] = useState(null)
      const [diaryTime, setDiaryTime] = useState('23:40')
      const [modelPath, setModelPath] = useState(snapshot?.semantic?.modelPath ?? '')
      const [remoteHost, setRemoteHost] = useState(snapshot?.semantic?.remoteHost ?? '')
      const [models, setModels] = useState(null)
      const [modelBusy, setModelBusy] = useState('')
      const [modelError, setModelError] = useState('')
      const [taskError, setTaskError] = useState('')
      const [taskBusy, setTaskBusy] = useState(false)
      const [taskNote, setTaskNote] = useState('')
      /**
       * The diary persona and model as this view last wrote them.
       *
       * Same reason as the flag drafts elsewhere: the field renders from the
       * snapshot, so a written value has to be kept until the next load lands,
       * or every keystroke would be undone by a reload.
       */
      const [diaryPersona, setDiaryPersona] = useState(snapshot?.diary?.persona ?? '')
      const [diaryProvider, setDiaryProvider] = useState(snapshot?.diary?.provider ?? '')
      const [diaryModel, setDiaryModel] = useState(snapshot?.diary?.model ?? '')
      /**
       * The model routes the host can actually reach, for the dropdown.
       *
       * `null` means "not loaded yet" and is distinct from "loaded, nothing
       * there": the first shows a plain text field so the panel still works when
       * the catalog route is missing, the second says so.
       */
      const [catalog, setCatalog] = useState(null)
      const [catalogError, setCatalogError] = useState('')
      const [personaNote, setPersonaNote] = useState('')
      const presetRows = Array.isArray(snapshot?.roster) ? snapshot.roster : []

      const saveSemantic = useCallback(async (patch) => {
        await apiPost('/settings', { scope: 'semantic', semantic: patch })
      }, [])

      // npm reports no bytes, so the host measures the vendor directory while it
      // runs; polling that is what turns "安装中…" into a moving number.
      useEffect(() => {
        if (!installing) return undefined
        let alive = true
        const tick = async () => {
          try {
            const body = await apiGet('/dependency')
            if (alive) setProgress(body.progress ?? null)
          } catch {
            // A single failed poll is not worth interrupting the install.
          }
        }
        tick()
        const timer = setInterval(tick, 900)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [installing])

      /**
       * Load the model catalog.
       *
       * Failure is reported, not fatal: the persona card falls back to typing
       * provider and model by hand, which is what it did before the dropdown.
       */
      const loadCatalog = useCallback(async () => {
        try {
          const body = await apiGet('/model-catalog')
          setCatalog({ providers: Array.isArray(body?.providers) ? body.providers : [], default: body?.default ?? null })
          setCatalogError('')
        } catch (cause) {
          setCatalog(null)
          setCatalogError(String(cause?.message ?? cause))
        }
      }, [])

      useEffect(() => {
        apiGet('/dependency')
          .then(setDependency)
          .catch(() => setDependency({ installed: false }))
        apiGet('/diary-task')
          .then((body) => {
            setDiaryTask(body)
            if (typeof body?.time === 'string') setDiaryTime(body.time)
          })
          .catch(() => setDiaryTask({ scheduled: false }))
        apiGet('/models')
          .then(setModels)
          .catch(() => setModels({ items: [], directory: '' }))
        void loadCatalog()
      }, [loadCatalog])

      const runModel = async (action, id) => {
        setModelBusy(`${action}:${id}`)
        setModelError('')
        try {
          if (action === 'reveal') {
            const body = await apiPost('/models', { action: 'reveal' })
            setModels((current) => (current === null ? current : { ...current, directory: body.directory ?? current.directory }))
            if (body.opened === false) setModelError(`打不开文件管理器，目录是：${body.directory ?? ''}`)
            return
          }
          const body = await apiPost('/models', { action, model: id })
          // Installing answers 202: the transfer runs in the host, and the
          // panel polls until it finishes so closing the page cannot cancel it.
          if (body?.started === true) {
            setModels((current) => (current === null ? current : { ...current, jobs: { ...(current.jobs ?? {}), [id]: body.job } }))
            pollModels()
            return
          }
          setModels(body)
          if (action === 'use') onReload?.()
        } catch (cause) {
          setModelError(String(cause?.message ?? cause))
        } finally {
          setModelBusy('')
        }
      }

      const pollModels = useCallback(() => {
        let alive = true
        const tick = async () => {
          if (!alive) return
          try {
            const body = await apiGet('/models')
            if (!alive) return
            setModels(body)
            const busy = Object.values(body?.jobs ?? {}).some((job) => job?.phase === 'downloading')
            if (busy) setTimeout(tick, 1000)
            else onReload?.()
          } catch {
            if (alive) setTimeout(tick, 3000)
          }
        }
        tick()
        return () => {
          alive = false
        }
      }, [onReload])

      const savePreset = useCallback(
        async (id, kind, flags) => {
          setBusy(true)
          try {
            await apiPost('/settings', {
              scope: kind === 'subagent' ? 'preset-subagent' : 'preset',
              id,
              flags,
            })
            onReload?.()
          } finally {
            setBusy(false)
          }
        },
        [onReload],
      )

      const saveDiaryPersona = async () => {
        setBusy(true)
        setPersonaNote('')
        try {
          const body = await apiPost('/settings', {
            scope: 'diary',
            diary: { persona: diaryPersona, provider: diaryProvider, model: diaryModel },
          })
          const preset = body?.diaryPreset ?? {}
          setPersonaNote(
            preset.mounted === false
              ? '已保存，但预设这次没能挂上，日记会退回默认预设。'
              : preset.stale === true
                ? '已保存。日记预设沿用上一次的注册，重启 DSH 后才会换成新的人设。'
                : '已保存。下一次投递就按新的人格写。',
          )
          onReload?.()
        } catch (cause) {
          setPersonaNote(`保存失败：${String(cause?.message ?? cause)}`)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        null,
        h(ErrorBar, { error: taskBusy ? '保存中…' : null }),
        h(
          Card,
          { title: '每个预设的默认权限' },
          h(
            'div',
            { className: 'dm-hint' },
            '一个预设一套默认值：该预设下新开的会话读一次就归自己所有，之后各自独立；子代理先跟父会话，父会话没有覆盖时才看这里的「子代理」一行。',
          ),
          presetRows.length === 0
            ? h(Empty, null, '还没有读到预设列表。')
            : h(
                'div',
                { className: 'dm-preset-grid' },
                presetRows.map((row) =>
                h(
                  'div',
                  { key: row.id, className: 'dm-preset-card' },
                  h(
                    'div',
                    { className: 'dm-preset-head' },
                    h('span', { className: 'dm-preset-name' }, row.name === '' ? row.id : row.name),
                    row.id === snapshot?.diaryPreset?.id
                      ? h('span', { className: 'dm-badge' }, '写日记专用')
                      : null,
                    h('span', { className: 'dm-preset-id' }, row.id),
                  ),
                  h(
                    'div',
                    { className: 'dm-preset-row' },
                    h('span', { className: 'dm-preset-row-label' }, '新会话'),
                    h(FlagsMenu, {
                      label: '这个预设下新开的会话',
                      title: '这个预设下新会话的四个记忆开关',
                      flags: effectivePresetFlags(snapshot, row.id, 'session'),
                      busy,
                      onFlip: (key) => {
                        const flags = effectivePresetFlags(snapshot, row.id, 'session')
                        void savePreset(row.id, 'session', { [key]: flags[key] !== true })
                      },
                      onReset: () => {
                        void savePreset(row.id, 'session', snapshot?.defaults ?? {})
                      },
                      resetTitle: '恢复内置默认',
                    }),
                  ),
                  h(
                    'div',
                    { className: 'dm-preset-row' },
                    h('span', { className: 'dm-preset-row-label' }, '子代理'),
                    h(FlagsMenu, {
                      label: '这个预设下子代理的默认值',
                      title: '没有父会话可跟的时候（比如定时任务开的新会话），子代理用这一行。',
                      flags: effectivePresetFlags(snapshot, row.id, 'subagent'),
                      busy,
                      onFlip: (key) => {
                        const flags = effectivePresetFlags(snapshot, row.id, 'subagent')
                        void savePreset(row.id, 'subagent', { [key]: flags[key] !== true })
                      },
                      onReset: () => {
                        void savePreset(row.id, 'subagent', effectivePresetFlags(snapshot, row.id, 'session'))
                      },
                      resetTitle: '跟随上面一行',
                    }),
                  ),
                ),
              ),
            ),
        ),
        h(
          Card,
          { title: '写日记的人格' },
          h(
            'div',
            { className: 'dm-hint' },
            '日记跑在一个独立预设里，只挂了人格、时间和文件读写：记忆与日记工具来自插件本身，所以这里写的这段话不会影响你任何一个会话的人格。',
          ),
          h('textarea', {
            className: 'dm-input dm-textarea',
            rows: 4,
            value: diaryPersona,
            placeholder: '留空就用内置的「爱吃白饭的大肥鱼」：第一人称，平实、克制，写具体的事，不列条目。',
            onChange: (event) => setDiaryPersona(event.target.value),
          }),
          catalog === null
            ? h(
                'div',
                { className: 'dm-filter-row' },
                h('span', { className: 'dm-filter-label' }, '模型'),
                h('input', {
                  className: 'dm-input',
                  value: diaryProvider,
                  placeholder: 'provider，留空用全局默认',
                  onChange: (event) => setDiaryProvider(event.target.value),
                }),
                h('input', {
                  className: 'dm-input',
                  value: diaryModel,
                  placeholder: 'model，留空用全局默认',
                  onChange: (event) => setDiaryModel(event.target.value),
                }),
                h(Button, { kind: 'ghost', onClick: () => void loadCatalog(), title: '重新读一次宿主的模型列表' }, '读取模型'),
                h(Button, { kind: 'primary', onClick: saveDiaryPersona }, '保存'),
              )
            : h(
                'div',
                { className: 'dm-filter-row' },
                h('span', { className: 'dm-filter-label' }, '模型'),
                h(
                  'select',
                  {
                    className: 'dm-input dm-select',
                    value: modelPick(diaryProvider, diaryModel),
                    onChange: (event) => {
                      const next = splitModelPick(event.target.value)
                      setDiaryProvider(next.provider)
                      setDiaryModel(next.model)
                    },
                  },
                  modelOptions(catalog, diaryProvider, diaryModel),
                ),
                h(Button, { kind: 'ghost', onClick: () => void loadCatalog(), title: '重新读一次宿主的模型列表' }, '刷新'),
                h(Button, { kind: 'primary', onClick: saveDiaryPersona }, '保存'),
              ),
          catalogError === '' ? null : h('div', { className: 'dm-hint' }, `没读到宿主的模型列表：${catalogError}`),
          catalog !== null && Array.isArray(catalog.providers) && catalog.providers.length === 0
            ? h('div', { className: 'dm-hint' }, '宿主没有报告任何可用的模型路由：日记会走全局默认模型。')
            : null,
          personaNote === '' ? null : h('div', { className: 'dm-hint' }, personaNote),
          snapshot?.diaryPreset?.mounted === false
            ? h('div', { className: 'dm-hint' }, '这个预设这次没有挂上（见上面的错误），日记会退回默认预设运行。')
            : snapshot?.diaryPreset?.stale === true
              ? h('div', { className: 'dm-hint' }, '预设正在沿用上一次 DSH 启动时的注册：新的人设要重启后才生效。')
              : h('div', { className: 'dm-hint' }, '默认跟随全局默认模型；两个都填才会切。'),
        ),
        h(
          Card,
          { title: '每天写日记' },
          h(
            'div',
            { className: 'dm-hint' },
            '由 DSH 定时任务在固定时间开一个新会话，把当天所有会话的片段汇总成一篇日记。没有对话的日子不写。',
          ),
          h(
            'div',
            { className: 'dm-inline' },
            h('input', {
              className: 'dm-input',
              type: 'time',
              value: diaryTime,
              onChange: (event) => setDiaryTime(event.target.value),
            }),
            h(
              Button,
              {
                kind: diaryTask?.scheduled === true ? 'ghost' : 'primary',
                onClick: async () => {
                  setTaskBusy(true)
                  setTaskError('')
                  try {
                    const next = await apiPost('/diary-task', { action: 'enable', time: diaryTime })
                    setDiaryTask(next)
                  } catch (cause) {
                    setTaskError(`创建定时任务失败：${String(cause?.message ?? cause)}`)
                  } finally {
                    setTaskBusy(false)
                  }
                },
              },
              diaryTask?.scheduled === true ? '更新时间' : '开启',
            ),
            diaryTask?.scheduled === true
              ? h(
                  Button,
                  {
                    onClick: async () => {
                      setTaskBusy(true)
                      setTaskError('')
                      try {
                        const next = await apiPost('/diary-task', { action: 'disable' })
                        setDiaryTask(next)
                      } catch (cause) {
                        setTaskError(`关闭定时任务失败：${String(cause?.message ?? cause)}`)
                      } finally {
                        setTaskBusy(false)
                      }
                    },
                  },
                  '关闭',
                )
              : null,
            diaryTask?.scheduled === true
              ? h(
                  Button,
                  {
                    disabled: taskBusy,
                    onClick: async () => {
                      setTaskBusy(true)
                      setTaskError('')
                      try {
                        await apiPost('/diary-task', { action: 'run' })
                        setTaskError('')
                        setTaskNote('已让它立刻跑一次，日记会在几分钟内出现。')
                      } catch (cause) {
                        setTaskError(`立刻运行失败：${String(cause?.message ?? cause)}`)
                      } finally {
                        setTaskBusy(false)
                      }
                    },
                  },
                  '立刻运行一次',
                )
              : null,
          ),
          h(
            'div',
            { className: 'dm-meta', style: { marginTop: 0 } },
            diaryTask?.scheduled === true
              ? `已开启：每天 ${diaryTask.time ?? diaryTime}（${diaryTask.zone ?? ''}），状态 ${diaryTask.status ?? 'active'}`
              : '当前没有定时任务。',
          ),
          h(
            'div',
            { className: 'dm-hint', style: { marginTop: 8 } },
            '补写只在「记忆」页发生：点开某一天、选「日记」，右边有补写（那天还没有日记）和重写（再加一篇）两个按钮。定时任务只写它自己那一天，不会替你去翻哪天的日记缺了。',
          ),
          taskError === '' ? null : h('div', { className: 'dm-error' }, taskError),
          taskNote === '' ? null : h('div', { className: 'dm-hint' }, taskNote),
        ),
        h(
          Card,
          { title: '语义检索（第三档）' },
          h(
            'div',
            { className: 'dm-hint' },
            '默认只跑 FTS5 与中文 bigram 重排。开启嵌入重排需要先安装依赖与模型，未安装时请保持关闭。',
          ),
          h(
            'div',
            {
              className: 'dm-hint',
              style: { color: dependency?.installed === true ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-state-error-primary)' },
            },
            dependency?.installed === true
              ? `依赖已安装：${dependency.name}（模型缓存 ${dependency.models?.length ?? 0} 个）`
              : `依赖未安装：${dependency?.name ?? '@huggingface/transformers'}（约 570 MB，只装进插件自己的 vendor 目录）`,
          ),
          h(
            'div',
            { className: 'dm-hint' },
            '模型默认从 huggingface.co 下载，国内常常连不上。可以在下面换镜像，或者自己把 ONNX 目录放进 vendor/models 再把路径指过去。',
          ),
          h('input', {
            className: 'dm-input',
            value: remoteHost,
            placeholder: '下载镜像，例如 https://hf-mirror.com（留空用默认）',
            onChange: (event) => setRemoteHost(event.target.value),
            onBlur: () => saveSemantic({ remoteHost: remoteHost.trim() === '' ? null : remoteHost.trim() }),
          }),
          h('input', {
            className: 'dm-input',
            value: modelPath,
            placeholder: '本地模型目录（留空用内置模型名）',
            onChange: (event) => setModelPath(event.target.value),
            onBlur: () => saveSemantic({ modelPath: modelPath.trim() === '' ? null : modelPath.trim() }),
          }),
          h(
            Button,
            {
              disabled: installing,
              onClick: async () => {
                setInstalling(true)
                setProgress({ phase: 'installing', bytes: 0, totalBytes: 0 })
                try {
                  const result = await apiPost('/dependency', { action: 'install' })
                  setDependency(result)
                  onReload()
                } catch (cause) {
                  setDependency({ installed: false, error: String(cause?.message ?? cause) })
                } finally {
                  setInstalling(false)
                }
              },
            },
            installing ? '安装中…（几分钟）' : dependency?.installed === true ? '重新安装依赖' : '安装依赖',
          ),
          renderProgress(progress, installing),
          dependency?.error === undefined || dependency.error === null
            ? null
            : h('div', { className: 'dm-error' }, dependency.error),
          h(Toggle, {
            checked: snapshot.semantic?.enabled === true,
            onChange: async (value) => {
              await apiPost('/settings', { scope: 'semantic', semantic: { enabled: value } })
              onReload()
            },
            label: '启用嵌入重排',
            hint:
              dependency?.installed === true
                ? (snapshot.semantic?.modelPath ?? '使用默认模型 bge-small-zh-v1.5')
                : '依赖未安装时开启不会生效，第三档只会保持关闭。',
          }),
        ),
        h(
          Card,
          { title: '嵌入模型' },
          h(
            'div',
            { className: 'dm-hint' },
            '选一个装上，第三档就用它重排。模型文件放在插件的 vendor/models 里，不进 profile，删掉不影响别的东西。',
          ),
          models === null
            ? h(Empty, null, '读取模型列表…')
            : (models.items ?? []).length === 0
              ? h(Empty, null, '没有可用的模型。')
              : h(
                  'div',
                  { className: 'dm-models' },
                  (models.items ?? []).map((model) => {
                    const job = models.jobs?.[model.id]
                    const downloading = job?.phase === 'downloading'
                    const failed = job?.phase === 'error'
                    const busyHere = modelBusy.endsWith(':' + model.id)
                    return h(
                      'div',
                      {
                        key: model.id,
                        className: 'dm-model',
                        'data-active': model.active === true ? 'true' : 'false',
                      },
                      h(
                        'div',
                        { className: 'dm-model-main' },
                        h(
                          'div',
                          { className: 'dm-model-title' },
                          h('span', { className: 'dm-model-name' }, model.label),
                          model.active === true
                            ? h('span', { className: 'dm-badge' }, '使用中')
                            : model.installed === true
                              ? h('span', { className: 'dm-badge dm-badge-quiet' }, '已安装')
                              : null,
                        ),
                        h(
                          'div',
                          { className: 'dm-model-meta' },
                          h('code', null, model.id),
                          h('span', null, model.size),
                          h('span', null, model.dim + ' 维'),
                        ),
                        h('div', { className: 'dm-model-note' }, model.note),
                      ),
                      h(
                        'div',
                        { className: 'dm-model-side' },
                        downloading
                          ? h(
                              'div',
                              { className: 'dm-model-job' },
                              h(
                                'div',
                                { className: 'dm-progress' },
                                h('div', {
                                  className: 'dm-progress-fill',
                                  style: {
                                    width:
                                      job.total > 0
                                        ? Math.min(100, Math.round((job.bytes / job.total) * 100)) + '%'
                                        : '10%',
                                  },
                                }),
                              ),
                              h(
                                'div',
                                { className: 'dm-model-job-text' },
                                megabytes(job.bytes) + ' / ' + (job.total > 0 ? megabytes(job.total) : '?') + ' MB',
                              ),
                            )
                          : failed
                            ? h('div', { className: 'dm-error' }, '下载失败：' + String(job.error ?? ''))
                            : null,
                        h(
                          'div',
                          { className: 'dm-actions' },
                          model.installed === true
                            ? model.active === true
                              ? h(
                                  Button,
                                  {
                                    disabled: modelBusy !== '',
                                    onClick: () => runModel('remove', model.id),
                                  },
                                  busyHere ? '处理中…' : '卸载',
                                )
                              : h(
                                  Button,
                                  {
                                    kind: 'primary',
                                    disabled: modelBusy !== '',
                                    onClick: () => runModel('use', model.id),
                                  },
                                  busyHere ? '切换中…' : '改用这个',
                                )
                            : h(
                                Button,
                                {
                                  kind: 'primary',
                                  disabled: modelBusy !== '' || downloading,
                                  onClick: () => runModel('install', model.id),
                                },
                                downloading ? '下载中…' : busyHere ? '启动中…' : '安装',
                              ),
                          model.installed === true && model.active !== true
                            ? h(
                                Button,
                                {
                                  disabled: modelBusy !== '',
                                  onClick: () => runModel('remove', model.id),
                                },
                                busyHere ? '处理中…' : '卸载',
                              )
                            : null,
                        ),
                      ),
                    )
                  }),
                ),
          h(
            Toolbar,
            null,
            h(Button, { onClick: () => runModel('reveal', '') }, '打开模型目录'),
            models?.directory === undefined || models.directory === ''
              ? null
              : h('span', { className: 'dm-sid' }, models.directory),
          ),
          modelError === '' ? null : h('div', { className: 'dm-error' }, modelError),
        ),      )
    }
    /** Kind labels for the search hits, which mix all three tables. */
    const KIND_LABEL = { fact: '事实', episode: '片段', diary: '日记' }

    /**
     * Results of one query, across facts, episodes and diary pages.
     *
     * This is the same pipeline the tools use (FTS5 → bigram rerank → optional
     * embeddings), so what the panel finds here is what the agent would find.
     */
    const SPLIT_TERMS = /[\s,，。、;；:：!！?？'"“”‘’()（）\[\]【】]+/u

    /** Terms the backend was asked for, so the hit can show *why* it matched. */
    function splitTerms(query) {
      return String(query)
        .split(SPLIT_TERMS)
        .map((term) => term.trim())
        .filter((term) => term !== '')
    }

    function highlight(text, query) {
      const body = String(text)
      const terms = splitTerms(query)
      if (terms.length === 0) return body
      const pattern = terms
        .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')
      if (pattern === '') return body
      const re = new RegExp(`(${pattern})`, 'gi')
      return body
        .split(re)
        .map((part, index) =>
          terms.some((term) => term.toLowerCase() === part.toLowerCase())
            ? h('mark', { key: index, className: 'dm-mark' }, part)
            : part,
        )
    }

    // ------------------------------------------------------- switch plumbing

    /**
     * The menu and the panel read the same flags from different places, so a
     * write in one has to wake the other. There is no shared store in the
     * browser half, so this is the smallest thing that works: a set of
     * callbacks, pinged after any successful write.
     */
    const flagWatchers = new Set()

    function announceFlags() {
      for (const watcher of [...flagWatchers]) {
        try {
          watcher()
        } catch {
          // A unmounted watcher must not stop the rest.
        }
      }
    }

    // ------------------------------------------------------------------ shell

    /**
     * The right-side panel: one header, five tabs.
     *
     * Every page fetches only what it renders, except the overview, which needs
     * a handful of one-shot reads at once. Those run through `reload` so the
     * refresh button and the first mount share one path.
     */
    function Panel() {
      const [tab, setTab] = useState('overview')
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(false)
      const [stats, setStats] = useState(null)
      const [activity, setActivity] = useState([])
      const [latest, setLatest] = useState(null)
      const [facts, setFacts] = useState([])
      const [episodes, setEpisodes] = useState([])
      const [sessions, setSessions] = useState([])
      const [query, setQuery] = useState('')
      const [hits, setHits] = useState(null)
      const [searching, setSearching] = useState(false)
      const [focus, setFocus] = useState(undefined)
      const [settings, setSettings] = useState({
        defaults: { recall: true, write: true, diary: true, forget: false },
        presets: {},
        sessions: {},
        subagents: {},
        semantic: {},
        diary: { persona: '', provider: '', model: '' },
      })

      const reload = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const [statsBody, activityBody, diaryBody, factsBody, episodesBody, settingsBody, sessionsBody] =
            await Promise.all([
              apiGet('/stats'),
              // One year of days, padded to whole weeks by the wall itself. The
              // route answers in three grouped queries, so this is not 365 reads.
              apiGet('/activity', { days: 371 }),
              // Four pages, not one: the overview lists them with the same row
              // shape as the facts and fragments beside it.
              apiGet('/diary', { limit: 4 }),
              apiGet('/facts', { limit: 3 }),
              apiGet('/episodes', { limit: 5 }),
              apiGet('/settings'),
              // The stored-session list is the expensive one: it walks every
              // session the backend can see. A failure there must not blank the
              // rest of the panel, so it degrades to an empty list.
              apiGet('/sessions').catch(() => ({ items: [] })),
            ])
          setStats(statsBody)
          setActivity(activityBody.days ?? [])
          setLatest(diaryBody.items ?? [])
          setFacts(factsBody.items ?? [])
          setEpisodes(episodesBody.items ?? [])
          setSettings(settingsBody)
          setSessions(sessionsBody.items ?? [])
        } catch (cause) {
          setError(`读取失败：${String(cause?.message ?? cause)}`)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        void reload()
      }, [reload])

      const jump = useCallback((day, kind) => {
        if (day === undefined || day === null) return
        // The memory page keys off `focus`, and a fresh object each time is what
        // makes re-clicking the same target re-seat the board rather than sit on
        // whatever the user navigated to since.
        setFocus({ day: String(day).slice(0, 10), kind })
        setTab('memory')
      }, [])

      const search = useCallback(async (text, options) => {
        const trimmed = String(text ?? '').trim()
        setQuery(String(text ?? ''))
        setTab('search')
        if (trimmed === '') {
          setHits(null)
          return
        }
        setSearching(true)
        try {
          const kinds = options?.kinds ?? ['fact', 'episode', 'diary']
          const body = await apiGet('/search', {
            q: trimmed,
            limit: 60,
            kinds: kinds.join(','),
            ...(options?.from === undefined ? {} : { from: options.from }),
            ...(options?.to === undefined ? {} : { to: options.to }),
          })
          setHits(body.hits ?? [])
        } catch (cause) {
          setError(`搜索失败：${String(cause?.message ?? cause)}`)
          setHits([])
        } finally {
          setSearching(false)
        }
      }, [])

      const body =
        tab === 'overview'
          ? h(Overview, {
              stats,
              activity,
              latest,
              facts,
              episodes,
              onReload: reload,
              onJump: jump,
            })
          : tab === 'search'
            ? h(SearchPage, {
                query,
                hits,
                searching,
                onQuery: setQuery,
                onSearch: search,
                onReload: reload,
                onJump: jump,
              })
            : tab === 'memory'
              ? h(MemoryBoard, { focus })
              : tab === 'sessions'
                ? h(SessionsView, {
                    snapshot: settings,
                    sessions,
                    onReload: reload,
                    onOpenSession: (id) => {
                      setFocus({ day: todayKey(), kind: 'episodes' })
                      setTab('memory')
                    },
                  })
                : h(Settings, { snapshot: settings, onReload: reload })

      return h(
        'div',
        { className: 'dm-page' },
        h(
          'div',
          { className: 'dm-head' },
          h('div', { className: 'dm-title' }, '深度记忆'),
          h('div', { className: 'dm-sub' }, loading ? '读取中…' : '本地 sqlite · 三档检索'),
          h('span', { className: 'dm-spacer' }),
          h(
            'div',
            { className: 'dm-search' },
            h('input', {
              className: 'dm-input',
              value: query,
              placeholder: '搜索记忆（回车）',
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                void search(event.currentTarget.value)
              },
            }),
            h(
              Button,
              { onClick: () => void search(query), disabled: searching },
              searching ? '搜索中' : '搜索',
            ),
          ),
          h(Button, { onClick: reload, disabled: loading }, '刷新'),
        ),
        h(
          'div',
          { className: 'dm-tabs' },
          TABS.map((item) =>
            h(
              'div',
              {
                key: item.id,
                className: 'dm-tab',
                'data-active': tab === item.id ? 'true' : 'false',
                onClick: () => setTab(item.id),
              },
              item.label,
            ),
          ),
        ),
        h(ErrorBar, { error }),
        h('div', { className: 'dm-scroll' }, body),
      )
    }

    /**
     * The sidebar owns the button and its tint, so the glyph inherits colour via
     * `currentColor` instead of picking one: the same icon then reads correctly
     * on a light and a dark sidebar, active or not.
     *
     * Identical geometry to `icon.svg` - the jellyfish body, its four legs and
     * the highlight are one path, and the highlight is a hole rather than a
     * second colour, so it works on any background. Only the paint differs: the
     * bundle icon uses the brand pink, this one uses currentColor.
     */
    function SidebarIcon({ size }) {
      const edge = typeof size === 'number' ? size : 18
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 512 512',
          role: 'img',
          'aria-hidden': true,
        },
        h('path', {
          fill: 'currentColor',
          fillRule: 'evenodd',
          clipRule: 'evenodd',
          d: 'M 256 42.667 C 155.85 42.667 74.667 127.45 74.667 232 C 76.02 250.55 87.95 266.35 105.8 271.8 L 138.667 281.6 L 138.667 330.667 C 138.667 344.889 117.333 344.889 117.333 330.667 C 117.333 302.222 74.667 302.222 74.667 330.667 C 74.667 401.778 181.333 401.778 181.333 330.667 L 181.333 292.4 L 202.667 292.4 L 202.667 416 C 202.667 430.222 181.333 430.222 181.333 416 L 181.333 413.333 C 181.333 385.6 138.667 385.6 138.667 413.333 L 138.667 416 C 138.667 487.111 245.333 487.111 245.333 416 L 245.333 298.5 L 266.667 298.5 L 266.667 416 C 266.667 487.111 373.333 487.111 373.333 416 C 373.333 387.556 330.667 387.556 330.667 416 C 330.667 430.222 309.333 430.222 309.333 416 L 309.333 294.4 L 330.667 294.4 L 330.667 330.667 C 330.667 401.778 437.333 401.778 437.333 330.667 C 437.333 302.222 394.667 302.222 394.667 330.667 C 394.667 344.889 373.333 344.889 373.333 330.667 L 373.333 281.6 L 406.2 271.8 C 424.05 266.35 435.98 250.55 437.333 232 C 437.333 127.45 356.15 42.667 256 42.667 Z M 221.1 79.25 C 227.1 77.65 232.9 81.25 234.45 86.95 C 236 92.65 232.5 98.55 226.8 100.1 C 194.9 108.55 167.2 127.45 149.9 154.5 C 146.7 159.5 140.1 161 135.1 157.8 C 130.1 154.6 128.6 148 131.8 143 C 151.9 111.45 183.9 89.15 221.1 79.25 Z',
        }),
      )
    }

    // ------------------------------------------------- conversation memory tab

    /**
     * The memory page, narrowed to one conversation.
     *
     * This is a `conversation.view` cell: the host renders one view per
     * conversation and hands every entry the same owner props, including the
     * `sessionId` this page is scoped to. It is the same board the panel shows,
     * so the two never drift apart.
     */
    function ConversationMemory(props) {
      const sessionId = props?.sessionId === undefined ? undefined : String(props.sessionId)
      return h(
        'div',
        { className: 'dm-page' },
        h(
          'div',
          { className: 'dm-head' },
          h(
            'div',
            { className: 'dm-title-row' },
            h('span', { className: 'dm-title-icon' }, h(SidebarIcon, { size: 18 })),
            h('div', { className: 'dm-title' }, '深度记忆'),
          ),
          h(
            'div',
            { className: 'dm-sub' },
            sessionId === undefined ? '这个会话还没有记忆' : '只显示这个会话里说过的话',
          ),
        ),
        h(
          'div',
          { className: 'dm-scroll' },
          sessionId === undefined
            ? h(Empty, null, '还没有会话标识，等这条对话产生记录后再看。')
            : h(MemoryBoard, { sessionId }),
        ),
      )
    }


    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        installStyle()
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 25,
              label: '深度记忆',
            },
            SidebarIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel),
        )
        // The four memory switches sit at the composer's right edge, beside the
        // model and mode pickers: that is where the decision is made. The slot is
        // session-scoped, so one registration serves every conversation, and the
        // menu portals its card because the composer clips its overflow.
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            { name: 'conversation.input.right', id: 'deepmemory-flags', order: 30 },
            ComposerFlags,
          ),
        )
        // A fresh id beside the shipped views: reusing one of their ids would
        // replace that cell instead of adding a tab. The label is a thunk so the
        // host re-reads it whenever the active locale changes. The host renders
        // the label as plain text, so the icon lives in the view header instead
        // of inside the tab.
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            { name: 'conversation.view', id: 'deepmemory', order: 35, label: () => '深度记忆' },
            ConversationMemory,
          ),
        )
      },
    }
  },
})
