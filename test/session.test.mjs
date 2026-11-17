import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionIdOf } from '../lib/index.js'

// The execution context hands a tool `{ callId, name, arguments, agent?, toolSet?,
// signal }` — never a `session`. Everything that needs the calling session goes
// through `sessionIdOf`, so these cases are the contract every guarded tool and
// every stored record depends on.

test('the session comes from the agent, which is where the executor puts it', () => {
  assert.equal(sessionIdOf({ agent: { session: { id: 'session-abc' } } }), 'session-abc')
})

test('agent.id answers when the session object is not reachable', () => {
  // The registry refuses an agent whose id differs from its session id, so this
  // fallback cannot disagree with the primary path.
  assert.equal(sessionIdOf({ agent: { id: 'session-abc' } }), 'session-abc')
})

test('a standalone service call has no session, and says so with an empty string', () => {
  assert.equal(sessionIdOf(undefined), '')
  assert.equal(sessionIdOf({}), '')
  assert.equal(sessionIdOf({ agent: undefined }), '')
  assert.equal(sessionIdOf({ agent: {} }), '')
})

test('the old exec.session shape is not silently accepted', () => {
  // This is the bug that made memory_forget answer 没有会话上下文 on every call:
  // the field simply is not there, and reading it quietly produced nothing.
  assert.equal(sessionIdOf({ session: { id: 'session-abc' } }), '')
})

test('a nullish id normalises to one empty string, never to "null"', () => {
  assert.equal(sessionIdOf({ agent: { session: { id: null } } }), '')
  assert.equal(sessionIdOf({ agent: { session: { id: undefined } } }), '')
})
