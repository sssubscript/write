import { afterEach, describe, expect, it, vi } from "vitest";
import { defineCustomElement, mount } from "./embed";
import type { DeviceIdentity } from "./lib/identity";
import { LocalProject } from "./lib/project";

// Track every identity load App starts so each test can wait for them to settle;
// otherwise they outlive the test and touch jsdom globals after teardown.
const identityLoads = vi.hoisted(() => ({
  pending: new Set<Promise<unknown>>(),
  override: null as (() => Promise<DeviceIdentity>) | null,
}));

vi.mock("./lib/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/identity")>();
  return {
    ...actual,
    loadIdentity: (...args: Parameters<typeof actual.loadIdentity>) => {
      const load = identityLoads.override?.() ?? actual.loadIdentity(...args);
      identityLoads.pending.add(load);
      return load;
    },
  };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
  await Promise.allSettled(identityLoads.pending);
  identityLoads.pending.clear();
  identityLoads.override = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.getElementById("subscript-write-styles")?.remove();
});

describe("embeddable library entry", () => {
  it("mounts into a host element and injects scoped styles once", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const handle = mount(host, { homepage: "https://example.com" });
    await flush();

    expect(host.querySelector(".subscript-write")).not.toBeNull();
    expect(document.getElementById("subscript-write-styles")).not.toBeNull();

    const otherHost = document.createElement("div");
    document.body.append(otherHost);
    const otherHandle = mount(otherHost);
    await flush();
    expect(document.querySelectorAll("#subscript-write-styles")).toHaveLength(1);

    handle.unmount();
    otherHandle.unmount();
    expect(host.querySelector(".subscript-write")).toBeNull();
  });

  it("registers a <subscript-write> custom element that mounts on connect", async () => {
    defineCustomElement();
    const element = document.createElement("subscript-write");
    document.body.append(element);
    await flush();

    expect(element.querySelector(".subscript-write")).not.toBeNull();

    element.remove();
    expect(element.querySelector(".subscript-write")).toBeNull();
  });

  it("ignores identity loading that settles after unmount", async () => {
    let failLoad: (error: Error) => void = () => undefined;
    identityLoads.override = () =>
      new Promise<DeviceIdentity>((_, reject) => {
        failLoad = reject;
      });
    const open = vi.spyOn(LocalProject, "open");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      const host = document.createElement("div");
      document.body.append(host);
      const handle = mount(host);
      await flush();
      handle.unmount();

      failLoad(new ReferenceError("localStorage is not defined"));
      await flush();

      expect(open).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
