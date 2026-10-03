import { describe, expect, it } from "vitest";
import { defaultConfig, mergeConfig, signalingUrls } from "./config";

describe("signaling configuration", () => {
  it("defaults to the reachable public y-webrtc relays", () => {
    expect(signalingUrls(defaultConfig.signalingUrl)).toEqual([
      "wss://y-webrtc-signaling.fly.dev",
      "wss://y-webrtc.fly.dev",
    ]);
  });

  it("no longer defaults to the offline y-webrtc-eu relay", () => {
    expect(defaultConfig.signalingUrl).not.toContain("y-webrtc-eu.fly.dev");
  });

  it("splits comma-separated overrides and drops blanks", () => {
    const config = mergeConfig({ signalingUrl: " wss://a.example , ,wss://b.example " });
    expect(signalingUrls(config.signalingUrl)).toEqual(["wss://a.example", "wss://b.example"]);
  });
});
