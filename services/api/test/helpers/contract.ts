/** Validate real responses against the generated packages/contracts/openapi.yaml (the `contract` test project). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const doc = parse(
  readFileSync(fileURLToPath(new URL("../../../../packages/contracts/openapi.yaml", import.meta.url)), "utf8"),
) as { paths: Record<string, Record<string, { operationId: string }>> };

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(doc, "openapi");

const pointer = (s: string) => s.replaceAll("~", "~0").replaceAll("/", "~1");

/** Returns the list of schema violations of `body` for (operationId, status, content type); [] when it conforms. */
export function contractViolations(
  operationId: string,
  status: number,
  body: unknown,
  contentType = "application/json",
): string[] {
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.operationId !== operationId) continue;
      const ref = `openapi#/paths/${pointer(path)}/${method}/responses/${status}/content/${pointer(contentType)}/schema`;
      const validate = ajv.getSchema(ref);
      if (!validate) return [`openapi.yaml declares no ${status} ${contentType} response for ${operationId}`];
      return validate(body) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`.trim());
    }
  }
  return [`unknown operation ${operationId}`];
}

/** Validate a value against a named component schema, e.g. schemaViolations("Problem", body). */
export function schemaViolations(name: string, value: unknown): string[] {
  const validate = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (!validate) return [`unknown schema ${name}`];
  return validate(value) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`.trim());
}
