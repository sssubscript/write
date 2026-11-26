import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "./embed";

// jsdom does not implement CSS.escape, which the editor uses to look up paragraphs by id.
globalThis.CSS ??= { escape: (value: string) => value.replace(/[^\w-]/g, "\\$&") } as typeof CSS;

const waitFor = async <T,>(read: () => T | null | undefined, timeout = 5000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const firstParagraph = (host: HTMLElement) =>
  host.querySelector<HTMLElement>(".paragraph-editor[data-paragraph-id]");

afterEach(() => {
  document.body.replaceChildren();
  document.getElementById("subscript-write-styles")?.remove();
});

describe("screenplay editing", () => {
  it("stores typed text in the shared document so it reaches collaborators", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const handle = mount(host);
    const paragraph = await waitFor(() => firstParagraph(host));
    const editable = paragraph.closest<HTMLElement>(".screenplay-editable")!;

    // Browsers dispatch input events to the contentEditable host, not the paragraph typed in.
    paragraph.textContent = "INT. KITCHEN - NIGHT";
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, paragraph.textContent.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    // Wait past the edit commit debounce, then reopen the draft from local storage.
    await new Promise((resolve) => setTimeout(resolve, 600));
    handle.unmount();
    const reopened = document.createElement("div");
    document.body.append(reopened);
    const reopenedHandle = mount(reopened);
    const texts = () =>
      [...reopened.querySelectorAll(".paragraph-editor[data-paragraph-id]")].map(
        (element) => element.textContent,
      );
    await waitFor(() => texts().length > 0 && texts());
    expect(texts()).toContain("INT. KITCHEN - NIGHT");
    reopenedHandle.unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, 15000);
});

describe("analytics bridge", () => {
  it("emits content-free lifecycle events to a host-injected bridge", async () => {
    // jsdom does not implement scrolling, which creating a script uses.
    Element.prototype.scrollTo ??= () => undefined;
    const capture = vi.fn();
    const setPersonPropertiesOnce = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const handle = mount(host, { analytics: { capture, setPersonPropertiesOnce } });
    await waitFor(() => firstParagraph(host));
    await waitFor(() => capture.mock.calls.length > 0);
    expect(capture).toHaveBeenCalledWith("document opened", { shared: false });
    expect(setPersonPropertiesOnce).toHaveBeenCalledWith(
      expect.objectContaining({ landing_page: expect.any(String) }),
    );

    host.querySelector<HTMLButtonElement>(".new-script-button")!.click();
    const titleInput = await waitFor(() =>
      document.querySelector<HTMLInputElement>("#new-script-title"),
    );
    titleInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor(() => capture.mock.calls.some(([event]) => event === "document created"));
    await waitFor(
      () => capture.mock.calls.filter(([event]) => event === "document opened").length > 1,
    );

    for (const [, properties] of capture.mock.calls) {
      expect(JSON.stringify(properties)).not.toMatch(/screenplay|untitled/i);
    }
    handle.unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, 15000);
});
