import assert from 'node:assert/strict'
import test from 'node:test'
import { defineTool, compileSchemaSpec, compilePropertyMap } from '../lib/toolkit.js'

test('a param marked required lands in the object required list', () => {
  const tool = defineTool({
    name: 'demo',
    description: 'demo',
    parameters: {
      query: { type: 'string', required: true, description: 'q' },
      limit: { type: 'integer' },
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' } } }, render: () => [] },
    execute: async () => ({ ok: true }),
  })
  assert.deepEqual(tool.parameters, {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'q' },
      limit: { type: 'integer' },
    },
    required: ['query'],
  })
})

test('a definition without required omits the keyword entirely', () => {
  const tool = defineTool({
    name: 'demo',
    parameters: { a: { type: 'string' } },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => ({}),
  })
  assert.equal(Object.hasOwn(tool.parameters, 'required'), false)
})

test('array items compile recursively', () => {
  const schema = compileSchemaSpec({
    type: 'array',
    items: { type: 'string', enum: ['fact', 'episode'] },
  })
  assert.deepEqual(schema, { type: 'array', items: { type: 'string', enum: ['fact', 'episode'] } })
})

test('nested object properties hoist their own required list', () => {
  const schema = compileSchemaSpec({
    type: 'object',
    properties: { day: { type: 'string', required: true }, text: { type: 'string' } },
  })
  assert.deepEqual(schema, {
    type: 'object',
    properties: { day: { type: 'string' }, text: { type: 'string' } },
    required: ['day'],
  })
})

test('additionalProperties passes through', () => {
  const map = compilePropertyMap({ a: { type: 'object', additionalProperties: true } })
  assert.equal(map.properties.a.additionalProperties, true)
})

test('unknown keywords are rejected rather than silently dropped', () => {
  assert.throws(() => compileSchemaSpec({ type: 'string', pattern: 'x' }), /not a supported keyword/)
})

test('unsupported types are rejected', () => {
  assert.throws(() => compileSchemaSpec({ type: 'date' }), /not a supported JSON Schema type/)
})

test('output.render and the schema survive compilation', () => {
  const render = () => [{ type: 'text', text: 'x' }]
  const tool = defineTool({
    name: 'demo',
    description: 'd',
    parameters: {},
    output: { schema: { type: 'object', properties: { hits: { type: 'array', items: { type: 'object' } } } }, render },
    execute: async () => ({ hits: [] }),
  })
  assert.equal(tool.output.render, render)
  assert.deepEqual(tool.output.schema.properties.hits.items, { type: 'object' })
  assert.deepEqual(tool.parameters, { type: 'object', properties: {} })
})

test('execute receives an object even when the caller passes nothing', async () => {
  const tool = defineTool({
    name: 'demo',
    parameters: {},
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async (args) => ({ seen: typeof args }),
  })
  assert.deepEqual(await tool.execute(undefined, {}), { seen: 'object' })
})
