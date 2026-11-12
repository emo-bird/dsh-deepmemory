import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemorySettings, GLOBAL_DEFAULTS, sanitizeFlags } from '../lib/settings.js'

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepmemory-settings-'))
  return { path: join(dir, 'settings.json'), dir }
}

test('missing file reads as the built-in defaults', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  assert.deepEqual(settings.globalFlags(), GLOBAL_DEFAULTS)
  // A preset nobody configured, and a session whose preset is unknown, both fall
  // through to the bottom of the stack.
  assert.deepEqual(settings.presetFlags('standard'), GLOBAL_DEFAULTS)
  assert.deepEqual(settings.sessionFlags('nobody', 'standard'), GLOBAL_DEFAULTS)
})

test('a preset default applies to every conversation born under it', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setPresetFlags('standard', 'session', { write: false })
  assert.deepEqual(settings.presetFlags('standard'), { recall: true, write: false, diary: true, forget: false })
  // Another preset is untouched: there is no process-wide row any more.
  assert.deepEqual(settings.presetFlags('minimal'), GLOBAL_DEFAULTS)
  assert.equal(settings.sessionFlags('s1', 'standard').write, false)
  assert.equal(settings.sessionFlags('s2', 'minimal').write, true)
})

test('a session override beats its preset default', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setPresetFlags('standard', 'session', { write: false })
  settings.setFlags('session', 's1', { write: true, recall: false }, 'standard')
  assert.deepEqual(settings.sessionFlags('s1', 'standard'), { recall: false, write: true, diary: true, forget: false })
  // Its sibling in the same preset still gets the preset value.
  assert.equal(settings.sessionFlags('s2', 'standard').write, false)
})

test('editing a preset never moves a session that was already pinned', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setPresetFlags('standard', 'session', { write: false })
  assert.equal(settings.pinSession('s1', { presetId: 'standard' }), true)
  // The whole point of the design: later preset edits are future defaults.
  settings.setPresetFlags('standard', 'session', { write: true })
  assert.equal(settings.sessionFlags('s1', 'standard').write, false)
  assert.equal(settings.sessionFlags('s2', 'standard').write, true)
})

test('a value equal to the parent is pruned instead of stored', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('session', 's1', { recall: false })
  settings.setFlags('session', 's1', { recall: true })
  // Equal to the parent again: the key survives holding null, because a deleted
  // key is indistinguishable from "never seen" and would be pinned afresh.
  assert.equal(settings.state.sessions.s1, null)
  assert.equal(settings.sessionFlags('s1').recall, true)
  assert.equal('s1' in settings.snapshot().overrides.sessions, false)
  assert.equal(settings.pinSession('s1'), false)
})

test('restoring inheritance sticks across repeated pins', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.pinSession('s1')
  settings.setFlags('session', 's1', { diary: false })
  settings.clearSession('s1')
  assert.equal(settings.state.sessions.s1, null)
  // A listing that pins again must not undo the restore.
  assert.equal(settings.pinSession('s1'), false)
  assert.equal(settings.sessionFlags('s1').diary, true)
})

test('subagents follow their parent session until they are overridden', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.pinSession('s1')
  settings.setFlags('session', 's1', { write: false })
  assert.equal(settings.subagentFlags('s1').write, false)
  settings.setFlags('subagent', 's1', { write: true })
  assert.equal(settings.subagentFlags('s1').write, true)
  // The parent's own policy is untouched by its subagent layer.
  assert.equal(settings.sessionFlags('s1').write, false)
})

test('a preset can also set what its subagents start with', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setPresetFlags('standard', 'session', { write: false })
  settings.setPresetFlags('standard', 'subagent', { forget: true })
  // The child layer sits on top of the session layer, not beside it.
  assert.deepEqual(settings.presetSubagentFlags('standard'), {
    recall: true,
    write: false,
    diary: true,
    forget: true,
  })
  // And a child session inherits that layer.
  assert.equal(settings.subagentFlags('s9', 'standard').forget, true)
  assert.equal(settings.sessionFlags('s9', 'standard').forget, false)
})

test('a preset entry disappears once it agrees with the built-in defaults', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setPresetFlags('standard', 'session', { write: false })
  assert.deepEqual(Object.keys(settings.state.presets), ['standard'])
  settings.setPresetFlags('standard', 'session', { write: true })
  assert.deepEqual(Object.keys(settings.state.presets), [])
})

test('snapshot reports every layer', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setPresetFlags('standard', 'session', { diary: false })
  settings.setFlags('session', 's1', { recall: false }, 'standard')
  const snap = settings.snapshot()
  assert.deepEqual(snap.defaults, GLOBAL_DEFAULTS)
  assert.equal(snap.presets.standard.flags.diary, false)
  assert.equal(snap.presets.standard.subagent.diary, false)
  assert.equal(snap.sessions.s1.recall, false)
  assert.deepEqual(Object.keys(snap.overrides).sort(), ['sessions', 'subagents'])
  // The backfill switch is gone: nothing per-delivery decides gaps any more.
  assert.equal('backfill' in snap, false)
})

test('file round-trips through disk', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setPresetFlags('standard', 'session', { write: false })
  settings.setFlags('session', 's1', { diary: false }, 'standard')
  const reread = new MemorySettings(path)
  assert.equal(reread.presetFlags('standard').write, false)
  assert.equal(reread.sessionFlags('s1', 'standard').diary, false)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(raw.version, 2)
  assert.deepEqual(raw.presets.standard, { flags: { write: false }, subagent: {} })
})

test('the diary persona and model round-trip', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  assert.deepEqual(settings.diaryConfig(), { persona: '', provider: '', model: '' })
  settings.setDiaryConfig({ persona: '你是一个只写日记的人。', provider: ' deepseek ', model: 'deepseek-chat' })
  const reread = new MemorySettings(path)
  assert.deepEqual(reread.diaryConfig(), { persona: '你是一个只写日记的人。', provider: 'deepseek', model: 'deepseek-chat' })
})

test('the backfill switch is gone and a legacy file cannot bring it back', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  assert.equal('setBackfill' in settings, false)
  assert.equal('backfillEnabled' in settings, false)
  // A settings file written by the previous build carried the switch; it is
  // ignored rather than honoured, because gaps are the panel's business now.
  writeFileSync(path, JSON.stringify({ version: 2, presets: {}, sessions: {}, subagents: {}, backfill: false }), 'utf8')
  const reread = new MemorySettings(path)
  assert.equal('backfill' in reread.state, false)
  assert.equal('backfill' in reread.snapshot(), false)
})

test('corrupt file falls back to defaults rather than throwing', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.save()
  writeFileSync(path, '{not json', 'utf8')
  const reread = new MemorySettings(path)
  assert.deepEqual(reread.globalFlags(), GLOBAL_DEFAULTS)
  assert.deepEqual(reread.state.presets, {})
})

test('a version-1 file keeps its sessions and gains empty preset layers', () => {
  const { path } = fresh()
  writeFileSync(path, JSON.stringify({ version: 1, global: { write: false }, sessions: { s1: { recall: false } } }), 'utf8')
  const settings = new MemorySettings(path)
  // The old process-wide row is gone by design; it is not migrated into a preset.
  assert.deepEqual(settings.state.presets, {})
  assert.equal(settings.sessionFlags('s1').recall, false)
})

test('sanitizeFlags drops unknown keys and keeps booleans', () => {
  assert.deepEqual(sanitizeFlags({ recall: false, nonsense: 1 }), {
    recall: false,
    write: true,
    diary: true,
    forget: false,
  })
  assert.deepEqual(sanitizeFlags(null), GLOBAL_DEFAULTS)
})