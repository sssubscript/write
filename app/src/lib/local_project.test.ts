import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config";
import { loadIdentity } from "./identity";
import { LocalProject } from "./project";

describe("LocalProject.open", () => {
  it("creates a single blank document when an empty project is opened twice concurrently", async () => {
    const identity = await loadIdentity(defaultConfig);
    const projectId = `concurrent-open-${crypto.randomUUID()}`;

    const opened = await Promise.all([
      LocalProject.open(identity, defaultConfig, projectId),
      LocalProject.open(identity, defaultConfig, projectId),
    ]);
    for (const project of opened) project.destroy();

    const reopened = await LocalProject.open(identity, defaultConfig, projectId);
    try {
      expect(reopened.snapshot().paragraphs).toHaveLength(1);
    } finally {
      reopened.destroy();
    }
  });
});
