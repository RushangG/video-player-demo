// Stores uploaded video files (Blobs) in IndexedDB.
const DB_NAME = "secure-video-portal";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB."));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = action(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Storage failed (quota?)."));
      }),
  );
}

export function saveFile(id: string, file: Blob): Promise<void> {
  return run("readwrite", (s) => s.put(file, id)).then(() => undefined);
}

export async function getFile(id: string): Promise<Blob | null> {
  const result = await run<Blob | undefined>("readonly", (s) => s.get(id));
  return result ?? null;
}

export function deleteFile(id: string): Promise<void> {
  return run("readwrite", (s) => s.delete(id)).then(() => undefined);
}
