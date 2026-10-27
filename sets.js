// セットの各項目を、この環境のブックマークと照合する。
//
// 項目は { url, title } だけを持ち、ブックマークの ID は bindings(URL → ID)に別に持つ。
// 照合の順番:
//   1. bindings の ID のブックマークがあればそれ。URL やタイトルが変わっていたら項目のほうを更新する
//      (ブックマークを編集したらセットが追従する)
//   2. なければ同じ URL のブックマークを探し、見つかったら bindings に記録する
//      (インポート直後や、ブックマークを登録し直したとき)
//   3. どちらもなければ bookmarkId: null。開くときは保存してある URL をそのまま開く
// 別の環境から来た ID は同じ番号でも別のブックマークを指しうるので、ID をエクスポートに入れず、
// 必ず URL での照合から始める。

import { readTree } from "./bookmarks.js";
import { getSettings, saveSets } from "./settings.js";

export function indexTree(tree) {
  const byId = new Map();
  const byUrl = new Map();
  for (const e of tree) {
    if (e.kind !== "bookmark") continue;
    byId.set(e.id, e);
    if (!byUrl.has(e.url)) byUrl.set(e.url, e); // 同じ URL が複数あれば木の先頭のもの
  }
  return { byId, byUrl };
}

// sets と bindings を照合結果で書き換え、変わったかどうかを返す。
// 戻り値の各項目には bookmarkId(見つからなければ null)が付く。
function resolve(sets, bindings, index) {
  let changed = false;
  const resolved = sets.map((set) => ({
    ...set,
    items: set.items.map((item) => {
      let node = index.byId.get(bindings[item.url]);
      if (!node) {
        node = index.byUrl.get(item.url);
        if (!node) return { ...item, bookmarkId: null };
        bindings[item.url] = node.id;
        changed = true;
      }
      // 古い URL の対応は消さない(同じ URL を持つ別のセットもこの後で追従できるように)。
      // どこからも使われなくなった時点で saveSets が捨てる。
      if (node.url !== item.url) bindings[node.url] = node.id;
      if (node.url !== item.url || node.title !== item.title) changed = true;
      return { url: node.url, title: node.title, bookmarkId: node.id };
    }),
  }));
  return { resolved, changed };
}

const strip = (sets) => sets.map((s) => ({ ...s, items: s.items.map(({ url, title }) => ({ url, title })) }));

// 照合済みのセットを返す。照合で項目や対応表が変わったら保存もする。
export async function loadSets(tree) {
  tree ??= await readTree();
  const { sets, bindings } = await getSettings();
  const { resolved, changed } = resolve(sets, bindings, indexTree(tree));
  if (changed) await saveSets(strip(resolved), bindings);
  return resolved;
}

// 照合済みのセット(bookmarkId 付き)を保存する。bookmarkId のある項目は対応表にも記録する。
export async function storeSets(resolvedSets) {
  const { bindings } = await getSettings();
  for (const set of resolvedSets) {
    for (const item of set.items) if (item.bookmarkId) bindings[item.url] = item.bookmarkId;
  }
  await saveSets(strip(resolvedSets), bindings);
}

// ---- エクスポート / インポート ----

const FORMAT = "bookmark-set-opener";

export function exportData(sets) {
  return {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    sets: strip(sets),
  };
}

// ファイルにはセットの並び(配列の順 = ポップアップの表示順)とセットの中の並び(items の順 = 開く順)がそのまま入っている。
// 取り込んだセットはファイルの並びのまま末尾にまとめ、同じ id のセットは置き換える(同じ環境で書き出したものを戻す場合)。
// ファイルにないセットは今の並びのまま前に残る。全部のセットを書き出したファイルを戻せば、並びは書き出したときと同じになる。
// 取り込んだセットの数を返す。形式が違えば例外。
export async function importData(data) {
  if (data?.format !== FORMAT || !Array.isArray(data.sets)) {
    throw new Error("Bookmark Set Opener で書き出したファイルではありません");
  }
  const incoming = data.sets
    .filter((s) => typeof s?.id === "string" && s.id && typeof s.name === "string" && Array.isArray(s.items))
    .map((s) => ({
      id: s.id,
      name: s.name,
      background: s.background === true,
      items: s.items
        .filter((item) => typeof item?.url === "string" && !item.url.startsWith("javascript:"))
        .map((item) => ({ url: item.url, title: typeof item.title === "string" ? item.title : item.url })),
    }));

  const { sets, bindings } = await getSettings();
  const incomingIds = new Set(incoming.map((s) => s.id));
  await saveSets([...sets.filter((s) => !incomingIds.has(s.id)), ...incoming], bindings);
  return incoming.length;
}
