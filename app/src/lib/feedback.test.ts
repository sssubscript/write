import { describe, expect, it } from "vitest";
import { feedbackRedirectUrl } from "./feedback";

describe("feedback redirect", () => {
  it("resolves relative redirects against the Subscript homepage", () => {
    expect(
      feedbackRedirectUrl(
        "/scripts/42/feedback?x=1",
        "https://subscript.to",
        "https://write.subscript.to",
      ),
    ).toBe("https://subscript.to/scripts/42/feedback?x=1");
  });

  it("moves redirects built from the editor host onto the Subscript homepage", () => {
    expect(
      feedbackRedirectUrl(
        "https://write.subscript.to/scripts/42/feedback#top",
        "https://subscript.to",
        "https://write.subscript.to",
      ),
    ).toBe("https://subscript.to/scripts/42/feedback#top");
  });

  it("keeps redirects that already point at another origin", () => {
    expect(
      feedbackRedirectUrl(
        "https://subscript.to/scripts/42",
        "https://subscript.to",
        "https://write.subscript.to",
      ),
    ).toBe("https://subscript.to/scripts/42");
    expect(
      feedbackRedirectUrl(
        "https://auth.example.com/login",
        "https://subscript.to",
        "https://write.subscript.to",
      ),
    ).toBe("https://auth.example.com/login");
  });

  it("leaves redirects alone when the editor is embedded on the homepage", () => {
    expect(feedbackRedirectUrl("/scripts/42", "https://subscript.to", "https://subscript.to")).toBe(
      "https://subscript.to/scripts/42",
    );
  });
});
