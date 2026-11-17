import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guidanceText, recallNudgeText } from '../lib/index.js'

const OFF = { recall: false, write: false, diary: false, forget: false }

test('no flags renders every bullet, for the docs and the panel preview', () => {
  const text = guidanceText()
  for (const name of ['memory_search', 'memory_save', 'memory_recall', 'diary_read', 'memory_forget']) {
    assert.match(text, new RegExp(`\`${name}\``), `${name} should appear in the default text`)
  }
  assert.match(text, /^# 记忆\n/)
})

test('with reading off, nothing tells the model to search', () => {
  const text = guidanceText({ ...OFF, write: true })
  assert.doesNotMatch(text, /memory_search/)
  assert.doesNotMatch(text, /memory_recall/)
  assert.doesNotMatch(text, /diary_read/)
  // Writing is still on, so its bullets survive.
  assert.match(text, /memory_save/)
})

test('with writing off, nothing tells the model to save', () => {
  const text = guidanceText({ ...OFF, recall: true })
  assert.doesNotMatch(text, /memory_save/)
  assert.match(text, /memory_search/)
})

test('the forget bullet follows its own switch', () => {
  assert.doesNotMatch(guidanceText({ ...OFF, recall: true }), /memory_forget/)
  assert.match(guidanceText({ ...OFF, forget: true, recall: true }), /memory_forget/)
})

test('every switch off yields an empty block, not a bare heading', () => {
  // An empty string is dropped by the prompt loop; a lone "# 记忆" would still
  // tell the model that a memory exists and that something is being withheld.
  assert.equal(guidanceText(OFF), '')
})

test('the data-not-instructions warning tracks read and write', () => {
  assert.match(guidanceText({ ...OFF, recall: true }), /属于数据|当作\*\*数据\*\*/)
  assert.match(guidanceText({ ...OFF, write: true }), /当作\*\*数据\*\*/)
  assert.doesNotMatch(guidanceText({ ...OFF, forget: true }), /当作\*\*数据\*\*/)
})

test('the recall nudge exists independently of the switch', () => {
  // The nudge is a one-line reminder shown only while reading is allowed; the
  // caller decides that, so the text itself is unconditional.
  assert.match(recallNudgeText(), /memory_search|memory_recall/)
})
