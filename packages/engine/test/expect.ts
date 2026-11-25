import assert from "node:assert/strict";

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesSubset(actual: unknown, expected: unknown): boolean {
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.keys(expected).every((key) => matchesSubset(actual[key], expected[key]));
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, index) => matchesSubset(actual[index], item));
  }
  return Object.is(actual, expected);
}

/**
 * vitest 風の最小 expect。依存を増やさず node:test と組み合わせるためのもの。
 */
export function expect(actual: unknown) {
  const api = {
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepStrictEqual(actual, expected);
    },
    toMatchObject(expected: unknown) {
      assert.ok(
        matchesSubset(actual, expected),
        `expected ${JSON.stringify(actual)} to match ${JSON.stringify(expected)}`,
      );
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
    toBeGreaterThanOrEqual(expected: number) {
      assert.ok(
        typeof actual === "number" && actual >= expected,
        `expected ${String(actual)} >= ${expected}`,
      );
    },
    toBeLessThanOrEqual(expected: number) {
      assert.ok(
        typeof actual === "number" && actual <= expected,
        `expected ${String(actual)} <= ${expected}`,
      );
    },
    toContain(item: unknown) {
      assert.ok(
        Array.isArray(actual) && actual.includes(item),
        `expected array to contain ${JSON.stringify(item)}`,
      );
    },
    toHaveLength(length: number) {
      assert.ok(Array.isArray(actual), "expected an array");
      assert.strictEqual(actual.length, length);
    },
    toThrow(errorClass?: new (...args: never[]) => Error) {
      const fn = actual as () => unknown;
      if (errorClass) assert.throws(fn, errorClass);
      else assert.throws(fn);
    },
  };

  return {
    ...api,
    not: {
      toBe(expected: unknown) {
        assert.notStrictEqual(actual, expected);
      },
      toBeNull() {
        assert.notStrictEqual(actual, null);
      },
      toThrow(errorClass?: new (...args: never[]) => Error) {
        const fn = actual as () => unknown;
        if (errorClass) assert.doesNotThrow(fn, errorClass);
        else assert.doesNotThrow(fn);
      },
    },
  };
}
