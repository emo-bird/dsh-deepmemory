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
  // No session on record simply follows the global defaults.
  assert.deepEqual(settings.sessionFlags('nobody'), GLOBAL_DEFAULTS)
})

test('a session override beats the global default', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('global', undefined, { write: false })
  settings.setFlags('session', 's1', { write: true, recall: false })
  assert.deepEqual(settings.sessionFlags('s1'), { recall: false, write: true, diary: true, forget: false })
  assert.deepEqual(settings.sessionFlags('s2'), { recall: true, write: false, diary: true, forget: false })
})

test('editing the global defaults never moves an existing session', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('global', undefined, { write: false })
  assert.equal(settings.pinSession('s1'), true)
  // The whole point of the design: later edits are future defaults.
  settings.setFlags('global', undefined, { write: true })
  assert.equal(settings.sessionFlags('s1').write, false)
  assert.equal(settings.sessionFlags('s2').write, true)
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

test('subagents follow their parent session until pinned', () => {
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

test('snapshot reports both scopes without a preset layer', () => {
  const { path } = fresh()
  const settings = new MemorySettings(path)
  settings.setFlags('session', 's1', { diary: false })
  settings.setFlags('subagent', 's1', { recall: false })
  const snap = settings.snapshot()
  assert.equal('presets' in snap, false)
  assert.equal(snap.sessions.s1.diary, false)
  assert.equal(snap.subagents.s1.recall, false)
  assert.deepEqual(Object.keys(snap.overrides).sort(), ['sessions', 'subagents'])
})

test('file round-trips through disk', () => {
  const { path } = fresh()
  new MemorySettings(path).setFlags('session', 's1', { write: false })
  const reread = new MemorySettings(path)
  assert.equal(reread.sessionFlags('s1').write, false)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(raw.version, 1)
  assert.deepEqual(raw.sessions.s1, { write: false })
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
