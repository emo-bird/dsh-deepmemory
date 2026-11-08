/**
 * Local stand-in for `defineTool` from `@deepseek-ai/dsh-tools`.
 *
 * A linked bundle cannot resolve `@deepseek-ai/*`: those packages live inside
 * app.asar and are absent from the profile's node_modules, so
 * `import { defineTool } from '@deepseek-ai/dsh-tools'` fails the whole bundle
 * at import time. Every other DSH plugin talks to `ctx` services only, for
 * exactly this reason.
 *
 * What `defineTool` adds over a raw definition is small and entirely local: it
 * compiles the terse parameter DSL into JSON Schema. `ctx.tools.register()`
 * still enforces the real contract (a non-empty `output.render`, the supported
 * schema subset, the reserved `run_code` name), so this shim only has to emit a
 * well-formed definition.
 */

const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

/** Keywords the harness schema subset accepts. */
const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
])

/** Annotation keywords the harness schema subset accepts. */
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples'])

/**
 * Compile one terse schema node into the supported JSON Schema subset.
 * @param {object} spec terse node, e.g. `{ type: 'string', description: '…' }`
 * @param {string} path diagnostic path used in thrown messages
 * @returns {object} JSON Schema node
 */
export function compileSchemaSpec(spec, path = 'schema') {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`${path} must be a schema object`)
  }
  const out = {}
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'required') continue
    if (key === 'items') {
      out.items = compileSchemaSpec(value, `${path}.items`)
      continue
    }
    if (key === 'properties') {
      const compiled = compilePropertyMap(value, `${path}.properties`)
      out.properties = compiled.properties
      if (compiled.required !== undefined) out.required = compiled.required
      continue
    }
    if (key === 'oneOf') {
      if (!Array.isArray(value) || value.length < 2) throw new TypeError(`${path}.oneOf must hold at least two schemas`)
      out.oneOf = value.map((entry, index) => compileSchemaSpec(entry, `${path}.oneOf[${index}]`))
      continue
    }
    if (CONSTRAINT_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) {
      out[key] = value
      continue
    }
    throw new TypeError(`${path}.${key} is not a supported keyword`)
  }
  if (out.type !== undefined && !SCHEMA_TYPES.has(out.type)) {
    throw new TypeError(`${path}.type is not a supported JSON Schema type`)
  }
  return out
}

/**
 * Compile a terse property map, hoisting each `required: true` into the
 * parent object's `required` array.
 * @param {Record<string, object>} map property name → terse schema
 * @param {string} path diagnostic path
 * @returns {{properties: Record<string, object>, required?: string[]}}
 */
export function compilePropertyMap(map, path = 'parameters') {
  const properties = {}
  const required = []
  for (const [name, spec] of Object.entries(map ?? {})) {
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new TypeError(`${path}.${name} must be a schema object`)
    }
    const { required: isRequired, ...rest } = spec
    properties[name] = compileSchemaSpec(rest, `${path}.${name}`)
    if (isRequired === true) required.push(name)
  }
  return { properties, ...(required.length === 0 ? {} : { required }) }
}

/**
 * Build a registry-ready tool definition from the terse authoring shape.
 * @param {object} options name/description/parameters/output/execute (+ timeoutMs)
 * @returns {object} definition accepted by `ctx.tools.register()`
 */
export function defineTool(options) {
  const { parameters, output, execute, ...rest } = options
  if (output === undefined || typeof output !== 'object') throw new TypeError('defineTool() requires output')
  const compiled = compilePropertyMap(parameters ?? {})
  return {
    ...rest,
    parameters: {
      type: 'object',
      properties: compiled.properties,
      ...(compiled.required === undefined ? {} : { required: compiled.required }),
    },
    output: {
      schema: compileSchemaSpec(output.schema),
      render: output.render,
      ...(output.presentationMeta === undefined ? {} : { presentationMeta: output.presentationMeta }),
    },
    async execute(args, exec) {
      return await execute(args ?? {}, exec)
    },
  }
}
