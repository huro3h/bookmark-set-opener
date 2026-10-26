import { readTree } from "./bookmarks.js";
import { exportData, importData, loadSets, storeSets } from "./sets.js";
import { getSettings, parseTargetKey, saveSlots, targetKey } from "./settings.js";
import { enableDragReorder, handle } from "./drag.js";

const $ = (id) => document.getElementById(id);

let tree = [];
let sets = []; // 照合済み(項目に bookmarkId 付き)
let slots = [];

async function load() {
  tree = await readTree();
  [sets, { slots }] = await Promise.all([loadSets(tree), getSettings()]);
}

// simple_memo と同じ lucide 系の線画
const EDIT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
// 複製は smart-keysmith と同じ lucide の copy-plus(重なった四角だけだとクリップボードへのコピーに見える)
const DUP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="15" x2="15" y1="12" y2="18"/><line x1="12" x2="18" y1="15" y2="15"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const DELETE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

function iconButton(icon, label, className, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `icon-btn ${className}`;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = icon;
  b.addEventListener("click", onClick);
  return b;
}

function showMessage(text, isError = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", isError);
}

// ---- メイン画面 ----

async function renderMain() {
  $("sets").replaceChildren(
    ...sets.map((set) => {
      const li = document.createElement("li");
      li.className = "set";
      li.dataset.key = set.id;

      const text = document.createElement("div");
      text.className = "set-text";
      const name = document.createElement("div");
      name.className = "set-name";
      name.textContent = set.name;
      const meta = document.createElement("div");
      meta.className = "set-meta";
      meta.textContent = `${set.items.length} 件`;
      const missing = set.items.filter((item) => !item.bookmarkId).length;
      if (missing) {
        const span = document.createElement("span");
        span.className = "missing";
        span.textContent = `(うち ${missing} 件はブックマークにない)`;
        meta.append(span);
      }
      text.append(name, meta);

      // 切り替えた時点で保存する(編集画面を開かずに変えられるよう一覧に置いている)
      const bg = document.createElement("label");
      bg.className = "bg-toggle";
      bg.title = "開いたタブに切り替えず、今見ているタブのままにする";
      const bgBox = document.createElement("input");
      bgBox.type = "checkbox";
      bgBox.checked = set.background;
      bgBox.addEventListener("change", async () => {
        set.background = bgBox.checked;
        await storeSets(sets);
      });
      bg.append(bgBox, "バックグラウンドで開く");

      li.append(
        handle(),
        text,
        bg,
        iconButton(DUP_ICON, "複製", "dup", () => duplicateSet(set.id)),
        iconButton(EDIT_ICON, "編集", "edit", () => openEditor(set)),
        iconButton(DELETE_ICON, "削除", "danger", () => deleteSet(set.id)),
      );
      return li;
    }),
  );
  $("export").disabled = sets.length === 0;
  await renderSlots();
}

async function renderSlots() {
  const commands = await chrome.commands.getAll();
  const shortcutOf = new Map(commands.map((c) => [c.name, c.shortcut]));
  const folders = tree.filter((e) => e.kind === "folder");

  $("slots").replaceChildren(
    ...slots.map((target, i) => {
      const select = document.createElement("select");
      select.add(new Option("(なし)", ""));

      const setGroup = document.createElement("optgroup");
      setGroup.label = "セット";
      for (const s of sets) setGroup.append(new Option(s.name, targetKey({ type: "set", id: s.id })));
      if (sets.length) select.append(setGroup);

      const folderGroup = document.createElement("optgroup");
      folderGroup.label = "フォルダ";
      for (const f of folders) {
        const option = new Option(`${"　".repeat(f.depth)}${f.title} (${f.count})`, targetKey({ type: "folder", id: f.id }));
        // 直下にブックマークがないフォルダは開いても何も起きないので選ばせない
        option.disabled = f.count === 0;
        folderGroup.append(option);
      }
      select.append(folderGroup);

      const key = targetKey(target);
      if (key && ![...select.options].some((o) => o.value === key)) {
        // 割り当て後にセットやフォルダが削除された
        select.add(new Option("(見つかりません)", key), 1);
        select.classList.add("missing");
      }
      select.value = key;
      select.addEventListener("change", async () => {
        slots[i] = parseTargetKey(select.value);
        await saveSlots(slots);
        await renderSlots();
      });

      const tr = document.createElement("tr");
      const label = document.createElement("td");
      label.textContent = `スロット${i + 1}`;
      const cell = document.createElement("td");
      cell.append(select);
      const keyCell = document.createElement("td");
      keyCell.className = "key";
      keyCell.textContent = shortcutOf.get(`0${i + 1}_open_slot`) || "キー未設定";
      tr.append(label, cell, keyCell);
      return tr;
    }),
  );
}

