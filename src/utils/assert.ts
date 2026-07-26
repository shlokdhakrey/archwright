/** Internal invariant guard. A thrown assertion denotes a bug, not bad input. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}

/** Narrow away `null | undefined`, throwing if the value is absent. */
export function assertDefined<T>(value: T, message: string): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected a value: ${message}`);
  }
  return value;
}
