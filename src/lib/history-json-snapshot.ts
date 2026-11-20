/**
 * Exact, bounded, order-independent JSON snapshots for at-rest migration.
 *
 * JSON.stringify alone silently drops undefined, functions, non-enumerable
 * fields and some browser objects. Never erase the sole legacy source on a
 * lossy conversion. Canonical ordering also avoids rejecting legitimate
 * messages just because IndexedDB and the decoder enumerate keys differently.
 */
const MAX_NESTING = 48;
const MAX_VALUES = 100_000;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function canonicalHistoryJson(value: unknown): string {
  const active = new WeakSet<object>();
  let visited = 0;

  const visit = (current: unknown, depth: number): unknown => {
    if (++visited > MAX_VALUES || depth > MAX_NESTING)
      throw new Error("History JSON exceeds safe structural limits");
    if (current === null || typeof current === "string" ||
        typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0))
        throw new Error("Nonportable history number");
      return current;
    }
    if (typeof current !== "object")
      throw new Error("Nonportable history value");
    const object = current as object;
    if (active.has(object)) throw new Error("Cyclic history value");
    const proto = Object.getPrototypeOf(object);
    if (Array.isArray(current)) {
      if (proto !== Array.prototype) throw new Error("Nonportable history array");
      const keys = Reflect.ownKeys(current);
      if (keys.length !== current.length + 1 ||
          current.length > MAX_VALUES || !keys.includes("length"))
        throw new Error("History array has hidden fields or gaps");
      active.add(object);
      try {
        const result: unknown[] = [];
        for (let i = 0; i < current.length; i++) {
          if (!Object.prototype.hasOwnProperty.call(current, i))
            throw new Error("Sparse history array");
          const descriptor = Object.getOwnPropertyDescriptor(current, String(i));
          if (!descriptor || !("value" in descriptor))
            throw new Error("History array accessor is not portable");
          result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      } finally { active.delete(object); }
    }
    if (proto !== Object.prototype && proto !== null)
      throw new Error("Nonportable history object");
    const keys = Reflect.ownKeys(object);
    if (keys.some((name) => typeof name !== "string"))
      throw new Error("History object has symbol properties");
    active.add(object);
    try {
      const result: Record<string, unknown> = Object.create(null);
      for (const name of (keys as string[]).sort()) {
        if (BAD_KEYS.has(name))
          throw new Error("Unsafe history property");
        const descriptor = Object.getOwnPropertyDescriptor(object, name);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          throw new Error("History object has hidden or computed fields");
        result[name] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally { active.delete(object); }
  };

  const json = JSON.stringify(visit(value, 0));
  if (typeof json !== "string") throw new Error("Cannot serialize history snapshot");
  return json;
}

export function sameHistoryJson(a: unknown, b: unknown): boolean {
  try {
    return canonicalHistoryJson(a) === canonicalHistoryJson(b);
  } catch {
    return false;
  }
}