// セット一覧はハンドルをドラッグして並べ替える(ポップアップでの表示順)
enableDragReorder($("sets"), async (keys) => {
  sets = keys.map((id) => sets.find((s) => s.id === id));
  await storeSets(sets);
  await renderMain();
});

// 1クリックで消し、トーストの「元に戻す」で戻せるようにする(確認の二度押しはしない)
// 元のすぐ下に「〜 のコピー」として足す。中身と「バックグラウンドで開く」は引き継ぎ、スロットの割り当ては引き継がない。
async function duplicateSet(id) {
  const index = sets.findIndex((s) => s.id === id);
  const set = sets[index];
  const copy = { ...set, id: crypto.randomUUID(), name: `${set.name} のコピー`, items: set.items.map((item) => ({ ...item })) };
  sets.splice(index + 1, 0, copy);
  await storeSets(sets);
  await renderMain();
  toast(`「${set.name}」を複製しました`);
}

async function deleteSet(id) {
  const index = sets.findIndex((s) => s.id === id);
  const set = sets[index];
  sets = sets.filter((s) => s.id !== id);
  await storeSets(sets);
  // このセットを割り当てていたスロットは空にする(元に戻すときに割り当て直す)
  const slotIndexes = slots.flatMap((t, i) => (t?.type === "set" && t.id === id ? [i] : []));
  if (slotIndexes.length) {
    slots = slots.map((t, i) => (slotIndexes.includes(i) ? null : t));
    await saveSlots(slots);
  }
  await renderMain();
  toast(`「${set.name}」を削除しました`, "元に戻す", () => restoreSet(set, index, slotIndexes));
}

async function restoreSet(set, index, slotIndexes) {
  if (sets.some((s) => s.id === set.id)) return;
  sets.splice(Math.min(index, sets.length), 0, set);
  await storeSets(sets);
  // 削除したあとにほかのものを割り当てたスロットは、そのままにする
  const reassign = slotIndexes.filter((i) => slots[i] === null);
  if (reassign.length) {
    slots = slots.map((t, i) => (reassign.includes(i) ? { type: "set", id: set.id } : t));
    await saveSlots(slots);
  }
  await renderMain();
}

// ---- トースト ----
// 画面下の中央に数秒出す。action を渡すとボタンを付ける(押すとトーストを閉じて実行)。
// マウスを乗せている間は消えない。新しいトーストは前のものを置き換える(前の「元に戻す」はできなくなる)。
const TOAST_MS = 6000;
let toastTimer = null;

function toast(message, actionLabel, action) {
  const el = $("toast");
  $("toastMessage").textContent = message;
  const btn = $("toastAction");
  btn.hidden = !action;
  btn.textContent = actionLabel ?? "";
  btn.onclick = action
    ? () => {
        hideToast();
        action();
      }
    : null;
  el.classList.add("show");
  scheduleHide();
}

function scheduleHide() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  $("toast").classList.remove("show");
  $("toastAction").onclick = null;
}

$("toast").addEventListener("mouseenter", () => clearTimeout(toastTimer));
$("toast").addEventListener("mouseleave", () => $("toast").classList.contains("show") && scheduleHide());

$("newSet").addEventListener("click", () => openEditor(null));
$("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(exportData(sets), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bookmarks-launcher-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showMessage(`${sets.length} 個のセットを書き出しました`);
});

