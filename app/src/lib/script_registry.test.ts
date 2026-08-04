import { beforeEach, describe, expect, it } from "vitest";
import { listScripts, saveScript } from "./script_registry";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

describe("script registry", () => {
  it("keeps separate scripts and moves the most recently saved script first", () => {
    saveScript({ id: "first", title: "First draft", updatedAt: "2026-08-01T00:00:00.000Z" });
    saveScript({ id: "second", title: "Second draft", updatedAt: "2026-08-02T00:00:00.000Z" });

    expect(listScripts().map((script) => script.id)).toEqual(["second", "first"]);
  });
});
