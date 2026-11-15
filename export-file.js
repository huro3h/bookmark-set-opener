// エクスポートを、選んだフォルダの中の決まったファイルへの上書きにする(git で管理しているフォルダに置いて差分を見るため)。
//
// フォルダは初回に showDirectoryPicker で選び、そのハンドルを IndexedDB に覚えておく。ファイル名は設定画面の欄で決め、
// 同じ IndexedDB に覚える。IndexedDB はブラウザ・プロフィールごとに別なので、Chrome の stable と dev など、
// ブラウザごとに別のフォルダ・ファイル名にできる。
// ファイルではなくフォルダを選ぶのは、画面に「フォルダ名/ファイル名」を出すため(ファイルのハンドルからは
// ファイル名しか分からない。フォルダのハンドルもフォルダ名だけで、フルパスは分からない)。
// ファイル名の初期値にはブラウザの種類を付ける。stable と dev の違いは拡張機能からは分からない
// (どちらもブランドは「Google Chrome」)ので、必要なら欄で名前を足してもらう。
// showDirectoryPicker が無いブラウザ(Brave など)では、同じファイル名でダウンロードする。

const DB_NAME = "export-file";
const STORE = "handles";
const DIR_KEY = "exportDir";
const NAME_KEY = "fileName";
const OLD_FILE_KEY = "exportFile"; // 2.6.x で覚えていたファイルのハンドル。ファイル名の初期値にだけ使う
const BASE_NAME = "bookmark-set-opener";

export const canPickFolder = typeof window.showDirectoryPicker === "function";

// navigator.userAgentData のブランドから。分からなければ付けない
function browserSlug() {
  const brands = (navigator.userAgentData?.brands ?? []).map((b) => b.brand);
  if (brands.includes("Brave") || navigator.brave) return "brave";
  if (brands.includes("Microsoft Edge")) return "edge";
  if (brands.includes("Google Chrome")) return "chrome";
  return "";
}

function defaultFileName() {
  const slug = browserSlug();
  return `${BASE_NAME}${slug ? `-${slug}` : ""}.json`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function load(key) {
  try {
    return (await withStore("readonly", (store) => store.get(key))) ?? null;
  } catch {
    return null;
  }
}

const save = (key, value) => withStore("readwrite", (store) => store.put(value, key));

// 覚えている書き出し先のフォルダのハンドル。なければ null
export const loadExportDir = () => load(DIR_KEY);

// 書き出すファイル名。決めていなければ、2.6.x で選んでいたファイルの名前か、ブラウザの種類付きの初期値
export async function loadFileName() {
  return (await load(NAME_KEY)) ?? (await load(OLD_FILE_KEY))?.name ?? defaultFileName();
}

// 欄に入れられた名前を確かめて覚える。フォルダの外を指す名前は受け付けない。.json が無ければ足す。
// 覚えた名前を返す。使えない名前なら例外
export async function saveFileName(input) {
  let name = input.trim();
  if (!name || /[/\\:]/.test(name) || name.startsWith(".")) {
    throw new Error("ファイル名に / \\ : は使えません。先頭を . にもできません");
  }
  if (!name.toLowerCase().endsWith(".json")) name += ".json";
  await save(NAME_KEY, name);
  return name;
}

// フォルダを選ぶ。キャンセルなら null
async function pickDir(current) {
  try {
    const dir = await window.showDirectoryPicker({
      id: DB_NAME, // 前回選んだフォルダから開く
      mode: "readwrite",
      ...(current ? { startIn: current } : {}),
    });
    await save(DIR_KEY, dir);
    return dir;
  } catch (e) {
    if (e?.name === "AbortError") return null;
    throw e;
  }
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // すぐに破棄するとダウンロードが始まる前に URL が消えることがある
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// text を書き出し先のフォルダの、決めたファイル名のファイルに上書きする(無ければ作る)。
// ボタンを押した処理の中で呼ぶ(フォルダの選択と許可の確認にクリックが要る)。chooseDir ならフォルダを選び直す。
// 戻り値: { path: "フォルダ名/ファイル名" } / { path: ファイル名, downloaded: true } / null キャンセル。
// フォルダが消された・移動されたなどで書けなければ例外(選び直してもらう)。
export async function exportToFile(text, { chooseDir = false } = {}) {
  const name = await loadFileName();
  if (!canPickFolder) {
    download(text, name);
    return { path: name, downloaded: true };
  }
  const current = await loadExportDir();
  let dir = chooseDir ? null : current;
  // 書き込みの許可はブラウザを再起動すると確認し直しになる。断られたら選び直してもらう
  if (dir && (await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") dir = null;
  }
  if (!dir) {
    dir = await pickDir(current);
    if (!dir) return null;
  }
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
  return { path: `${dir.name}/${name}` };
}
