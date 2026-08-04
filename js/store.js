/* ============================================================
   資料層 — IndexedDB 儲存、備份匯出/匯入、資料夾同步
   ============================================================ */

const DB_NAME = 'idea-puzzle';
const DB_VERSION = 1;

function uuid() {
  try { return crypto.randomUUID(); } catch (e) { /* 非安全環境 */ }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const stores = { fragments: 'id', blobs: 'id', outputs: 'id', meta: 'key' };
      for (const [name, key] of Object.entries(stores)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: key });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 在指定 store 上執行操作，並回傳 request 的 result */
async function withStore(name, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let req;
    try { req = fn(store); } catch (err) { reject(err); return; }
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ---------- 片段 ---------- */

async function getAllFragments() {
  const list = await withStore('fragments', 'readonly', (s) => s.getAll());
  return list || [];
}

async function addFragment(f) {
  await withStore('fragments', 'readwrite', (s) => s.put(f));
  return f;
}

async function updateFragment(f) {
  f.updatedAt = new Date().toISOString();
  await withStore('fragments', 'readwrite', (s) => s.put(f));
  return f;
}

async function deleteFragment(id) {
  const f = await getFragment(id);
  if (f) {
    const blobIds = [];
    if (f.blobIds) blobIds.push(...f.blobIds);
    if (f.audioBlobId) blobIds.push(f.audioBlobId);
    for (const bid of blobIds) await withStore('blobs', 'readwrite', (s) => s.delete(bid));
  }
  await withStore('fragments', 'readwrite', (s) => s.delete(id));
}

async function getFragment(id) {
  return withStore('fragments', 'readonly', (s) => s.get(id));
}

/* ---------- 附件 blob（圖片/音檔） ---------- */

async function putBlob(id, blob) {
  await withStore('blobs', 'readwrite', (s) => s.put({ id, blob }));
}

async function getBlob(id) {
  const row = await withStore('blobs', 'readonly', (s) => s.get(id));
  return row ? row.blob : null;
}

/* ---------- 成果 ---------- */

async function addOutput(o) {
  await withStore('outputs', 'readwrite', (s) => s.put(o));
  return o;
}

async function getAllOutputs() {
  const list = await withStore('outputs', 'readonly', (s) => s.getAll());
  return list || [];
}

async function getOutput(id) {
  return withStore('outputs', 'readonly', (s) => s.get(id));
}

async function deleteOutput(id) {
  await withStore('outputs', 'readwrite', (s) => s.delete(id));
}

/* ---------- 設定與中繼資料 ---------- */

async function getMeta(key) {
  const row = await withStore('meta', 'readonly', (s) => s.get(key));
  return row ? row.value : undefined;
}

async function setMeta(key, value) {
  await withStore('meta', 'readwrite', (s) => s.put({ key, value }));
}

async function getSettings() {
  const s = await getMeta('settings');
  return Object.assign({
    geminiKey: '', geminiModel: 'gemini-2.5-flash',
    groqKey: '', groqModel: 'whisper-large-v3-turbo',
    theme: 'dark',
  }, s || {});
}

async function saveSettings(s) {
  await setMeta('settings', s);
}

/* ---------- 備份：匯出 / 匯入 ---------- */

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

async function exportBundle() {
  const [fragments, outputs, settings] = await Promise.all([
    getAllFragments(), getAllOutputs(), getSettings(),
  ]);
  // 打包圖片 dataURL（語音音檔與大檔不打包，避免備份過大）
  const blobs = {};
  for (const f of fragments) {
    if (f.type === 'image' && f.blobIds && f.blobIds.length) {
      const b = await getBlob(f.blobIds[0]);
      if (b) blobs[f.id] = await blobToDataURL(b);
    }
  }
  const safeSettings = { ...settings };
  delete safeSettings.geminiKey;
  delete safeSettings.groqKey;
  return {
    app: 'idea-puzzle', version: 1, exportedAt: new Date().toISOString(),
    fragments, outputs, settings: safeSettings, blobs,
  };
}

async function importBundle(json) {
  if (!json || json.app !== 'idea-puzzle') throw new Error('不是有效的思想拼圖備份檔');
  const fragments = json.fragments || [];
  const outputs = json.outputs || [];
  for (const f of fragments) {
    await addFragment(f);
    if (json.blobs && json.blobs[f.id]) {
      const blob = dataURLToBlob(json.blobs[f.id]);
      if (blob && f.blobIds && f.blobIds.length) await putBlob(f.blobIds[0], blob);
    }
  }
  for (const o of outputs) await addOutput(o);
  return { fragments: fragments.length, outputs: outputs.length };
}

async function wipeAll() {
  const db = await openDB();
  await Promise.all(['fragments', 'blobs', 'outputs'].map((name) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    })
  ));
}

async function blobToDataUrlForImage(blob) {
  return blobToDataURL(blob);
}

/* ---------- 資料夾同步（File System Access API，Chrome/Edge） ---------- */

let folderHandle = null;

async function connectFolder() {
  if (!('showDirectoryPicker' in window)) throw new Error('此瀏覽器不支援 File System Access API，請改用 Chrome/Edge，或使用「匯出/匯入備份」。');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('未取得資料夾存取權限');
  folderHandle = handle;
  await setMeta('folder', { name: handle.name, at: new Date().toISOString() });
  return handle;
}

function getFolderHandle() {
  return folderHandle;
}

async function disconnectFolder() {
  folderHandle = null;
  await setMeta('folder', null);
}

async function getFolderMeta() {
  return getMeta('folder');
}

async function writeFolderFile(handle, path, text) {
  const parts = path.split('/');
  let dir = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/** 將目前所有資料同步為 Markdown / JSON 檔案到使用者選的資料夾 */
async function syncFolder(handle) {
  const [fragments, outputs] = await Promise.all([getAllFragments(), getAllOutputs()]);
  for (const f of fragments) {
    const head = `---\nid: ${f.id}\ntype: ${f.type}\ncreatedAt: ${f.createdAt}\ntags: ${(f.tags || []).join(',')}\n---\n\n`;
    await writeFolderFile(handle, `fragments/${f.id}.md`, head + (f.content || ''));
  }
  for (const o of outputs) {
    await writeFolderFile(handle, `outputs/${o.id}.md`,
      `# ${o.title || '成果'}\n\n> 型態：${o.typeLabel || o.type} ｜ ${o.createdAt}\n\n` + (o.content || ''));
  }
  await writeFolderFile(handle, 'index.json', JSON.stringify(await exportBundle(), null, 2));
  await setMeta('folder', { name: handle.name, at: new Date().toISOString() });
  return { fragments: fragments.length, outputs: outputs.length };
}

export {
  uuid, getAllFragments, addFragment, updateFragment, deleteFragment, getFragment,
  putBlob, getBlob, blobToDataUrlForImage,
  addOutput, getAllOutputs, getOutput, deleteOutput,
  getSettings, saveSettings,
  exportBundle, importBundle, wipeAll,
  connectFolder, getFolderHandle, disconnectFolder, getFolderMeta, syncFolder,
};
