import type { FieldKind } from "../../domain/field/field";
import type { SyncStatus } from "../../services/field/sync";
import type { FieldSnapshot } from "../../services/field/snapshot";

/**
 * The phone's memory (document 3, ch. 05): "une application fermée, un téléphone redémarré, une
 * batterie vide ne doivent rien perdre." Entries are written to IndexedDB before the screen says
 * they are saved; an IndexedDB transaction that completed survives all three. Browser only.
 */

const DB_NAME = "bvu-terrain";
const DB_VERSION = 1;

export type LocalStatus = "EN_ATTENTE" | SyncStatus;

export interface QueuedOp {
  opId: string;
  deviceId: string;
  seq: number;
  authorId: string;
  kind: FieldKind;
  lotId: string | null;
  transferId: string | null;
  capturedAt: string;
  payload: Record<string, unknown>;
  /** What the person entered, in words, for the list of entries on the phone. */
  summary: string;
  status: LocalStatus;
  message: string | null;
  sentAt: string | null;
}

/** Still to be sent by this person: never sent, or the server asked to try again. */
export function isPending(op: QueuedOp): boolean {
  return op.status === "EN_ATTENTE" || op.status === "A_REESSAYER" || op.status === "AUTRE_COMPTE";
}

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("ops")) db.createObjectStore("ops", { keyPath: "opId" }).createIndex("seq", "seq");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

/** Runs `work` in one transaction and resolves only once the browser has committed it. */
async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | Promise<T> | T): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    Promise.resolve(work(tx)).then((value) => {
      if (value instanceof IDBRequest) value.onsuccess = () => (result = value.result as T);
      else result = value as T;
    }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction annulée"));
  });
}

export const fieldStore = {
  getMeta<T>(key: string): Promise<T | undefined> {
    return transaction(["meta"], "readonly", (tx) => tx.objectStore("meta").get(key) as IDBRequest<T | undefined>);
  },

  setMeta(key: string, value: unknown): Promise<IDBValidKey> {
    return transaction(["meta"], "readwrite", (tx) => tx.objectStore("meta").put(value, key));
  },

  /** This phone's identity, drawn once and kept with the queue it numbers. */
  async deviceId(): Promise<string> {
    const existing = await this.getMeta<string>("deviceId");
    if (existing) return existing;
    const created = `tel-${crypto.randomUUID()}`;
    await this.setMeta("deviceId", created);
    return created;
  },

  /**
   * Draws the next sequence number and stores the entry in the same transaction: a number is never
   * handed out without its entry, nor twice.
   */
  enqueue(entry: Omit<QueuedOp, "seq">): Promise<QueuedOp> {
    return transaction(["meta", "ops"], "readwrite", (tx) => {
      return new Promise<QueuedOp>((resolve, reject) => {
        const meta = tx.objectStore("meta");
        const read = meta.get("seq");
        read.onsuccess = () => {
          const seq = (typeof read.result === "number" ? read.result : 0) + 1;
          meta.put(seq, "seq");
          const op: QueuedOp = { ...entry, seq };
          tx.objectStore("ops").put(op);
          resolve(op);
        };
        read.onerror = () => reject(read.error);
      });
    });
  },

  updateOp(opId: string, patch: Partial<QueuedOp>): Promise<void> {
    return transaction(["ops"], "readwrite", (tx) => {
      return new Promise<void>((resolve, reject) => {
        const store = tx.objectStore("ops");
        const read = store.get(opId);
        read.onsuccess = () => {
          if (read.result) store.put({ ...read.result, ...patch });
          resolve();
        };
        read.onerror = () => reject(read.error);
      });
    });
  },

  /** Every entry this phone holds, in the order they were made. */
  allOps(): Promise<QueuedOp[]> {
    return transaction(["ops"], "readonly", (tx) => tx.objectStore("ops").index("seq").getAll() as IDBRequest<QueuedOp[]>);
  },

  saveSnapshot(snapshot: FieldSnapshot): Promise<IDBValidKey> {
    return this.setMeta("snapshot", snapshot);
  },

  snapshot(): Promise<FieldSnapshot | undefined> {
    return this.getMeta<FieldSnapshot>("snapshot");
  },
};

/** Asks the browser not to evict this storage under pressure. Best effort: some browsers decide alone. */
export async function askForDurableStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
