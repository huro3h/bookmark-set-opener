// 行のハンドル(.drag-handle)をつかんでリストの並びを変える。smart-keysmith と同じ方式。
// 行は data-key を持つ li。ハンドルだけを draggable にするので、行の中のボタンは普段どおり押せる。
// ドラッグ中は行を動かさず、離したときに入る位置を線(.drop-line)で示すだけにする。
// 離したときに並びが変わっていれば onReorder(keys) を呼ぶ。
// リスナーは行ではなくリスト側に置く — 行を作り直しても生き残るため。

// ドラッグ中にカーソルを画面の上端・下端へ寄せたときの自動スクロール。
// ブラウザ任せだと端のごく狭い範囲でしか動かず遅いので、広めの帯を取り、端へ寄せるほど速くする
const AUTO_SCROLL_ZONE = 64; // px。端からこの距離に入ったらスクロールし始める
const AUTO_SCROLL_MAX_SPEED = 18; // px / フレーム。いちばん端に寄せたときの速さ

function autoScrollSpeed(y) {
  const bottom = window.innerHeight;
  if (y < AUTO_SCROLL_ZONE) {
    return -AUTO_SCROLL_MAX_SPEED * Math.min(1, (AUTO_SCROLL_ZONE - y) / AUTO_SCROLL_ZONE);
  }
  if (y > bottom - AUTO_SCROLL_ZONE) {
    return AUTO_SCROLL_MAX_SPEED * Math.min(1, (y - (bottom - AUTO_SCROLL_ZONE)) / AUTO_SCROLL_ZONE);
  }
  return 0;
}

const rowsOf = (listEl) => [...listEl.querySelectorAll(":scope > li")];

// カーソルの高さより下にある行のうち、いちばん近いもの = 離したときに手前に入る行。null なら末尾。
// ドラッグ中の行も候補に含める — 元の位置に戻したとき、線がその行の上下どちらかの端に出るように
function rowAfter(listEl, y) {
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const row of rowsOf(listEl)) {
    const box = row.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: row };
  }
  return closest.element;
}

// 線を after の手前(null なら末尾)に引く。線はリストの中に絶対配置で重ねる
function showDropLine(listEl, line, after) {
  const rows = rowsOf(listEl);
  if (rows.length === 0) return;
  const last = rows[rows.length - 1];
  const y = after ? after.offsetTop : last.offsetTop + last.offsetHeight;
  line.style.top = `${y}px`;
  if (!line.isConnected) listEl.appendChild(line);
}

const keysOf = (listEl) => rowsOf(listEl).map((li) => li.dataset.key);

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
  let dropBefore = null; // 線の位置 = この行の手前に入る。null なら末尾
  let dropped = false;
  // 自動スクロール用。カーソルの位置はリストの外(見出しの上など)にいるときも拾う
  let pointerY = null;
  let lastDragoverAt = 0;
  let scrollFrame = 0;

  const line = document.createElement("div");
  line.className = "drop-line";

  function autoScrollStep() {
    scrollFrame = 0;
    if (!dragging) return;
    // dragover は止まっていても数十 ms おきに来る。来なくなった = ウィンドウの外に出たので止める
    if (pointerY != null && performance.now() - lastDragoverAt < 200) {
      const speed = autoScrollSpeed(pointerY);
      const scroller = document.scrollingElement;
      const before = scroller.scrollTop;
      if (speed !== 0) scroller.scrollTop += speed;
      // 行がカーソルの下を流れていくので、線も追いかけて引き直す
      if (scroller.scrollTop !== before && line.isConnected) {
        dropBefore = rowAfter(listEl, pointerY);
        showDropLine(listEl, line, dropBefore);
      }
    }
    scrollFrame = requestAnimationFrame(autoScrollStep);
  }

  document.addEventListener("dragover", (event) => {
    if (!dragging) return;
    pointerY = event.clientY;
    lastDragoverAt = performance.now();
  });

  listEl.addEventListener("dragstart", (event) => {
    const h = event.target.closest?.(".drag-handle");
    if (!h) return;
    dragging = h.closest("li");
    dropBefore = dragging.nextElementSibling;
    dropped = false;
    pointerY = null;
    dragging.classList.add("dragging");
    if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScrollStep);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragging.dataset.key);
  });

  listEl.addEventListener("dragover", (event) => {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    dropBefore = rowAfter(listEl, event.clientY);
    showDropLine(listEl, line, dropBefore);
  });

  // リストの外へ出たら線を消す(そこで離しても並びは変わらないので)。
  // 子要素をまたぐたびにも dragleave が来るので、行き先がリストの中なら無視する
  listEl.addEventListener("dragleave", (event) => {
    if (!dragging || listEl.contains(event.relatedTarget)) return;
    line.remove();
  });

  listEl.addEventListener("drop", (event) => {
    if (!dragging) return;
    event.preventDefault();
    dropped = true;
  });

  // リストの外で離した・Esc で取り消したときは drop が来ないので、並びを変えない
  listEl.addEventListener("dragend", () => {
    if (!dragging) return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    line.remove();
    dragging.classList.remove("dragging");
    const moved = dragging;
    dragging = null;
    if (!dropped || dropBefore === moved || dropBefore === moved.nextElementSibling) return;
    if (dropBefore == null) listEl.appendChild(moved);
    else listEl.insertBefore(moved, dropBefore);
    onReorder(keysOf(listEl));
  });
}
