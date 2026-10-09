/** Join class names, skipping falsy parts (CSS Modules class lists). */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
