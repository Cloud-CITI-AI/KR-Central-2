/**
 * Minimal JSON Schema validator (no dependencies: the deploy scripts run on a bare Node 24 in CI). It supports exactly
 * the keywords service.schema.json uses and throws on any other keyword, so a schema edit can never be silently
 * ignored (fail closed).
 */
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const KEYWORDS = new Set([
  ...ANNOTATIONS,
  "type",
  "enum",
  "const",
  "pattern",
  "minLength",
  "minimum",
  "maximum",
  "required",
  "additionalProperties",
  "properties",
  "items",
]);

const typeOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
};

const matchesType = (value, type) => typeOf(value) === type || (type === "number" && typeof value === "number");

/** Returns the list of violations (empty when valid), each as "<json path>: <problem>". */
export function validate(schema, value, path = "$") {
  const errors = [];
  for (const keyword of Object.keys(schema)) {
    if (!KEYWORDS.has(keyword)) throw new Error(`json-schema: unsupported keyword "${keyword}" at ${path}`);
  }
  if (schema.type !== undefined) {
    const types = [schema.type].flat();
    if (!types.some((type) => matchesType(value, type))) {
      return [`${path}: expected ${types.join(" or ")}, got ${typeOf(value)}`];
    }
  }
  if (schema.const !== undefined && value !== schema.const)
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value))
      errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => errors.push(...validate(schema.items, item, `${path}[${index}]`)));
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema !== undefined) errors.push(...validate(childSchema, child, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown property "${key}"`);
    }
  }
  return errors;
}
