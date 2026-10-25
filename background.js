import { folderUrls, openUrls } from "./bookmarks.js";
import { loadSets } from "./sets.js";
import { getSettings } from "./settings.js";

// タブを開く処理はポップアップではなくここで行う。
// 最初のタブをアクティブにした瞬間にポップアップが閉じ、ポップアップ側で回していると残りが開かれないため。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open") return;
  open(message.target).then(
    (count) => sendResponse({ ok: true, count }),
    (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }),
  );
  return true;
});

// セットの項目は、対応するブックマークが見つからなくても保存してある URL で開く
async function open(target) {
  if (target.type === "folder") {
    const urls = await folderUrls(target.id);
    if (urls === null) throw new Error("見つかりません(削除された可能性があります)");
    return openUrls(urls);
  }
  const set = (await loadSets()).find((s) => s.id === target.id);
  if (!set) throw new Error("見つかりません(削除された可能性があります)");
  return openUrls(set.items.map((item) => item.url), { background: set.background });
}

// コマンド名は "01_open_slot" の形。数字は chrome://extensions/shortcuts の表示順をそろえるためのもの。
chrome.commands.onCommand.addListener(async (command) => {
  const index = parseInt(command, 10) - 1;
  const target = (await getSettings()).slots[index];
  if (!target) {
    flashBadge(`スロット${index + 1}に何も割り当てられていません`);
    return;
  }
  try {
    if ((await open(target)) === 0) flashBadge(`スロット${index + 1}に開けるブックマークがありません`);
  } catch (e) {
    flashBadge(`スロット${index + 1}: ${e.message}`);
  }
});

// ショートカットキーでの失敗は画面に何も出ないので、アイコンに「!」を数秒出して知らせる
async function flashBadge(title) {
  await chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setTitle({ title });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: chrome.runtime.getManifest().action.default_title });
  }, 4000);
}
