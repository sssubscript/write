import { afterEach, describe, expect, it } from "vitest";
import { defineCustomElement, mount } from "./embed";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
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
    mount(otherHost);
    await flush();
    expect(document.querySelectorAll("#subscript-write-styles")).toHaveLength(1);

    handle.unmount();
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
});
