// USB/Bluetooth接続のバーコードリーダー（キーボードエミュレーション型・いわゆる「キーボードウェッジ」）からの
// 入力を検出する。この種のリーダーは数msおきに1文字ずつ猛スピードで打鍵し、最後に Enter を送信するのが一般的。
// 人間の実際のタイピングとの違いはキー入力の間隔（人間には出せないほど速い）で判定する。

const MAX_INTERVAL_MS = 80; // これより短い間隔で連続入力されたらリーダーからの入力とみなす
const RESET_GAP_MS = 500; // これ以上間隔が空いたらバッファをリセットする
const MIN_LENGTH = 6;
const MAX_LENGTH = 20;

let buffer = "";
let fastCount = 0;
let lastTime = 0;
let onScan = null;

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function reset() {
  buffer = "";
  fastCount = 0;
}

function handleKeydown(e) {
  // 通常の入力欄にフォーカスがある間は、そのフィールド自身の Enter ハンドリングに任せる
  // （リーダーで直接その欄に読み取らせているケース）ので、ここでは何もしない。
  if (isEditableTarget(document.activeElement)) { reset(); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) { reset(); return; }

  const now = performance.now();
  const interval = now - lastTime;
  lastTime = now;

  if (e.key === "Enter") {
    const candidate = buffer;
    const looksScanned = candidate.length >= MIN_LENGTH
      && candidate.length <= MAX_LENGTH
      && fastCount >= candidate.length - 1;
    reset();
    if (looksScanned) {
      e.preventDefault();
      e.stopPropagation();
      if (onScan) onScan(candidate);
    }
    return;
  }

  if (e.key.length !== 1) return; // Shift・Tabなどの制御キーは無視（バッファは崩さない）
  if (!/[0-9Xx-]/.test(e.key)) { reset(); return; }

  if (interval > RESET_GAP_MS) { buffer = ""; fastCount = 0; }
  else if (buffer.length > 0 && interval <= MAX_INTERVAL_MS) { fastCount += 1; }

  buffer += e.key;
  if (buffer.length > MAX_LENGTH) buffer = buffer.slice(-MAX_LENGTH);
}

/**
 * ハードウェアバーコードリーダーからの入力監視を開始する。
 * @param {(text: string) => void} callback 読み取り完了時に呼ばれる（生の読み取り文字列を渡す）
 */
export function initHardwareScanner(callback) {
  onScan = callback;
  document.addEventListener("keydown", handleKeydown, true);
}