$("import").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  $("importFile").value = "";
  if (!file) return;
  try {
    const count = await importData(JSON.parse(await file.text()));
    await load();
    await renderMain();
    const missing = sets.flatMap((s) => s.items).filter((item) => !item.bookmarkId).length;
    showMessage(
      `${count} 個のセットを読み込みました` +
        (missing ? `(${missing} 件はこの環境のブックマークにないため、保存されていた URL で開きます)` : ""),
    );
  } catch (e) {
    showMessage(`読み込めませんでした: ${e instanceof SyntaxError ? "JSON として読めません" : e.message}`, true);
  }
});

// ---- セットの編集 ----

// { id, selected: Set<bookmarkId>, missing: [{ url, title, checked }], order: キーの配列, undo: 状態の配列, redo: 状態の配列 }
// missing はこの環境のブックマークに見つからない項目。選択中の一覧に出し、× で外す(checked: false)。
// order は選択中の項目の並び(= 開く順)。キーはブックマークの ID か "missing:<missing の添字>"。
// 新しく選んだものは末尾に足し、選択中の一覧でドラッグして並べ替える。
let editing = null;

// tree を引きやすくした索引。フォルダの子孫のブックマーク、フォルダ直下の要素
let descendantsOf = new Map(); // folderId -> bookmarkId[]
let childrenOf = new Map(); // folderId | null -> entry[](null は最上位のフォルダ)
let bookmarkOf = new Map(); // bookmarkId -> entry

function indexHierarchy() {
  descendantsOf = new Map();
  childrenOf = new Map([[null, []]]);
  bookmarkOf = new Map();
  const stack = [];
  for (const e of tree) {
    while (stack.length && stack.at(-1).depth >= e.depth) stack.pop();
    childrenOf.get(stack.at(-1)?.id ?? null).push(e);
    if (e.kind === "folder") {
      descendantsOf.set(e.id, []);
      childrenOf.set(e.id, []);
      stack.push(e);
    } else {
      bookmarkOf.set(e.id, e);
      for (const f of stack) descendantsOf.get(f.id).push(e.id);
    }
  }
}

function openEditor(set) {
  indexHierarchy();
  editing = {
    id: set?.id ?? null,
    selected: new Set(set?.items.filter((item) => item.bookmarkId).map((item) => item.bookmarkId)),
    missing: (set?.items ?? []).filter((item) => !item.bookmarkId).map((item) => ({ ...item, checked: true })),
    // 保存してある並びをそのまま使う
    order: (() => {
      let m = 0;
      return (set?.items ?? []).map((item) => item.bookmarkId ?? `missing:${m++}`);
    })(),
    undo: [],
    redo: [],
  };
  $("editorTitle").textContent = set ? "セットを編集" : "新しいセット";
  $("setName").value = set?.name ?? "";
  $("main").classList.add("hidden");
  $("editor").classList.remove("hidden");
  normalizeOrder();
  renderBar();
  syncSelection();
  window.scrollTo(0, 0);
  $("setName").focus();
}

function closeEditor() {
  closeMenus(0);
  editing = null;
  $("editor").classList.add("hidden");
  $("main").classList.remove("hidden");
}

// ---- Undo / Redo ----
// 選択を変える操作(ブックマークを押す・すべて選択/解除・一覧の ×)を1回ずつ記録する。
// 記録するのは操作前の選択の写し。名前の入力欄の文字は対象外(入力欄そのものの Undo に任せる)。

const HISTORY_LIMIT = 200;

function snapshot() {
  return { selected: new Set(editing.selected), missing: editing.missing.map((m) => m.checked), order: [...editing.order] };
}

function restore(state) {
  editing.selected = state.selected;
  editing.missing.forEach((m, i) => (m.checked = state.missing[i]));
  editing.order = state.order;
}

