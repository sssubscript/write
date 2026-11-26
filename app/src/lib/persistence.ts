import { IndexeddbPersistence, PREFERRED_TRIM_SIZE, storeState } from "y-indexeddb";
import type * as Y from "yjs";

const updatesStoreName = "updates";

const isClosingConnectionError = (error: unknown) =>
  error instanceof DOMException && error.name === "InvalidStateError";

const openDatabase = (name: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(updatesStoreName, { autoIncrement: true });
      request.result.createObjectStore("custom");
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
  });

/**
 * y-indexeddb keeps one IDBDatabase handle for the life of the document and writes every update
 * to it synchronously from the Yjs update handler. Browsers can close that connection on their
 * own (Safari does when an in-app browser or tab is backgrounded), after which every edit threw
 * "InvalidStateError: The database connection is closing" out of the editor. This persistence
 * reopens the database instead and stores the full document state once it is back, so updates
 * made while the connection was gone are not lost.
 */
export class ResilientIndexeddbPersistence extends IndexeddbPersistence {
  private reconnecting: Promise<void> | null = null;
  private connectionLost = false;

  constructor(name: string, doc: Y.Doc) {
    super(name, doc);
    doc.off("update", this._storeUpdate);
    this._storeUpdate = this.storeUpdate;
    doc.on("update", this._storeUpdate);
    this._db.then(
      (database) => this.watch(database),
      () => undefined,
    );
  }

  /** Resolves once any in-flight reconnection has finished. */
  whenConnected() {
    return this.reconnecting ?? Promise.resolve();
  }

  private watch(database: IDBDatabase) {
    database.addEventListener("close", () => {
      if (this.db === database) this.reconnect();
    });
  }

  private storeUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this._destroyed) return;
    const database = this.db;
    if (!database) {
      if (this.connectionLost) this.reconnect();
      return;
    }
    try {
      database
        .transaction([updatesStoreName], "readwrite")
        .objectStore(updatesStoreName)
        .add(update);
    } catch (error) {
      if (!isClosingConnectionError(error)) throw error;
      this.reconnect();
      return;
    }
    if (++this._dbsize >= PREFERRED_TRIM_SIZE) {
      if (this._storeTimeoutId !== null) clearTimeout(this._storeTimeoutId);
      this._storeTimeoutId = setTimeout(() => {
        this._storeTimeoutId = null;
        this.storeFullState(false);
      }, this._storeTimeout);
    }
  };

  private storeFullState(forceStore: boolean) {
    try {
      void storeState(this, forceStore);
    } catch (error) {
      if (!isClosingConnectionError(error)) throw error;
      this.reconnect();
    }
  }

  private reconnect() {
    if (this.reconnecting || this._destroyed) return;
    this.db = null;
    this.connectionLost = true;
    this.reconnecting = openDatabase(this.name)
      .then((database) => {
        if (this._destroyed) {
          database.close();
          return;
        }
        this._db = Promise.resolve(database);
        this.db = database;
        this.connectionLost = false;
        this.watch(database);
        this.storeFullState(true);
      })
      .catch(() => undefined)
      .finally(() => {
        this.reconnecting = null;
      });
  }
}
