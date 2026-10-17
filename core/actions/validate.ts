/**
 * Checking what PM sends against an action's JSON Schema, before anything runs.
 *
 * PM is a model, so its arguments are untrusted input in the same way page code is: a wrong type,
 * a missing field or a field nobody asked for is refused with a sentence PM can correct from,
 * rather than passed on to see what happens. Only the part of JSON Schema the actions use is
 * understood (object, string, number, integer, boolean, array of those, `enum`, `required`,
 * `minLength`/`maxLength`, `minimum`/`maximum`, `minItems`/`maxItems`, `additionalProperties:
 * false`). A schema using anything else is a mistake in this folder, and says so.
 */

type Schema = Record<string, unknown>

const KNOWN = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description',
  'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'default',
])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** `null` when `value` fits `schema`, otherwise what is wrong, naming the field. */
export function validate(schema: Schema, value: unknown, where = 'arguments'): string | null {
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) return `schema for ${where} uses "${key}", which this checker does not understand`
  const type = schema.type
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) {
    return `${where} must be one of ${(schema.enum as unknown[]).map((each) => JSON.stringify(each)).join(', ')}`
  }
  switch (type) {
    case 'object': {
      if (!isRecord(value)) return `${where} must be an object`
      const properties = (schema.properties ?? {}) as Record<string, Schema>
      for (const name of (schema.required ?? []) as string[]) {
        if (value[name] === undefined) return `${where === 'arguments' ? '' : `${where}.`}${name} is required`
      }
      for (const [name, field] of Object.entries(value)) {
        const inner = properties[name]
        if (!inner) {
          if (schema.additionalProperties === false) return `${where === 'arguments' ? '' : `${where}.`}${name} is not a field this action takes`
          continue
        }
        if (field === undefined) continue
        const problem = validate(inner, field, where === 'arguments' ? name : `${where}.${name}`)
        if (problem) return problem
      }
      return null
    }
    case 'string': {
      if (typeof value !== 'string') return `${where} must be text`
      if (typeof schema.minLength === 'number' && value.trim().length < schema.minLength) return `${where} must not be empty`
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return `${where} must be at most ${schema.maxLength} characters`
      return null
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${where} must be a number`
      if (type === 'integer' && !Number.isInteger(value)) return `${where} must be a whole number`
      if (typeof schema.minimum === 'number' && value < schema.minimum) return `${where} must be at least ${schema.minimum}`
      if (typeof schema.maximum === 'number' && value > schema.maximum) return `${where} must be at most ${schema.maximum}`
      return null
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${where} must be true or false`
    case 'array': {
      if (!Array.isArray(value)) return `${where} must be a list`
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${where} needs at least ${schema.minItems} items`
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${where} takes at most ${schema.maxItems} items`
      const items = schema.items as Schema | undefined
      if (items) {
        for (let index = 0; index < value.length; index++) {
          const problem = validate(items, value[index], `${where}[${index}]`)
          if (problem) return problem
        }
      }
      return null
    }
    default:
      return `schema for ${where} has no type this checker understands`
  }
}