// order を選択中の項目とそろえる。外れたものを抜き、新しく選ばれたものを末尾に足す
// (まとめて選んだときはブックマークの並び順、そのあとにブックマークにない項目)
function normalizeOrder() {
  const wanted = [
    ...tree.filter((e) => e.kind === "bookmark" && editing.selected.has(e.id)).map((e) => e.id),
    ...editing.missing.flatMap((m, i) => (m.checked ? [`missing:${i}`] : [])),
  ];
  const wantedSet = new Set(wanted);
  const kept = editing.order.filter((k) => wantedSet.has(k));
  const keptSet = new Set(kept);
  editing.order = [...kept, ...wanted.filter((k) => !keptSet.has(k))];
}

// 選択や並びを変える操作はすべてここを通す
function changeSelection(apply) {
  const before = snapshot();
  apply();
  normalizeOrder();
  const after = snapshot();
  const same = before.order.length === after.order.length && before.order.every((k, i) => k === after.order[i]);
  if (!same) {
    editing.undo.push(before);
    if (editing.undo.length > HISTORY_LIMIT) editing.undo.shift();
    editing.redo = [];
  }
  syncSelection();
}

function undo() {
  if (!editing?.undo.length) return;
  editing.redo.push(snapshot());
  restore(editing.undo.pop());
  syncSelection();
}

function redo() {
  if (!editing?.redo.length) return;
  editing.undo.push(snapshot());
  restore(editing.redo.pop());
  syncSelection();
}

$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);

// ⌘Z / ⇧⌘Z(Windows などは Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)。文字入力欄にいる間はそちらの Undo を優先する
document.addEventListener("keydown", (ev) => {
  if (!editing || !(ev.metaKey || ev.ctrlKey) || ev.altKey) return;
  if (ev.target.closest("input, textarea")) return;
  const key = ev.key.toLowerCase();
  if (key === "z" && !ev.shiftKey) undo();
  else if ((key === "z" && ev.shiftKey) || (key === "y" && ev.ctrlKey)) redo();
  else return;
  ev.preventDefault();
});

// ---- 部品 ----

// ブラウザがキャッシュしているファビコン(ブックマークバーと同じもの)。favicon 権限が要る。
// 一度も開いたことのないサイトは既定の地球儀アイコンになる。高解像度の画面向けに 32px を 16px で表示する。
function favicon(url) {
  const img = document.createElement("img");
  img.className = "favicon";
  img.alt = "";
  img.width = 16;
  img.height = 16;
  img.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
  return img;
}

const FOLDER_SVG = `<svg class="node-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
  <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
</svg>`;

function span(className, text) {
  const s = document.createElement("span");
  s.className = className;
  s.textContent = text;
  return s;
}

// 押すと選択/解除が切り替わるボタン。選択中は枠とハイライトで示す(チェックボックスは使わない)
function pickButton(className, kind, id, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.dataset.kind = kind;
  b.dataset.id = id;
  b.addEventListener("click", onClick);
  return b;
}

function toggleBookmark(id) {
  changeSelection(() => (editing.selected.has(id) ? editing.selected.delete(id) : editing.selected.add(id)));
}

// まとめて選択する。全部選択済みなら全部解除する
function toggleAll(ids) {
  changeSelection(() => {
    const all = ids.length > 0 && ids.every((id) => editing.selected.has(id));
    for (const id of ids) all ? editing.selected.delete(id) : editing.selected.add(id);
  });
}

// ブックマークバー: ブラウザ上部のブックマークバーをそのまま再現する。
// ブックマーク バー(id "1")の中身を横に並べ、ほかの最上位フォルダ(その他のブックマーク等)は右端に置く。
// 表示はブラウザと同じくファビコンとサイト名だけで、URL はマウスを乗せたときのツールチップに出す。
// ブックマークは押すと選択/解除。フォルダは押すとドロップダウンのメニューを開き、サブフォルダは右にサブメニューを出す。
// 入りきらない分はブラウザと同じく右端の「»」にしまい、押すとフォルダと同じメニューで出す。
const OVERFLOW = "overflow"; // 「»」のメニューの folderId の代わり
let overflowEntries = []; // 「»」にしまったもの(バーの並び順)

