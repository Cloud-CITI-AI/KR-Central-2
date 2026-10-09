export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

export class InvalidRangeError extends Error {
  constructor(readonly key: string) {
    super(`Range not satisfiable for object: ${key}`);
    this.name = "InvalidRangeError";
  }
}

/** S3 keys are 1 to 1024 UTF-8 bytes; both adapters enforce it so the fake fails where the real thing would. */
export function assertValidKey(key: string): void {
  const bytes = Buffer.byteLength(key);
  if (bytes < 1 || bytes > 1024) throw new RangeError("Object key must be 1 to 1024 bytes long");
}
