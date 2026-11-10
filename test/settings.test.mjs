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

test('missing file reads as global defaults', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  assert.deepEqual(settings.globalFlags(), GLOBAL_DEFAULTS)
  assert.deepEqual(settings.presetFlags('companion'), GLOBAL_DEFAULTS)
})

test('preset override inherits then diverges', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('preset', 'companion', { diary: false })
  assert.deepEqual(settings.presetFlags('companion'), { recall: true, write: true, diary: false, forget: false })
  assert.deepEqual(settings.presetFlags('feishu-bot'), GLOBAL_DEFAULTS)
})

test('session override beats preset which beats global', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('global', undefined, { write: false })
  settings.setFlags('preset', 'companion', { write: true, recall: false })
  settings.setFlags('session', 's1', { recall: true }, { presetId: 'companion' })
  assert.deepEqual(settings.sessionFlags('s1', 'companion'), { recall: true, write: true, diary: true, forget: false })
  assert.deepEqual(settings.sessionFlags('s2', 'companion'), { recall: false, write: true, diary: true, forget: false })
  assert.deepEqual(settings.sessionFlags('s2', 'other'), { recall: true, write: false, diary: true, forget: false })
})

test('a value equal to the parent is pruned instead of stored', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('preset', 'companion', { diary: false })
  settings.setFlags('preset', 'companion', { diary: true })
  assert.equal('companion' in settings.state.presets, false)
  settings.setFlags('session', 's1', { recall: false }, { presetId: 'companion' })
  settings.clearSession('s1')
  assert.equal('s1' in settings.state.sessions, false)
})

test('snapshot lists declared presets plus stored overrides', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('preset', 'hidden', { diary: false })
  const snap = settings.snapshot(['companion', 'feishu-bot'])
  assert.deepEqual(Object.keys(snap.presets).sort(), ['companion', 'feishu-bot', 'hidden'])
  assert.equal(snap.presets.hidden.diary, false)
})

test('file round-trips through disk', () => {
  const { path } = fresh()
  new MemorySettings(path).setFlags('preset', 'companion', { write: false })
  const reread = new MemorySettings(path)
  assert.equal(reread.presetFlags('companion').write, false)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(raw.version, 1)
  assert.deepEqual(raw.presets.companion, { write: false })
})

test('corrupt file falls back to defaults rather than throwing', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.save()
  writeFileSync(path, '{not json', 'utf8')
  const reread = new MemorySettings(path)
  assert.deepEqual(reread.globalFlags(), GLOBAL_DEFAULTS)
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

test('pinning a session freezes it against later preset edits', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('preset', 'companion', { write: false })
  assert.equal(settings.sessionFlags('s1', 'companion').write, false)
  assert.equal(settings.pinSession('s1', 'companion'), true)
  // Editing the preset afterwards must not move a session that already exists.
  settings.setFlags('preset', 'companion', { write: true })
  assert.equal(settings.sessionFlags('s1', 'companion').write, false)
  // A second pin is a no-op, so the promise holds.
  assert.equal(settings.pinSession('s1', 'companion'), false)
  // Clearing the session puts it back under the preset.
  settings.clearSession('s1')
  assert.equal(settings.sessionFlags('s1', 'companion').write, true)
})