function renderBar() {
  closeMenus(0);
  const bar = document.createElement("div");
  bar.className = "bmbar";
  const items = document.createElement("div");
  items.className = "bmbar-items";
  for (const e of childrenOf.get("1") ?? []) items.append(barItem(e));
  const more = document.createElement("button");
  more.type = "button";
  more.className = "bm-chip bmbar-more";
  more.dataset.kind = "overflow-menu";
  more.title = "入りきらないブックマーク";
  more.setAttribute("aria-label", "入りきらないブックマーク");
  more.textContent = "»";
  menuOpener(more, OVERFLOW, 0);
  const rest = document.createElement("div");
  rest.className = "bmbar-rest";
  for (const top of childrenOf.get(null)) if (top.id !== "1") rest.append(barItem(top));
  bar.append(items, more, rest);
  $("picker").replaceChildren(bar);
  layoutBar();
  barObserver.disconnect();
  barObserver.observe(bar);
}

// 幅が変わるたびに、バーに収まる分だけ出す。収まらないものから後ろは全部「»」へ(ブラウザと同じく途中を飛ばさない)
const barObserver = new ResizeObserver(() => layoutBar());

function layoutBar() {
  const items = document.querySelector(".bmbar-items");
  const more = document.querySelector(".bmbar-more");
  if (!items) return;
  const chips = [...items.children];
  for (const c of chips) c.hidden = false;
  more.hidden = true;
  if (items.scrollWidth > items.clientWidth) {
    more.hidden = false; // 「»」の分だけ狭くなってから測り直す
    const limit = items.getBoundingClientRect().right;
    const first = chips.findIndex((c) => c.getBoundingClientRect().right > limit);
    for (const c of chips.slice(first)) c.hidden = true;
  }
  const entries = childrenOf.get("1") ?? [];
  const hidden = chips.flatMap((c, i) => (c.hidden ? [entries[i]] : []));
  const changed = hidden.length !== overflowEntries.length || hidden.some((e, i) => e !== overflowEntries[i]);
  overflowEntries = hidden;
  // 開いている「»」のメニューは、中身が変わったら閉じる
  if (!changed) return;
  if (openMenus[0]?.folderId === OVERFLOW) closeMenus(0);
  if (editing) syncSelection();
}

function barItem(e) {
  if (e.kind === "folder") return folderMenuButton(e, "bm-chip folder", 0);
  const b = pickButton("bm-chip", "bookmark", e.id, () => toggleBookmark(e.id));
  b.title = e.title ? `${e.title}\n${e.url}` : e.url;
  // タイトルが空のブックマークは、ブラウザと同じくファビコンだけ
  b.append(favicon(e.url));
  if (e.title) b.append(span("title", e.title));
  return b;
}

// フォルダのボタン(バーの上とメニューの中で共通)。level はこのボタンが開くメニューの階層
function folderMenuButton(e, className, level) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.dataset.kind = "folder-menu";
  b.dataset.id = e.id;
  b.insertAdjacentHTML("beforeend", FOLDER_SVG);
  b.append(span("title", e.title || "(名前なし)"));
  if (level > 0) b.append(span("submenu-arrow", "›"));
  menuOpener(b, e.id, level);
  return b;
}

// 押すとメニューを開くボタンの動き(フォルダと「»」で共通)
function menuOpener(b, folderId, level) {
  const open = () => openMenu(folderId, b, level);
  let hoveredOpenAt = 0;
  b.addEventListener("click", () => {
    // バーのフォルダは押すたびに開閉する。メニューの中のフォルダは開くだけ。
    // ただし乗せただけで開いた直後のクリックでは閉じない(開いたものを押した瞬間に閉じてしまうため)
    const justHovered = Date.now() - hoveredOpenAt < 600;
    if (level === 0 && openMenus[0]?.folderId === folderId && !justHovered) closeMenus(0);
    else open();
  });
  // ブラウザと同じく、メニューの中ではマウスを乗せただけでサブメニューを開く。
  // バーの上でも、どれかのメニューを開いている間は乗せるだけで切り替える
  b.addEventListener("mouseenter", () => {
    if (level > 0 || (openMenus.length && openMenus[0].folderId !== folderId)) {
      open();
      hoveredOpenAt = Date.now();
    }
  });
}

