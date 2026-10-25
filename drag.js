// 行のハンドル(.drag-handle)をつかんでリストの並びを変える。smart-keysmith と同じ方式。
// 行は data-key を持つ li。ハンドルだけを draggable にするので、行の中のボタンは普段どおり押せる。
// ドラッグ中は行そのものを DOM の中で動かし、離したときに並びが変わっていれば onReorder(keys) を呼ぶ。
// リスナーは行ではなくリスト側に置く — 行を作り直しても生き残るため。

// カーソルの高さより下にある行のうち、いちばん近いもの。null なら末尾
function rowAfter(listEl, y) {
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const row of listEl.querySelectorAll(":scope > li:not(.dragging)")) {
    const box = row.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: row };
  }
  return closest.element;
}

const keysOf = (listEl) => [...listEl.children].map((li) => li.dataset.key);

export function handle() {
  const h = document.createElement("span");
  h.className = "drag-handle";
  h.textContent = "⠿";
  h.title = "ドラッグして並べ替え";
  h.setAttribute("draggable", "true");
  return h;
}

export function enableDragReorder(listEl, onReorder) {
  let dragging = null;
  let before = null;

  listEl.addEventListener("dragstart", (event) => {
    const h = event.target.closest?.(".drag-handle");
    if (!h) return;
    dragging = h.closest("li");
    before = keysOf(listEl);
    dragging.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragging.dataset.key);
  });

  listEl.addEventListener("dragover", (event) => {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const after = rowAfter(listEl, event.clientY);
    if (after == null) listEl.appendChild(dragging);
    else if (after !== dragging) listEl.insertBefore(dragging, after);
  });

  listEl.addEventListener("drop", (event) => {
    if (dragging) event.preventDefault();
  });

  listEl.addEventListener("dragend", () => {
    if (!dragging) return;
    dragging.classList.remove("dragging");
    dragging = null;
    const keys = keysOf(listEl);
    if (keys.some((k, i) => k !== before[i])) onReorder(keys);
  });
}
