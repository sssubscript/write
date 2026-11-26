import { forceCloseDatabase } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ResilientIndexeddbPersistence } from "./persistence";

const openSynced = async (name: string) => {
  const doc = new Y.Doc();
  const persistence = new ResilientIndexeddbPersistence(name, doc);
  await persistence.whenSynced;
  return { doc, persistence };
};

const storedText = async (name: string) => {
  const { doc, persistence } = await openSynced(name);
  try {
    return doc.getText("script").toString();
  } finally {
    await persistence.destroy();
    doc.destroy();
  }
};

describe("ResilientIndexeddbPersistence", () => {
  it("reopens a connection the browser closed and keeps edits made while it was closed", async () => {
    const name = `closed-connection-${crypto.randomUUID()}`;
    const { doc, persistence } = await openSynced(name);
    doc.getText("script").insert(0, "FADE IN:");

    // Safari closes IndexedDB connections behind the app's back; the next edit used to throw
    // "InvalidStateError: The database connection is closing" from the Yjs update handler.
    persistence.db?.close();
    expect(() => doc.getText("script").insert(8, " INT. HOUSE")).not.toThrow();
    expect(() => doc.getText("script").insert(19, " - DAY")).not.toThrow();
    await persistence.whenConnected();

    doc.getText("script").insert(25, ".");
    await persistence.destroy();
    doc.destroy();

    expect(await storedText(name)).toBe("FADE IN: INT. HOUSE - DAY.");
  });

  it("reconnects when the database reports an unexpected close", async () => {
    const name = `close-event-${crypto.randomUUID()}`;
    const { doc, persistence } = await openSynced(name);
    const original = persistence.db;

    // Simulates the browser closing the connection abnormally, which fires a "close" event.
    if (original)
      forceCloseDatabase(original as unknown as Parameters<typeof forceCloseDatabase>[0]);
    await vi.waitFor(() => {
      expect(persistence.db).not.toBe(original);
      expect(persistence.db).not.toBeNull();
    });

    doc.getText("script").insert(0, "CUT TO:");
    await persistence.destroy();
    doc.destroy();

    expect(await storedText(name)).toBe("CUT TO:");
  });

  it("does not reconnect after being destroyed", async () => {
    const name = `destroyed-${crypto.randomUUID()}`;
    const { doc, persistence } = await openSynced(name);
    await persistence.destroy();

    expect(() => doc.getText("script").insert(0, "THE END")).not.toThrow();
    await persistence.whenConnected();
    expect(persistence.db?.name).toBe(name);
    doc.destroy();
  });
});
