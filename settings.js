// chrome.storage.local に置く設定。
//   sets:     [{ id, name, background, items: [{ url, title }] }]  ポップアップでの表示順。エクスポートの対象
//             background: true ならタブを開いても今のタブのまま切り替えない
//   bindings: { [url]: bookmarkId }                     この環境でのブックマークとの対応表(sets.js 参照)
//   slots:    [{ type: "folder" | "set", id } | null] x3  ショートカットキーのスロット
// ブックマークの ID は環境ごとに振られる番号なので、エクスポートする sets には入れない。

export const SLOT_COUNT = 3;

export async function getSettings() {
  const { sets, bindings, slots } = await chrome.storage.local.get(["sets", "bindings", "slots"]);
  return {
    sets: sets ?? [],
    bindings: bindings ?? {},
    slots: Array.from({ length: SLOT_COUNT }, (_, i) => slots?.[i] ?? null),
  };
}

// どのセットからも使われなくなった URL の対応は捨てる
export async function saveSets(sets, bindings) {
  const used = new Set(sets.flatMap((s) => s.items.map((item) => item.url)));
  const pruned = Object.fromEntries(Object.entries(bindings).filter(([url]) => used.has(url)));
  await chrome.storage.local.set({ sets, bindings: pruned });
}

export async function saveSlots(slots) {
  await chrome.storage.local.set({ slots });
}

// セレクトボックスの value などで使う "set:<id>" / "folder:<id>" 形式との相互変換
export function targetKey(target) {
  return target ? `${target.type}:${target.id}` : "";
}

export function parseTargetKey(key) {
  if (!key) return null;
  const i = key.indexOf(":");
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}
