import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AnalyticsBridge,
  createAnalytics,
  firstTouchFrom,
  persistFirstTouch,
} from "./analytics";

const bridge = () => ({ capture: vi.fn(), setPersonPropertiesOnce: vi.fn() });

beforeEach(() => localStorage.clear());
afterEach(() => {
  delete window.subscriptWriteAnalytics;
});

describe("analytics bridge", () => {
  it("is a silent no-op when no host bridge is injected", () => {
    const analytics = createAnalytics();
    expect(() => {
      analytics.track("document created");
      analytics.track("document exported", { format: "fdx" });
      persistFirstTouch("https://write.subscript.to/?utm_source=x", "");
      analytics.recordFirstTouch();
    }).not.toThrow();
  });

  it("forwards events to a bridge passed through config", () => {
    const injected = bridge();
    const analytics = createAnalytics(injected);
    analytics.track("document created");
    analytics.track("document opened", { shared: true });
    analytics.track("document exported", { format: "subscript" });
    analytics.track("feedback shared", { format: "fdx" });
    expect(injected.capture.mock.calls).toEqual([
      ["document created", {}],
      ["document opened", { shared: true }],
      ["document exported", { format: "subscript" }],
      ["feedback shared", { format: "fdx" }],
    ]);
  });

  it("finds a bridge the host injects on window after creation", () => {
    const analytics = createAnalytics();
    const injected = bridge();
    window.subscriptWriteAnalytics = injected;
    analytics.track("document created");
    expect(injected.capture).toHaveBeenCalledWith("document created", {});
  });

  it("drops properties outside each event's allowlist so content cannot leak", () => {
    const injected = bridge();
    const analytics = createAnalytics(injected);
    const leaky = { format: "fdx", title: "My Secret Script", fileName: "secret.fdx" };
    // @ts-expect-error extra properties are rejected by the type as well
    analytics.track("document exported", leaky);
    // @ts-expect-error unknown formats are rejected
    analytics.track("document exported", { format: "INT. KITCHEN - NIGHT" });
    expect(injected.capture.mock.calls).toEqual([
      ["document exported", { format: "fdx" }],
      ["document exported", {}],
    ]);
  });

  it("keeps the editor working when the host bridge throws", () => {
    const analytics = createAnalytics({
      capture: () => {
        throw new Error("host failure");
      },
      setPersonPropertiesOnce: () => {
        throw new Error("host failure");
      },
    } satisfies AnalyticsBridge);
    persistFirstTouch("https://write.subscript.to/", "");
    expect(() => {
      analytics.track("document created");
      analytics.recordFirstTouch();
    }).not.toThrow();
  });
});

describe("first-touch attribution", () => {
  it("reads UTM parameters, the referring domain, and the landing page without query or hash", () => {
    expect(
      firstTouchFrom(
        "https://write.subscript.to/draft?utm_source=newsletter&utm_medium=email&utm_campaign=fall&x=1#room=abc",
        "https://www.google.com/search?q=screenwriting",
      ),
    ).toEqual({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "fall",
      referring_domain: "www.google.com",
      landing_page: "https://write.subscript.to/draft",
    });
  });

  it("marks visits without a referrer as direct", () => {
    expect(firstTouchFrom("https://write.subscript.to/", "")).toEqual({
      referring_domain: "$direct",
      landing_page: "https://write.subscript.to/",
    });
  });

  it("does not overwrite first-touch values on later visits", () => {
    persistFirstTouch("https://write.subscript.to/?utm_source=first&utm_campaign=launch", "");
    persistFirstTouch(
      "https://write.subscript.to/?utm_source=second&utm_campaign=retarget",
      "https://ads.example.com/",
    );
    const injected = bridge();
    createAnalytics(injected).recordFirstTouch();
    expect(injected.setPersonPropertiesOnce).toHaveBeenCalledWith({
      utm_source: "first",
      utm_campaign: "launch",
      referring_domain: "$direct",
      landing_page: "https://write.subscript.to/",
    });
  });
});
