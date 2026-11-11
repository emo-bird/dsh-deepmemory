/**
 * Client half: the DeepMemory console.
 *
 * Registered in three slots — `sidebar.panellist` owns the icon and resolves its
 * label from list metadata, `main` renders under that same key when the entry is
 * selected, and `conversation.session.header.actions` adds the three per-session
 * chips. The first two must share one id.
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
 * same origin, which carries the browser's authority-bound cookie. Only React
 * is required; every control is built here so the bundle stays independent of
 * the host's client packages.
 */
window.__ModuleLoader__.load({
  id: '@emo-bird/dsh-deepmemory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

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
  font-size: 13px;
  line-height: 1.5;
}
.dm-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 0 18px 24px; }
.dm-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 18px 12px;
  flex-wrap: wrap;
}
.dm-title { font-size: 15px; font-weight: 600; }
.dm-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dm-spacer { flex: 1; }
.dm-tabs {
  display: flex;
  gap: 2px;
  padding: 0 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  margin-bottom: 14px;
}
.dm-tab {
  cursor: pointer;
  padding: 6px 10px;
  font-size: 12px;
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
  padding: 12px 14px;
  margin-bottom: 10px;
}
.dm-card-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.dm-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 6px; }
.dm-meta {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  margin-top: 6px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.dm-body { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dm-body-sm { font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dm-empty { font-size: 12px; color: var(--dsw-alias-label-tertiary); padding: 28px 0; text-align: center; }
.dm-error {
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 6px 10px;
  margin: 0 18px 10px;
}
.dm-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
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
.dm-stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.dm-stat {
  flex: 1 1 90px;
  border: 1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  padding: 12px 14px;
}
.dm-stat-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dm-stat-value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dm-th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  white-space: nowrap;
}
.dm-th-flag { width: 40px; text-align: center; }
.dm-table tbody tr { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dm-table tbody tr:last-child { border-bottom: 0; }
.dm-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dm-table td { padding: 7px 8px; vertical-align: top; }
.dm-cell-name { max-width: 420px; }
.dm-cell-title { font-weight: 600; overflow-wrap: anywhere; }
.dm-cell-first {
  color: var(--dsw-alias-label-secondary);
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-cell-flag { text-align: center; }
.dm-actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
.dm-cell-flag input { cursor: pointer; accent-color: var(--dsw-alias-link); }
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
.dm-link { color: var(--dsw-alias-link); text-decoration: none; cursor: pointer; }
/* Destructive links need more weight than the error colour alone gives in the
   light palette, where it sits at roughly 4:1 against the card. */
.dm-link-danger { color: var(--dsw-alias-state-error-primary); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.dm-link-danger:hover { text-decoration-thickness: 2px; }
.dm-link:hover { text-decoration: underline; }
.dm-preset-id { font-size: 12px; font-weight: 600; color: var(--dsw-alias-link); margin-bottom: 4px; }
.dm-flag-title { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.dm-flag-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; }
.dm-toggle { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; cursor: pointer; }
.dm-toggle input { margin-top: 3px; cursor: pointer; accent-color: var(--dsw-alias-link); }
.dm-toggle-text { display: flex; flex-direction: column; }
.dm-toggle-label { font-size: 13px; }
.dm-toggle-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dm-inline { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.dm-chips { display: inline-flex; align-items: center; gap: 3px; margin-right: 4px; }
.dm-chip {
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  line-height: 14px;
  text-align: center;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-weight: 600;
  transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              border-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              opacity var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-chip:hover { border-color: var(--dsw-alias-label-tertiary); }
.dm-chip[data-on='true'] {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dm-chip[data-busy='true'] { opacity: .5; cursor: default; }
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

.dm-grid-ov { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 860px) { .dm-grid-ov { grid-template-columns: 1fr; } }
.dm-sec { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dm-panel {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1);
  padding: 12px 14px;
  margin-bottom: 12px;
  min-width: 0;
  box-sizing: border-box;
}
.dm-panel-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.dm-panel-title { font-size: 13px; font-weight: 600; }
.dm-panel-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dm-trend { display: flex; align-items: flex-end; gap: 6px; height: 96px; }
.dm-trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 4px; min-width: 0; }
.dm-trend-bar { width: 100%; max-width: 36px; border-radius: var(--dsw-radius-sm, 8px) var(--dsw-radius-sm, 8px) 2px 2px; background: var(--dsw-alias-label-primary); min-height: 2px; }
.dm-trend-day { font-size: 10px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dm-list-item {
  padding: 8px 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-list-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dm-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ------------------------------------------------------------------ memory */

.dm-mem { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 12px; align-items: start; }
@media (max-width: 780px) { .dm-mem { grid-template-columns: 1fr; } }
.dm-mem-side { display: flex; flex-direction: column; min-width: 0; }
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
.dm-cats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 0; }
.dm-cat {
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  transition: all var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-cat:hover { border-color: var(--dsw-alias-label-tertiary); }
.dm-cat[data-on='true'] {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dm-cat-n { font-size: 10px; opacity: .75; }
.dm-day-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.dm-day-title { font-size: 13px; font-weight: 600; }
.dm-empty-action { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 0; }
.dm-filter-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.dm-filter-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); min-width: 56px; }
.dm-group-title { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin: 12px 0 6px; }
.dm-group-title:first-child { margin-top: 0; }
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
        { id: 'facts', label: '事实', count: (row) => row?.facts ?? 0 },
        { id: 'episodes', label: '片段', count: (row) => row?.episodes ?? 0 },
      ],
      session: [
        { id: 'facts', label: '事实', count: (row) => row?.facts ?? 0 },
        { id: 'episodes', label: '片段', count: (row) => row?.episodes ?? 0 },
      ],
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

      const backfill = async () => {
        setBusy(true)
        setNote('')
        try {
          await apiPost('/backfill', { day: selected })
          // The route always answers `once`: a one-shot aimed at the clicked day.
          setNote(`已排一个只写 ${selected} 的一次性任务。`)
          window.setTimeout(() => {
            void loadMonth()
            void loadDetail()
          }, 4000)
        } catch (cause) {
          setNote(`补写没排上：${String(cause?.message ?? cause)}`)
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

      let content = null
      if (loading && detail === null) content = h(Empty, null, '读取中…')
      else if (kind === 'diary') {
        content =
          pages.length === 0
            ? h(
                'div',
                { className: 'dm-empty-action' },
                h('div', { className: 'dm-empty', style: { padding: 0 } }, '这一天没有日记。'),
                detail?.missing === true
                  ? h(Button, { kind: 'primary', disabled: busy, onClick: backfill }, '补写这一天')
                  : h('div', { className: 'dm-hint' }, '这一天也没有素材，补写会直接跳过。'),
              )
            : pages.map((page) =>
                h(
                  'div',
                  { key: page.id, className: 'dm-card' },
                  h(
                    'div',
                    { className: 'dm-meta', style: { marginTop: 0, marginBottom: 4 } },
                    h('span', null, page.day),
                    h('span', null, fmtTime(page.createdAt)),
                    page.origin === '' ? null : h('span', { className: 'dm-badge dm-badge-quiet' }, '定时任务'),
                    h('span', { className: 'dm-spacer' }),
                    h(Button, { disabled: busy, onClick: () => forget({ kind: 'diary', id: page.id }) }, '删除'),
                  ),
                  h('div', { className: 'dm-body' }, page.text),
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
              onSelect: setSelected,
              onShift: (delta) => setMonth(shiftMonth(month, delta)),
              showMissing: scope === 'day',
            }),
            h(
              'div',
              { className: 'dm-panel' },
              h(
                'div',
                { className: 'dm-cats' },
                categories.map((category) =>
                  h(
                    'button',
                    {
                      key: category.id,
                      type: 'button',
                      className: 'dm-cat',
                      'data-on': kind === category.id ? 'true' : 'false',
                      onClick: () => setKind(category.id),
                    },
                    category.label,
                    h('span', { className: 'dm-cat-n' }, String(category.count(counts))),
                  ),
                ),
              ),
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
              scope === 'day' && kind === 'diary' && detail?.missing === true
                ? h(Button, { kind: 'primary', disabled: busy, onClick: backfill }, '补写')
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
     * The last seven days as bars.
     *
     * "越活跃颜色越鲜艳" is literal here: the bar height carries the count, and
     * the same bar is more opaque the more it holds, so the busiest day reads
     * before any axis does.
     */
    function ActivityTrend({ days }) {
      const rows = Array.isArray(days) ? days : []
      const values = rows.map((row) => (Number(row.episodes) || 0) + (Number(row.facts) || 0))
      const top = Math.max(1, ...values)
      return h(
        'div',
        { className: 'dm-panel' },
        h(
          'div',
          { className: 'dm-panel-head' },
          h('span', { className: 'dm-panel-title' }, '近 7 日活跃度'),
          h('span', { className: 'dm-panel-sub' }, '片段 + 事实'),
        ),
        rows.length === 0
          ? h(Empty, null, '还没有记录。')
          : h(
              'div',
              { className: 'dm-trend' },
              rows.map((row, index) => {
                const value = values[index]
                return h(
                  'div',
                  { key: row.day, className: 'dm-trend-col', title: `${row.day}：${value} 条` },
                  h('div', {
                    className: 'dm-trend-bar',
                    style: {
                      height: `${Math.max(2, Math.round((value / top) * 100))}%`,
                      opacity: value === 0 ? 0.12 : 0.35 + 0.65 * (value / top),
                    },
                  }),
                  h('span', { className: 'dm-trend-day' }, row.day.slice(5)),
                )
              }),
            ),
      )
    }

    function Overview({ stats, activity, latest, facts, episodes, onReload, onJump }) {
      const [note, setNote] = useState('')
      const [expanded, setExpanded] = useState(false)
      const preview = latest ?? null
      const previewText = preview === null ? '' : String(preview.text)
      const long = previewText.length > 220
      return h(
        'div',
        null,
        h(Metrics, { stats }),
        h('div', { style: { height: 10 } }),
        h(
          'div',
          { className: 'dm-grid-ov' },
          h(
            'div',
            { className: 'dm-sec' },
            h(ActivityTrend, { days: activity }),
            h(
              'div',
              { className: 'dm-panel' },
              h(
                'div',
                { className: 'dm-panel-head' },
                h('span', { className: 'dm-panel-title' }, '最近一日日记'),
                h('span', { className: 'dm-panel-sub' }, preview === null ? '还没有' : preview.day),
                h('span', { className: 'dm-spacer' }),
                preview === null
                  ? null
                  : h(
                      'a',
                      {
                        className: 'dm-link',
                        href: '#',
                        onClick: (event) => {
                          event.preventDefault()
                          onJump?.(preview.day, 'diary')
                        },
                      },
                      '去看这一天',
                    ),
              ),
              preview === null
                ? h(Empty, null, '还没有日记。到「记忆」页选一天补写。')
                : h(
                    'div',
                    null,
                    h(
                      'div',
                      { className: long && !expanded ? 'dm-body dm-clamp-2' : 'dm-body' },
                      previewText,
                    ),
                    long
                      ? h(
                          Button,
                          { onClick: () => setExpanded(!expanded) },
                          expanded ? '收起' : '展开全文',
                        )
                      : null,
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
                    h(
                      'div',
                      {
                        key: item.id,
                        className: 'dm-list-item',
                        onClick: () => onJump?.(dayFromDate(new Date(Number(item.createdAt))), 'facts'),
                      },
                      h('div', { className: 'dm-body-sm dm-clamp-2' }, item.text),
                      h('div', { className: 'dm-meta', style: { marginTop: 2 } }, h('span', null, fmtTime(item.createdAt))),
                    ),
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
                    h(
                      'div',
                      {
                        key: item.id,
                        className: 'dm-list-item',
                        onClick: () => onJump?.(dayFromDate(new Date(Number(item.createdAt))), 'episodes'),
                      },
                      h(
                        'div',
                        { className: 'dm-meta', style: { marginTop: 0, marginBottom: 2 } },
                        h('span', { className: 'dm-role', 'data-role': item.role }, ROLE_LABEL[item.role] ?? item.role),
                        h('span', null, shortTime(item.createdAt)),
                      ),
                      h('div', { className: 'dm-body-sm dm-clamp-2' }, item.text),
                    ),
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
        null,
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

    function FlagRow({ title, hint, flags, onChange }) {
      return h(
        'div',
        { style: { marginBottom: 8 } },
        h('div', { className: 'dm-flag-title' }, title),
        hint === undefined ? null : h('div', { className: 'dm-flag-hint' }, hint),
        h(Toggle, { checked: flags.recall, onChange: (value) => onChange({ recall: value }), label: '读记忆' }),
        h(Toggle, { checked: flags.write, onChange: (value) => onChange({ write: value }), label: '写记忆' }),
        h(Toggle, { checked: flags.diary, onChange: (value) => onChange({ diary: value }), label: '计入日记' }),
        h(Toggle, {
          checked: flags.forget,
          onChange: (value) => onChange({ forget: value }),
          label: '删除记忆',
          hint: '允许清空这个会话已记下的全部片段',
        }),
      )
    }

    const FLAG_COLUMNS = [
      { key: 'recall', label: '读', title: '读取记忆' },
      { key: 'write', label: '写', title: '写入记忆' },
      { key: 'diary', label: '日', title: '计入日记' },
      { key: 'forget', label: '删', title: '允许删除记忆' },
    ]

    /**
     * Which cells of a row are inherited rather than its own override.
     *
     * Both tables store only differences from their parent, so a cell with no
     * stored key is *following* the layer above. Drawing it exactly like an
     * explicit setting hides which switches this row actually owns.
     */
    /** One checkbox per flag, sized for a table cell. */
    function FlagCells({ flags, disabled, onToggle, inherited }) {
      const followed = inherited === undefined ? {} : inherited
      return FLAG_COLUMNS.map((column) =>
        h(
          'td',
          { key: column.key, className: 'dm-cell-flag' },
          h('input', {
            type: 'checkbox',
            checked: flags[column.key] === true,
            disabled: disabled === true,
            'data-inherited': followed[column.key] === true ? 'true' : 'false',
            title: followed[column.key] === true ? `${column.title}（继承上层）` : column.title,
            'aria-label': column.title,
            onChange: (event) => onToggle({ [column.key]: event.target.checked }),
          }),
        ),
      )
    }

    const FlagHead = () =>
      h(
        'tr',
        null,
        h('th', { className: 'dm-th' }, '会话'),
        h('th', { className: 'dm-th' }, '首句'),
        FLAG_COLUMNS.map((column) => h('th', { key: column.key, className: 'dm-th dm-th-flag', title: column.title }, column.label)),
      )

    /**
     * Per-session control, as one table per scope.
     *
     * A row is one conversation, and the four switches are its memory policy:
     * read, write, count toward the diary, and allow deletion. There is no
     * preset layer any more — a session reads the global defaults once, when
     * it is created, and owns its values from then on, so editing the defaults
     * never reaches back into a conversation the user already has.
     *
     * The subagent table is the second layer: a child agent follows its parent
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

      const nameCell = (row, subagent) =>
        h(
          'td',
          { className: 'dm-cell-name' },
          h('div', { className: 'dm-cell-title' }, row.title === '' ? row.sessionId : row.title),
          h(
            'div',
            { className: 'dm-meta', style: { marginTop: 2 } },
            h('span', { className: 'dm-sid' }, row.sessionId),
            subagent ? null : row.presetId === null ? null : h('span', null, row.presetId),
            (() => {
              const own = subagent ? row.subagentOwn : row.own
              const drafted = drafts[(subagent ? 'subagent' : 'session') + ':' + row.sessionId] !== undefined
              const overridden = drafted || (own !== null && own !== undefined)
              if (subagent && !overridden) return h('span', null, '跟随本会话')
              return overridden ? h('span', { className: 'dm-preset-id' }, '已覆盖') : null
            })(),
            subagent || row.own === null || row.own === undefined
              ? null
              : h(
                  'a',
                  {
                    className: 'dm-link',
                    href: '#',
                    onClick: (event) => {
                      event.preventDefault()
                      onOpenSession?.(row.sessionId)
                    },
                  },
                  '看片段',
                ),
            !drafts[(subagent ? 'subagent' : 'session') + ':' + row.sessionId] &&
            ((subagent ? row.subagentOwn : row.own) === null || (subagent ? row.subagentOwn : row.own) === undefined)
              ? null
              : h(
                  'a',
                  {
                    className: 'dm-link',
                    href: '#',
                    onClick: (event) => {
                      event.preventDefault()
                      void restore(row.sessionId, subagent)
                    },
                  },
                  '恢复继承',
                ),
            subagent || row.effective.forget !== true
              ? null
              : h(
                  'a',
                  {
                    href: '#',
                    className: 'dm-link dm-link-danger',
                    onClick: async (event) => {
                      event.preventDefault()
                      setBusy(true)
                      try {
                        await apiPost('/forget', { kind: 'session', sessionId: row.sessionId })
                        onReload()
                      } finally {
                        setBusy(false)
                      }
                    },
                  },
                  '清空本会话记忆',
                ),
          ),
        )

      return h(
        'div',
        null,
        h(ErrorBar, { error: error === '' ? null : error }),
        h(
          Card,
          { title: '会话（' + rows.length + '）' },
          h(
            Toolbar,
            null,
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
            : h(
                'table',
                { className: 'dm-table' },
                h('thead', null, h(FlagHead, null)),
                h(
                  'tbody',
                  null,
                  shown.map((row) =>
                    h(
                      'tr',
                      { key: row.sessionId },
                      nameCell(row, false),
                      h('td', { className: 'dm-cell-first' }, row.firstLine === '' ? '—' : row.firstLine),
                      h(FlagCells, {
                        flags: draftOf('session', row),
                        disabled: busy,
                        onToggle: (patch) => save('session', row.sessionId, patch),
                      }),
                    ),
                  ),
                ),
              ),
        ),
        h(
          Card,
          { title: '子代理默认值' },
          h(
            'div',
            { className: 'dm-hint' },
            '子代理默认跟随发起它的会话；在这里可以单独给某个会话的子代理定一套。子代理说的话记在父会话名下，关掉「写」只影响它能不能新增片段，不会另起一条记忆线。',
          ),
          shown.length === 0
            ? h(Empty, null, '没有可设置的会话。')
            : h(
                'table',
                { className: 'dm-table' },
                h('thead', null, h(FlagHead, null)),
                h(
                  'tbody',
                  null,
                  shown.map((row) =>
                    h(
                      'tr',
                      { key: 'sub:' + row.sessionId },
                      nameCell(row, true),
                      h('td', { className: 'dm-cell-first' }, row.firstLine === '' ? '—' : row.firstLine),
                      h(FlagCells, {
                        flags: draftOf('subagent', row),
                        disabled: busy,
                        onToggle: (patch) => save('subagent', row.sessionId, patch),
                      }),
                    ),
                  ),
                ),
              ),
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
       * The global defaults as this view last wrote them.
       *
       * Re-reading the snapshot after each click is what made this page flash;
       * the checkboxes render from the snapshot, so the written value has to be
       * kept here until the next load replaces it.
       */
      const [globalDraft, setGlobalDraft] = useState(null)
      const globalFlags = globalDraft === null ? snapshot?.global ?? {} : globalDraft

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
      }, [])

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

      const save = useCallback(
        async (scope, id, flags) => {
          setBusy(true)
          try {
            await apiPost('/settings', { scope, id, flags })
            // Nothing that already exists follows the global defaults, so the
            // only thing to update is this card's own checkboxes.
            if (scope === 'global') {
              setGlobalDraft((current) => ({ ...(current === null ? snapshot?.global ?? {} : current), ...flags }))
            } else {
              onReload()
            }
          } finally {
            setBusy(false)
          }
        },
        [onReload, snapshot],
      )

      return h(
        'div',
        null,
        h(ErrorBar, { error: taskBusy ? '保存中…' : null }),
        h(
          Card,
          { title: '全局默认' },
          h(FlagRow, {
            title: '新会话的默认值',
            hint: '会话创建时读一次这套值，之后各自独立；改这里不会动任何已经存在的会话。',

            flags: globalFlags,
            onChange: (patch) => save('global', undefined, patch),
          }),
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
            { className: 'dm-meta', style: { marginTop: 6 } },
            h(Toggle, {
              checked: snapshot?.backfill !== false,
              label: '写日记时顺带补最近 7 天缺的',
              hint: '每次写日记前先扫最近 7 天，有素材却没写的一并补上。关掉之后只写当天。',
              onChange: async (next) => {
                setTaskError('')
                try {
                  await apiPost('/settings', { scope: 'backfill', enabled: next })
                  onReload()
                } catch (cause) {
                  setTaskError(`保存补写开关失败：${String(cause?.message ?? cause)}`)
                }
              },
            }),
          ),
          h(
            'div',
            { className: 'dm-hint', style: { marginTop: 8 } },
            '想补写某一天，去「记忆」页点那一天、选「日记」，右边就有补写按钮。',
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

    // -------------------------------------------------- session header chips

    /**
     * Four one-letter chips in the session title bar.
     *
     * The header clips overflow and has no room for labels, so each chip is a
     * single glyph whose fill carries the state. Fill and foreground come from
     * the paired tokens, so "on" stays legible in both palettes.
     */
    /**
     * The chips and the panel read the same flags from different places, so a
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

    const CHIPS = [
      { key: 'recall', glyph: '读', title: '本会话读取记忆' },
      { key: 'write', glyph: '写', title: '本会话写入记忆' },
      { key: 'diary', glyph: '日', title: '本会话计入日记' },
      { key: 'forget', glyph: '删', title: '本会话允许删除记忆' },
    ]

    function HeaderFlags({ sessionId }) {
      const [flags, setFlags] = useState(null)
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        if (sessionId === undefined) return
        try {
          const body = await apiGet('/session-flags', { sessionId })
          setFlags(body.effective)
        } catch {
          setFlags(null)
        }
      }, [sessionId])

      useEffect(() => {
        load()
        flagWatchers.add(load)
        const onFocus = () => load()
        window.addEventListener('focus', onFocus)
        return () => {
          flagWatchers.delete(load)
          window.removeEventListener('focus', onFocus)
        }
      }, [load])

      if (sessionId === undefined || flags === null) return null

      const flip = async (key) => {
        if (busy) return
        setBusy(true)
        try {
          const body = await apiPost('/session-flags', {
            sessionId,
            flags: { [key]: flags[key] !== true },
          })
          setFlags(body.effective)
          announceFlags()
        } catch {
          // Leave the chips as they were; the click simply did not take.
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'dm-chips' },
        CHIPS.map((chip) => {
          const on = flags[chip.key] === true
          return h(
            'span',
            {
              key: chip.key,
              className: 'dm-chip',
              'data-on': on ? 'true' : 'false',
              'data-busy': busy ? 'true' : 'false',
              title: `${chip.title}：${on ? '开' : '关'}（点击切换）`,
              onClick: () => flip(chip.key),
            },
            chip.glyph,
          )
        }),
      )
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
        global: { recall: true, write: true, diary: true },
        sessions: {},
        subagents: {},
        semantic: {},
        backfill: true,
      })

      const reload = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const [statsBody, activityBody, diaryBody, factsBody, episodesBody, settingsBody, sessionsBody] =
            await Promise.all([
              apiGet('/stats'),
              apiGet('/activity', { days: 7 }),
              apiGet('/diary', { limit: 1 }),
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
          setLatest((diaryBody.items ?? [])[0] ?? null)
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
          h('div', { className: 'dm-title' }, '对话记忆'),
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
        // The session-scoped slot hands the component a `sessionId` prop, so one
        // registration serves every conversation.
        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'deepmemory-flags', order: 15 },
            HeaderFlags,
          ),
        )
        // A fresh id beside the shipped views: reusing one of their ids would
        // replace that cell instead of adding a tab. The label is a thunk so the
        // host re-reads it whenever the active locale changes.
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            { name: 'conversation.view', id: 'deepmemory', order: 35, label: () => '对话记忆' },
            ConversationMemory,
          ),
        )
      },
    }
  },
})
