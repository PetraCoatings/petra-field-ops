import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

describe("translations", () => {
  it("English and Spanish have exactly the same keys", () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
  });

  it("no translation is empty", () => {
    const get = (o: unknown, path: string) =>
      path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o);
    for (const k of keys(en)) {
      expect(String(get(en, k)).trim(), `en.${k}`).not.toBe("");
      expect(String(get(es, k)).trim(), `es.${k}`).not.toBe("");
    }
  });

  it("placeholders like {name} match between languages", () => {
    const get = (o: unknown, path: string) =>
      path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o);
    for (const k of keys(en)) {
      expect(placeholders(String(get(es, k))), k).toEqual(placeholders(String(get(en, k))));
    }
  });
});
