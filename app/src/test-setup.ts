import { webcrypto } from "node:crypto";
import "fake-indexeddb/auto";

Object.defineProperty(globalThis, "crypto", { value: webcrypto });

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as MediaQueryList;
}
