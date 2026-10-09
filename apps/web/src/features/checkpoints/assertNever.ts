/** Compile-time exhaustiveness for a `switch`: adding a case to the union makes the call site fail to typecheck. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}
