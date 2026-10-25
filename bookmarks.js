// ブックマークの読み取りとタブを開く処理。popup / options / background で共有する。

// tabs.create で開けない URL。ブックマークレットは開いても何も起きないので数えない。
export function isOpenable(url) {
  return Boolean(url) && !url.startsWith("javascript:");
}

// ブックマークの木を表示順に平らに並べる。
// 要素は { kind: "folder" | "bookmark", id, title, url?, depth, path, count? }。
// 開けるブックマークを子孫に1つも持たないフォルダは除く。フォルダの count は直下のブックマーク数。
export async function readTree() {
  const [root] = await chrome.bookmarks.getTree();
  const result = [];

  function walk(node, depth, parentPath) {
    const path = parentPath ? `${parentPath} / ${node.title}` : node.title;
    const entry = { kind: "folder", id: node.id, title: node.title, depth, path, count: 0 };
    const index = result.length;
    result.push(entry);

    let hasAny = false;
    for (const child of node.children) {
      if (child.children) {
        if (walk(child, depth + 1, path)) hasAny = true;
      } else if (isOpenable(child.url)) {
        result.push({ kind: "bookmark", id: child.id, title: child.title, url: child.url, depth: depth + 1, path });
        entry.count++;
        hasAny = true;
      }
    }
    if (!hasAny) result.splice(index);
    return hasAny;
  }

  // ルート(id "0")自体は名前がないので出さず、ブックマーク バーなどを最上位にする
  for (const top of root.children) walk(top, 0, "");
  return result;
}

// フォルダ直下のブックマークの URL を返す(サブフォルダの中身は含めない)。フォルダがなければ null。
export async function folderUrls(folderId) {
  try {
    const children = await chrome.bookmarks.getChildren(folderId);
    return children.map((c) => c.url).filter(isOpenable);
  } catch {
    return null; // フォルダが削除された
  }
}

// 最後にフォーカスしたウィンドウの末尾に新しいタブで開き、開いたタブの数を返す。
// background なら今のタブのまま切り替えない(既定では最初に開いたタブを選択する)。
export async function openUrls(urls, { background = false } = {}) {
  if (urls.length === 0) return 0;

  let windowId;
  try {
    ({ id: windowId } = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }));
  } catch {
    // 通常のウィンドウが1つもない(すべて閉じている・ポップアップ型だけ等)
    // 選択を残すタブがないので background でも普通に開く
    await chrome.windows.create({ url: urls });
    return urls.length;
  }

  let opened = 0;
  for (const [i, url] of urls.entries()) {
    try {
      await chrome.tabs.create({ windowId, url, active: !background && i === 0 });
      opened++;
    } catch (e) {
      // 開けない URL(ポリシーで禁止されている等)があっても残りは開く
      console.warn("タブを開けませんでした", url, e);
    }
  }
  return opened;
}