let openMenus = []; // [{ folderId, el }] 階層の浅い順

function closeMenus(fromLevel) {
  for (const m of openMenus.splice(fromLevel)) m.el.remove();
  for (const b of document.querySelectorAll("[data-kind$=-menu].open")) {
    if (!openMenus.some((m) => m.anchor === b)) b.classList.remove("open");
  }
}

function openMenu(folderId, anchor, level) {
  if (openMenus[level]?.folderId === folderId) return;
  closeMenus(level);
  anchor.classList.add("open");

  const menu = document.createElement("div");
  menu.className = "bm-menu";
  menu.setAttribute("role", "menu");
  const children = folderId === OVERFLOW ? overflowEntries : childrenOf.get(folderId);
  for (const e of children) {
    if (e.kind === "folder") {
      menu.append(folderMenuButton(e, "menu-item folder", level + 1));
    } else {
      const b = pickButton("menu-item", "bookmark", e.id, () => toggleBookmark(e.id));
      b.title = e.url;
      b.append(favicon(e.url), span("title", e.title || e.url));
      // ブックマークに乗ったら、それより深いサブメニューは閉じる(ブラウザと同じ)
      b.addEventListener("mouseenter", () => closeMenus(level + 1));
      menu.append(b);
    }
  }
  // 「»」はフォルダではないので「すべて選択」を付けない
  const ids = descendantsOf.get(folderId) ?? [];
  if (ids.length) {
    menu.append(Object.assign(document.createElement("hr"), { className: "menu-sep" }));
    const all = document.createElement("button");
    all.type = "button";
    all.className = "menu-item select-all";
    all.dataset.kind = "select-all";
    all.dataset.id = folderId;
    all.addEventListener("click", () => toggleAll(ids));
    all.addEventListener("mouseenter", () => closeMenus(level + 1));
    menu.append(all);
  }

  $("menus").append(menu);
  openMenus.push({ folderId, el: menu, anchor });

  // バーのフォルダは真下に、サブメニューは親メニューの右に出す。横にはみ出すなら反対側へ。
  // 縦はブラウザと同じく常にバーより下に出し、収まらない分はメニューの中をスクロールさせる
  // (上にずらすとバーに重なって、ほかのフォルダを押せなくなる)。
  const a = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  let left, top;
  if (level === 0) {
    left = Math.min(a.left, innerWidth - w - 8);
    // ボタンではなくバーの下端から出す
    top = anchor.closest(".bmbar").getBoundingClientRect().bottom + 2;
  } else {
    const parent = openMenus[level - 1].el.getBoundingClientRect();
    left = parent.right + w > innerWidth - 8 ? parent.left - w : parent.right - 2;
    // サブメニューは下に収まらなければ持ち上げるが、バーのすぐ下(最初のメニューの上端)より上には出さない
    const floor = parseFloat(openMenus[0].el.style.top);
    top = Math.max(floor, Math.min(a.top - 5, innerHeight - menu.offsetHeight - 8));
  }
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  menu.style.maxHeight = `${innerHeight - top - 8}px`;
  syncSelection();
}

// メニューの外を押す・Esc・スクロールで閉じる(メニューは position: fixed なので、スクロールするとずれる)
document.addEventListener("mousedown", (ev) => {
  if (openMenus.length && !ev.target.closest(".bm-menu, .bm-chip.folder, .bmbar-more")) closeMenus(0);
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && openMenus.length) closeMenus(0);
});
window.addEventListener("scroll", () => closeMenus(0));
window.addEventListener("resize", () => closeMenus(0));

