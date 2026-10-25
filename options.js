import { readTree } from "./bookmarks.js";
import { exportData, importData, loadSets, storeSets } from "./sets.js";
import { getSettings, parseTargetKey, saveSlots, targetKey } from "./settings.js";

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

// 1回目のクリックで確認表示(赤く塗って文言を添える)に変え、3秒以内のもう一度で実行する(confirm() は使わない)
function confirmIconButton(icon, label, confirmLabel, onConfirm) {
  const b = iconButton(icon, label, "danger", () => {
    if (!b.classList.contains("confirm")) {
      b.classList.add("confirm");
      b.title = confirmLabel;
      b.insertAdjacentHTML("beforeend", `<span class="confirm-label">${confirmLabel}</span>`);
      setTimeout(() => {
        b.classList.remove("confirm");
        b.title = label;
        b.querySelector(".confirm-label")?.remove();
      }, 3000);
      return;
    }
    onConfirm();
  });
  return b;
}

function showMessage(text, isError = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", isError);
}

// ---- メイン画面 ----

async function renderMain() {
  $("sets").replaceChildren(
    ...sets.map((set, i) => {
      const li = document.createElement("li");
      li.className = "set";

      const move = document.createElement("div");
      move.className = "move";
      const up = document.createElement("button");
      up.textContent = "▲";
      up.title = "上へ";
      up.disabled = i === 0;
      up.addEventListener("click", () => moveSet(i, -1));
      const down = document.createElement("button");
      down.textContent = "▼";
      down.title = "下へ";
      down.disabled = i === sets.length - 1;
      down.addEventListener("click", () => moveSet(i, 1));
      move.append(up, down);

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
      bgBox.checked = set.background === true;
      bgBox.addEventListener("change", async () => {
        set.background = bgBox.checked;
        await storeSets(sets);
      });
      bg.append(bgBox, "バックグラウンドで開く");

      li.append(
        move,
        text,
        bg,
        iconButton(EDIT_ICON, "編集", "edit", () => openEditor(set)),
        confirmIconButton(DELETE_ICON, "削除", "もう一度で削除", () => deleteSet(set.id)),
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

async function moveSet(i, delta) {
  [sets[i], sets[i + delta]] = [sets[i + delta], sets[i]];
  await storeSets(sets);
  await renderMain();
}

async function deleteSet(id) {
  sets = sets.filter((s) => s.id !== id);
  await storeSets(sets);
  // このセットを割り当てていたスロットは空にする
  if (slots.some((t) => t?.type === "set" && t.id === id)) {
    slots = slots.map((t) => (t?.type === "set" && t.id === id ? null : t));
    await saveSlots(slots);
  }
  await renderMain();
}

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

let editing = null; // { id, selected: Set<bookmarkId>, missing: [{ url, title, checked }] }
let view = "tree"; // "tree" | "bar"。最後に使った表示を storage の editorView に覚える

// tree を引きやすくした索引。フォルダの子孫のブックマーク、各要素の祖先フォルダ(上から順)、フォルダ直下の要素
let descendantsOf = new Map(); // folderId -> bookmarkId[]
let ancestorsOf = new Map(); // id -> folderId[]
let childrenOf = new Map(); // folderId | null -> entry[](null は最上位のフォルダ)
let entryOf = new Map(); // id -> entry

function indexHierarchy() {
  descendantsOf = new Map();
  ancestorsOf = new Map();
  childrenOf = new Map([[null, []]]);
  entryOf = new Map();
  const stack = [];
  for (const e of tree) {
    while (stack.length && stack.at(-1).depth >= e.depth) stack.pop();
    ancestorsOf.set(e.id, stack.map((f) => f.id));
    childrenOf.get(stack.at(-1)?.id ?? null).push(e);
    entryOf.set(e.id, e);
    if (e.kind === "folder") {
      descendantsOf.set(e.id, []);
      childrenOf.set(e.id, []);
      stack.push(e);
    } else {
      for (const f of stack) descendantsOf.get(f.id).push(e.id);
    }
  }
}

async function openEditor(set) {
  indexHierarchy();
  editing = {
    id: set?.id ?? null,
    selected: new Set(set?.items.filter((item) => item.bookmarkId).map((item) => item.bookmarkId)),
    missing: (set?.items ?? []).filter((item) => !item.bookmarkId).map((item) => ({ ...item, checked: true })),
  };
  view = (await chrome.storage.local.get("editorView")).editorView === "bar" ? "bar" : "tree";
  $("editorTitle").textContent = set ? "セットを編集" : "新しいセット";
  $("setName").value = set?.name ?? "";
  $("bookmarkSearch").value = "";
  $("main").classList.add("hidden");
  $("editor").classList.remove("hidden");
  renderMissing();
  renderPicker();
  window.scrollTo(0, 0);
  $("setName").focus();
}

function closeEditor() {
  closeMenus(0);
  editing = null;
  $("editor").classList.add("hidden");
  $("main").classList.remove("hidden");
}

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

function hostOf(url) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

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
  editing.selected.has(id) ? editing.selected.delete(id) : editing.selected.add(id);
  syncSelection();
}

// まとめて選択する。全部選択済みなら全部解除する
function toggleAll(ids) {
  const all = ids.length > 0 && ids.every((id) => editing.selected.has(id));
  for (const id of ids) all ? editing.selected.delete(id) : editing.selected.add(id);
  syncSelection();
}

function bookmarkButton(e, className) {
  const b = pickButton(className, "bookmark", e.id, () => toggleBookmark(e.id));
  b.title = e.url;
  b.append(favicon(e.url), span("title", e.title || e.url), span("url", hostOf(e.url)));
  return b;
}

function renderMissing() {
  $("missingBlock").classList.toggle("hidden", editing.missing.length === 0);
  $("missing").replaceChildren(
    ...editing.missing.map((item, i) => {
      const li = document.createElement("li");
      const b = pickButton("node-btn", "missing", String(i), () => {
        item.checked = !item.checked;
        syncSelection();
      });
      b.title = item.url;
      b.append(favicon(item.url), span("title", item.title || item.url), span("url", item.url));
      li.append(b);
      return li;
    }),
  );
}

// 絞り込みに当たるブックマークの ID。絞り込んでいなければ null
function matchedIds() {
  const query = $("bookmarkSearch").value.trim().toLowerCase();
  if (!query) return null;
  return new Set(
    tree
      .filter((e) => e.kind === "bookmark" && (e.title.toLowerCase().includes(query) || e.url.toLowerCase().includes(query)))
      .map((e) => e.id),
  );
}

// ツリーのフォルダ行が操作する対象。絞り込み中は当たったものだけ
function targetsOf(folderId, matched) {
  const all = descendantsOf.get(folderId);
  return matched ? all.filter((id) => matched.has(id)) : all;
}

function renderPicker() {
  for (const tab of document.querySelectorAll(".view-tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === view));
  }
  // ブックマークバーに検索欄はないので、絞り込みはツリーでだけ使う
  $("bookmarkSearch").classList.toggle("hidden", view === "bar");
  if (view === "bar") renderBar();
  else renderTree();
  syncSelection();
}

// ツリー: フォルダ階層どおりに字下げして並べる。絞り込み中は当たったブックマークとその祖先フォルダだけを出す。
// フォルダの行を押すと、中のブックマーク(サブフォルダを含む)をまとめて選択/解除する。
function renderTree() {
  const matched = matchedIds();
  const visibleFolders = matched && new Set([...matched].flatMap((id) => ancestorsOf.get(id)));
  const rows = [];

  for (const e of tree) {
    if (matched && (e.kind === "bookmark" ? !matched.has(e.id) : !visibleFolders.has(e.id))) continue;

    const li = document.createElement("li");
    li.className = `node ${e.kind}`;
    li.style.paddingLeft = `${e.depth * 20}px`;

    if (e.kind === "folder") {
      const b = pickButton("node-btn folder", "folder", e.id, () => toggleAll(targetsOf(e.id, matchedIds())));
      b.title = "クリックで中のブックマークをまとめて選択/解除";
      b.insertAdjacentHTML("beforeend", FOLDER_SVG);
      b.append(span("title", e.title || "(名前なし)"), span("tally", ""));
      li.append(b);
    } else {
      li.append(bookmarkButton(e, "node-btn"));
    }
    rows.push(li);
  }

  const ul = document.createElement("ul");
  ul.className = "tree";
  ul.append(...rows);
  $("picker").replaceChildren(ul);
  $("pickerEmpty").classList.toggle("hidden", rows.length > 0);
}

// ブックマークバー: ブラウザ上部のブックマークバーをそのまま再現する。
// ブックマーク バー(id "1")の中身を横に並べ、ほかの最上位フォルダ(その他のブックマーク等)は右端に置く。
// 表示はブラウザと同じくファビコンとサイト名だけで、URL はマウスを乗せたときのツールチップに出す。
// ブックマークは押すと選択/解除。フォルダは押すとドロップダウンのメニューを開き、サブフォルダは右にサブメニューを出す。
// 本物のバーは入りきらない分を「»」にしまうが、ここでは全部見えるよう折り返す。
function renderBar() {
  closeMenus(0);
  const bar = document.createElement("div");
  bar.className = "bmbar";
  const items = document.createElement("div");
  items.className = "bmbar-items";
  for (const e of childrenOf.get("1") ?? []) items.append(barItem(e));
  const rest = document.createElement("div");
  rest.className = "bmbar-rest";
  for (const top of childrenOf.get(null)) if (top.id !== "1") rest.append(barItem(top));
  bar.append(items, rest);
  $("picker").replaceChildren(bar);
  $("pickerEmpty").classList.add("hidden");
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
  const open = () => openMenu(e.id, b, level);
  b.addEventListener("click", () => {
    // バーのフォルダは押すたびに開閉する。メニューの中のフォルダは開くだけ
    if (level === 0 && openMenus[0]?.folderId === e.id) closeMenus(0);
    else open();
  });
  // ブラウザと同じく、メニューの中ではマウスを乗せただけでサブメニューを開く。
  // バーの上でも、どれかのメニューを開いている間は乗せるだけで切り替える
  b.addEventListener("mouseenter", () => {
    if (level > 0 || (openMenus.length && openMenus[0].folderId !== e.id)) open();
  });
  return b;
}

let openMenus = []; // [{ folderId, el }] 階層の浅い順

function closeMenus(fromLevel) {
  for (const m of openMenus.splice(fromLevel)) m.el.remove();
  for (const b of document.querySelectorAll("[data-kind=folder-menu].open")) {
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
  const children = childrenOf.get(folderId);
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
  const ids = descendantsOf.get(folderId);
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
    // ボタンではなくバーの下端から出す(折り返して2段になっても下の段を隠さない)
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
  if (openMenus.length && !ev.target.closest(".bm-menu, .bm-chip.folder")) closeMenus(0);
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && openMenus.length) closeMenus(0);
});
window.addEventListener("scroll", () => closeMenus(0));
window.addEventListener("resize", () => closeMenus(0));

// 選択状態を見た目に反映する。描き直すとフォーカスやスクロールが飛ぶので、今ある要素のクラスだけを書き換える。
//   ブックマーク: 選択中は .selected(枠とハイライト)
//   ツリーのフォルダ: 全部選択で .selected、一部なら .partial(点線の枠)
//   バーとメニューのフォルダ: 中(サブフォルダを含む)に選択があれば .has-selected
//   メニューの「すべて選択」: 全部選択済みなら「すべて解除」に変える
function syncSelection() {
  const matched = matchedIds();
  const mark = (el, selected) => {
    el.classList.toggle("selected", selected);
    el.setAttribute("aria-pressed", String(selected));
  };
  for (const el of document.querySelectorAll("#editor [data-kind]")) {
    const { kind, id } = el.dataset;
    if (kind === "bookmark") {
      mark(el, editing.selected.has(id));
    } else if (kind === "missing") {
      mark(el, editing.missing[Number(id)].checked);
    } else if (kind === "folder-menu") {
      el.classList.toggle("has-selected", descendantsOf.get(id).some((t) => editing.selected.has(t)));
    } else if (kind === "select-all") {
      const ids = descendantsOf.get(id);
      const all = ids.every((t) => editing.selected.has(t));
      el.textContent = `${all ? "このフォルダをすべて解除" : "このフォルダをすべて選択"} (${ids.length})`;
    } else {
      const targets = targetsOf(id, matched);
      const n = targets.filter((t) => editing.selected.has(t)).length;
      const tally = el.querySelector(".tally");
      tally.textContent = n ? `${n} / ${targets.length}` : `${targets.length}`;
      tally.classList.toggle("active", n > 0);
      mark(el, n > 0 && n === targets.length);
      el.classList.toggle("partial", n > 0 && n < targets.length);
    }
  }
  updateEditorFooter();
}

function selectedItems() {
  // ブックマークは木の並び順、そのあとにブックマークにない項目を元の順で。同じ URL は1つにまとめる
  const items = [
    ...tree
      .filter((e) => e.kind === "bookmark" && editing.selected.has(e.id))
      .map((e) => ({ url: e.url, title: e.title, bookmarkId: e.id })),
    ...editing.missing.filter((item) => item.checked).map(({ url, title }) => ({ url, title, bookmarkId: null })),
  ];
  const seen = new Set();
  return items.filter((item) => !seen.has(item.url) && seen.add(item.url));
}

function updateEditorFooter() {
  const items = selectedItems();
  $("selectedCount").textContent = `${items.length} 件を選択中`;
  $("save").disabled = items.length === 0 || !$("setName").value.trim();
  renderSelectedList(items);
}

const REMOVE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// 選択中のブックマークの一覧(保存したときにセットに入るもの、開く順)。× で選択を外せる
function renderSelectedList(items) {
  $("selectedHeading").textContent = `選択中のブックマーク (${items.length})`;
  $("selectedEmpty").classList.toggle("hidden", items.length > 0);
  $("selectedList").replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.className = "sel-row";
      const remove = iconButton(REMOVE_ICON, "選択を外す", "danger", () => {
        if (item.bookmarkId) editing.selected.delete(item.bookmarkId);
        else editing.missing.find((m) => m.url === item.url).checked = false;
        syncSelection();
      });
      li.append(favicon(item.url), span("title", item.title || item.url), span("url", item.url), remove);
      if (!item.bookmarkId) li.querySelector(".title").after(span("tag", "ブックマークにない"));
      li.title = item.url;
      return li;
    }),
  );
}

$("selectedCount").addEventListener("click", () => {
  $("selectedSection").scrollIntoView({ behavior: "smooth", block: "start" });
});

for (const tab of document.querySelectorAll(".view-tab")) {
  tab.addEventListener("click", () => {
    view = tab.dataset.view;
    chrome.storage.local.set({ editorView: view });
    renderPicker();
  });
}

$("setName").addEventListener("input", updateEditorFooter);
$("bookmarkSearch").addEventListener("input", renderPicker);
$("cancel").addEventListener("click", closeEditor);

$("save").addEventListener("click", async () => {
  const set = {
    id: editing.id ?? crypto.randomUUID(),
    name: $("setName").value.trim(),
    background: sets.find((s) => s.id === editing.id)?.background === true,
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
