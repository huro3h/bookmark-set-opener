import { loadSets } from "./sets.js";
import { getSettings } from "./settings.js";

// これ以上のタブを一度に開くときは、もう一度押してもらう(Chrome の「すべて開く」も確認を挟む)
const CONFIRM_THRESHOLD = 20;

const listEl = document.getElementById("setList");
const hintEl = document.getElementById("setHint");
const statusEl = document.getElementById("status");

let sets = [];
let keyOf = new Map(); // セットの id -> 割り当てたショートカットキー(キー未設定のスロットは含めない)

const SET_SVG = `<svg class="row-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
  <path d="M4 8.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2V21l-5.5-3.6L4 21z M8.5 2.5H18a2 2 0 0 1 2 2V17"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function rowElement(set) {
  const count = set.items.length;
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row";
  button.dataset.id = set.id;
  button.disabled = count === 0;
  button.innerHTML = SET_SVG;

  const text = document.createElement("span");
  text.className = "text";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = set.name || "(名前なし)";
  text.append(name);
  button.append(text);

  const key = keyOf.get(set.id);
  if (key) {
    const badge = document.createElement("kbd");
    badge.className = "key";
    badge.textContent = key;
    badge.title = "このキーでも開けます";
    button.append(badge);
  }
  const countEl = document.createElement("span");
  countEl.className = "count";
  countEl.textContent = count;
  button.append(countEl);

  button.addEventListener("click", () => onClick(button, set));
  li.append(button);
  return li;
}

function render() {
  listEl.replaceChildren(...sets.map(rowElement));
  // セットが1つもないときは作り方の案内を出す
  hintEl.classList.toggle("hidden", sets.length > 0);
}

function onClick(button, set) {
  const count = set.items.length;
  if (count >= CONFIRM_THRESHOLD && !button.classList.contains("confirm")) {
    button.classList.add("confirm");
    button.querySelector(".name").textContent = `${count} 個のタブを開きます。もう一度クリック`;
    setTimeout(() => {
      button.classList.remove("confirm");
      button.querySelector(".name").textContent = set.name;
    }, 3000);
    return;
  }
  open(set);
}

async function open(set) {
  statusEl.textContent = "";
  const res = await chrome.runtime.sendMessage({ type: "open", target: { type: "set", id: set.id } });
  if (!res?.ok) {
    statusEl.textContent = `開けませんでした: ${res?.error ?? "不明なエラー"}`;
    return;
  }
  window.close();
}

function openSettings() {
  chrome.runtime.openOptionsPage();
  window.close();
}
document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;
document.getElementById("settings").addEventListener("click", openSettings);
document.getElementById("createSet").addEventListener("click", openSettings);

async function load() {
  let slots, commands;
  [sets, { slots }, commands] = await Promise.all([loadSets(), getSettings(), chrome.commands.getAll()]);
  // コマンド名は "01_open_slot" 〜 "03_open_slot"。キー未設定なら shortcut は空文字
  const shortcutOf = new Map(commands.map((c) => [c.name, c.shortcut]));
  keyOf = new Map(
    slots.flatMap((t, i) => {
      const key = shortcutOf.get(`0${i + 1}_open_slot`);
      return t?.type === "set" && key ? [[t.id, key]] : [];
    }),
  );
  render();
}

load();