// 選択状態を見た目に反映する。描き直すとフォーカスやスクロールが飛ぶので、今ある要素のクラスだけを書き換える。
//   ブックマーク: 選択中は .selected(枠とハイライト)
//   バーとメニューのフォルダ: 中(サブフォルダを含む)に選択があれば .has-selected。「»」はしまったものの中に選択があれば
//   メニューの「すべて選択」: 全部選択済みなら「すべて解除」に変える
function syncSelection() {
  const mark = (el, selected) => {
    el.classList.toggle("selected", selected);
    el.setAttribute("aria-pressed", String(selected));
  };
  for (const el of document.querySelectorAll("#editor [data-kind]")) {
    const { kind, id } = el.dataset;
    if (kind === "bookmark") {
      mark(el, editing.selected.has(id));
    } else if (kind === "folder-menu") {
      el.classList.toggle("has-selected", descendantsOf.get(id).some((t) => editing.selected.has(t)));
    } else if (kind === "overflow-menu") {
      const ids = overflowEntries.flatMap((e) => (e.kind === "folder" ? descendantsOf.get(e.id) : [e.id]));
      el.classList.toggle("has-selected", ids.some((t) => editing.selected.has(t)));
    } else if (kind === "select-all") {
      const ids = descendantsOf.get(id);
      const all = ids.every((t) => editing.selected.has(t));
      el.textContent = `${all ? "このフォルダをすべて解除" : "このフォルダをすべて選択"} (${ids.length})`;
    }
  }
  $("undo").disabled = editing.undo.length === 0;
  $("redo").disabled = editing.redo.length === 0;
  updateEditorState();
}

function selectedItems() {
  // order の並び(= 開く順)。同じ URL は1つにまとめる
  const items = editing.order.map((key) => {
    if (key.startsWith("missing:")) {
      const { url, title } = editing.missing[Number(key.slice(8))];
      return { key, url, title, bookmarkId: null };
    }
    const e = bookmarkOf.get(key);
    return { key, url: e.url, title: e.title, bookmarkId: e.id };
  });
  const seen = new Set();
  return items.filter((item) => !seen.has(item.url) && seen.add(item.url));
}

function updateEditorState() {
  const items = selectedItems();
  $("save").disabled = items.length === 0 || !$("setName").value.trim();
  renderSelectedList(items);
}

const REMOVE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// 選択中のブックマークの一覧(保存したときにセットに入るもの、開く順)。× で選択を外せる
function renderSelectedList(items) {
  $("selectedHeading").textContent = `${items.length} 件を選択中`;
  $("selectedEmpty").classList.toggle("hidden", items.length > 0);
  $("selectedList").replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.className = "sel-row";
      li.dataset.key = item.key;
      const remove = iconButton(REMOVE_ICON, "選択を外す", "danger", () =>
        changeSelection(() => {
          if (item.bookmarkId) editing.selected.delete(item.bookmarkId);
          else editing.missing.find((m) => m.url === item.url).checked = false;
        }),
      );
      li.append(handle(), favicon(item.url), span("title", item.title || item.url), span("url", item.url), remove);
      if (!item.bookmarkId) li.querySelector(".title").after(span("tag", "ブックマークにない"));
      li.title = item.url;
      return li;
    }),
  );
}

// 選択中の一覧はハンドルをドラッグして並べ替える(= 開く順)。Undo で戻せる
enableDragReorder($("selectedList"), (keys) => changeSelection(() => (editing.order = keys)));

$("setName").addEventListener("input", updateEditorState);
$("cancel").addEventListener("click", closeEditor);

$("save").addEventListener("click", async () => {
  const set = {
    id: editing.id ?? crypto.randomUUID(),
    name: $("setName").value.trim(),
    background: sets.find((s) => s.id === editing.id)?.background ?? false,
    items: selectedItems(),
  };
  const i = sets.findIndex((s) => s.id === set.id);
  if (i >= 0) sets[i] = set;
  else sets.push(set);
  await storeSets(sets);
  closeEditor();
  showMessage("");
  await renderMain();
});

// ブックマークやキーをほかのタブで変えて戻ってきたときに反映する(編集中は選択が崩れるので触らない)
window.addEventListener("focus", async () => {
  if (editing) return;
  await load();
  await renderMain();
});

await load();
await renderMain();
