// =============================================================
//  기기 안 캐시 (IndexedDB)
// =============================================================
//  서버에서 받은 목록을 기기에 두고 다음에는 바뀐 것만 받아오려면, 목록을
//  통째로 담아 둘 곳이 필요하다. localStorage 는 5MB 남짓이라 그림이 가득
//  찬 어항(2000마리 × 그림)은 들어가지 않는다. IndexedDB 는 훨씬 넉넉하다.
//
//  시크릿 창·저장소 차단 등으로 IndexedDB 를 못 쓰면 이 탭 안의 메모리에만
//  둔다 — 캐시가 없어도 앱은 그대로 돌고, 서버를 조금 더 부를 뿐이다.
const DB_NAME = "manito-cache";
const STORE = "kv";
const mem = new Map();

let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

export async function cacheGet(key) {
  if (mem.has(key)) return mem.get(key);
  const v = await run("readonly", (s) => s.get(key));
  if (v !== undefined) mem.set(key, v);
  return v ?? null;
}

export function cacheSet(key, value) {
  mem.set(key, value);
  return run("readwrite", (s) => s.put(value, key));
}

export function cacheDel(key) {
  mem.delete(key);
  return run("readwrite", (s) => s.delete(key));
}

/** 이름이 prefix 로 시작하는 캐시를 모두 지운다. */
export async function cacheClear(prefix) {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  const keys = (await run("readonly", (s) => s.getAllKeys())) || [];
  await Promise.all(keys.filter((k) => String(k).startsWith(prefix)).map((k) => cacheDel(k)));
}
