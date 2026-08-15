import * as db from "./db.js";
import { lookupIsbn, normalizeIsbn, searchByKeyword } from "./api.js";
import { startScanner, stopScanner, isCameraSupported } from "./scanner.js";
import { toCSV, toJSON, fromCSV, fromJSON, downloadTextFile } from "./csv.js";
import { initHardwareScanner } from "./hardwareScanner.js";

// ---------- 状態 ----------
let allBooks = [];
let searchTerm = "";
let sortKey = "createdAt-desc";
let editingIsbnOriginal = null; // 編集中に登録済みISBNの重複判定を行うための元ISBN

// ---------- 要素取得 ----------
const $ = (id) => document.getElementById(id);

const els = {
  searchInput: $("search-input"),
  sortSelect: $("sort-select"),
  btnScanCamera: $("btn-scan-camera"),
  btnScanReader: $("btn-scan-reader"),
  btnManual: $("btn-manual"),
  btnIsbnSearch: $("btn-isbn-search"),
  btnExport: $("btn-export"),
  btnImport: $("btn-import"),
  exportFormat: $("export-format"),
  importFile: $("import-file"),
  bookCount: $("book-count"),
  emptyState: $("empty-state"),
  bookGrid: $("book-grid"),

  scanModal: $("scan-modal"),
  scanModalTitle: $("scan-modal-title"),
  scanReaderView: $("scan-reader"),
  scanStatus: $("scan-status"),
  scanUnsupported: $("scan-unsupported"),

  bookModal: $("book-modal"),
  bookModalTitle: $("book-modal-title"),
  bookForm: $("book-form"),
  fId: $("f-id"),
  fCoverPreview: $("f-cover-preview"),
  fCoverFile: $("f-cover-file"),
  fCoverClear: $("f-cover-clear"),
  fCoverUrl: $("f-cover-url"),
  fIsbn: $("f-isbn"),
  fIsbnLookup: $("f-isbn-lookup"),
  fDuplicateWarning: $("f-duplicate-warning"),
  fKeywordSearch: $("f-keyword-search"),
  fTitle: $("f-title"),
  fAuthor: $("f-author"),
  fPublisher: $("f-publisher"),
  fPubdate: $("f-pubdate"),
  fMemo: $("f-memo"),
  fStatus: $("f-status"),
  fDelete: $("f-delete"),

  isbnSearchModal: $("isbn-search-modal"),
  isbnSearchInput: $("isbn-search-input"),
  isbnSearchBtn: $("isbn-search-btn"),
  isbnSearchStatus: $("isbn-search-status"),

  keywordModal: $("keyword-modal"),
  keywordInput: $("keyword-input"),
  keywordSearchBtn: $("keyword-search-btn"),
  keywordStatus: $("keyword-status"),
  keywordResults: $("keyword-results"),

  detailModal: $("detail-modal"),
  dCover: $("d-cover"),
  dTitle: $("d-title"),
  dAuthor: $("d-author"),
  dPublisher: $("d-publisher"),
  dPubdate: $("d-pubdate"),
  dIsbn: $("d-isbn"),
  dMemo: $("d-memo"),
  dCreatedAt: $("d-createdAt"),
  dDelete: $("d-delete"),
  dEdit: $("d-edit"),

  toast: $("toast"),
};

let currentDetailId = null;

// ---------- ユーティリティ ----------
function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

function openModal(dialog) { if (!dialog.open) dialog.showModal(); }
function closeModal(dialog) { if (dialog.open) dialog.close(); }

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = $(btn.dataset.close);
    if (target.id === "scan-modal") stopScanner();
    closeModal(target);
  });
});
document.querySelectorAll("dialog").forEach((dlg) => {
  dlg.addEventListener("cancel", () => { if (dlg.id === "scan-modal") stopScanner(); });
  dlg.addEventListener("click", (e) => {
    // 背景クリックで閉じる
    const rect = dlg.querySelector(".modal-content").getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) {
      if (dlg.id === "scan-modal") stopScanner();
      dlg.close();
    }
  });
});

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch { return iso; }
}

const SOURCE_LABELS = { openBD: "openBD", GoogleBooks: "Google Books", OpenLibrary: "Open Library" };
function sourceLabel(source) { return SOURCE_LABELS[source] || source || "不明"; }

// ---------- データ読み込み・描画 ----------
async function loadBooks() {
  try {
    allBooks = await db.getAllBooks();
  } catch (err) {
    allBooks = [];
    showToast("データの読み込みに失敗しました。この端末では保存機能が利用できない可能性があります。", true);
  }
  render();
}

function getFilteredSortedBooks() {
  let books = allBooks;
  const term = searchTerm.trim().toLowerCase();
  if (term) {
    books = books.filter((b) =>
      (b.title || "").toLowerCase().includes(term) ||
      (b.author || "").toLowerCase().includes(term)
    );
  }
  const [key, dir] = sortKey.split("-");
  const sorted = [...books].sort((a, b) => {
    let av = a[key] || "";
    let bv = b[key] || "";
    if (key === "createdAt") { av = av || ""; bv = bv || ""; }
    let cmp = String(av).localeCompare(String(bv), "ja");
    return dir === "desc" ? -cmp : cmp;
  });
  return sorted;
}

function bookCoverMarkup(book) {
  const src = book.coverUrl || book.coverData;
  if (src) {
    return `<img src="${escapeAttr(src)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;book-cover-placeholder&quot;>📕</div>'">`;
  }
  return `<div class="book-cover-placeholder">📕</div>`;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

function render() {
  const books = getFilteredSortedBooks();
  els.bookCount.textContent = `${allBooks.length} 冊登録済み${searchTerm ? `（検索結果 ${books.length} 件）` : ""}`;
  els.emptyState.hidden = allBooks.length !== 0;
  els.bookGrid.innerHTML = books.map((book) => `
    <li>
      <button type="button" class="book-list-item" data-id="${escapeAttr(book.id)}">
        <div class="book-cover-wrap">${bookCoverMarkup(book)}</div>
        <div class="book-info">
          <p class="book-title">${escapeHtml(book.title || "（タイトル未設定）")}</p>
          <p class="book-author">${escapeHtml(book.author || "")}</p>
          ${book.memo ? `<p class="book-memo">📝 ${escapeHtml(book.memo)}</p>` : ""}
        </div>
      </button>
    </li>
  `).join("");

  els.bookGrid.querySelectorAll(".book-list-item").forEach((item) => {
    item.addEventListener("click", () => openDetail(item.dataset.id));
  });
}

// ---------- 検索・並び替え ----------
els.searchInput.addEventListener("input", (e) => { searchTerm = e.target.value; render(); });
els.sortSelect.addEventListener("change", (e) => { sortKey = e.target.value; render(); });

// ---------- スキャン（カメラ / バーコードリーダー） ----------
els.btnScanCamera.addEventListener("click", () => openCameraScan());
els.btnScanReader.addEventListener("click", () => openReaderScan());

async function openCameraScan() {
  els.scanModalTitle.textContent = "カメラで読み取り";
  els.scanReaderView.hidden = false;
  els.scanStatus.hidden = false;
  els.scanUnsupported.hidden = true;
  els.scanStatus.textContent = "本の裏表紙のISBNバーコードをカメラに向けてください。";
  openModal(els.scanModal);

  if (!isCameraSupported()) {
    els.scanUnsupported.hidden = false;
    els.scanStatus.hidden = true;
    return;
  }

  const ok = await startScanner("scan-reader", onCameraDetected, (errMsg) => {
    els.scanUnsupported.hidden = false;
    els.scanUnsupported.textContent = `カメラを起動できませんでした：${errMsg}`;
    els.scanStatus.hidden = true;
  });
  if (!ok) return;
}

function openReaderScan() {
  els.scanModalTitle.textContent = "バーコードリーダーで読み取り";
  els.scanReaderView.hidden = true;
  els.scanUnsupported.hidden = true;
  els.scanStatus.hidden = false;
  els.scanStatus.textContent = "バーコードリーダーでISBNバーコードを読み取ってください。読み取ると自動的にこの画面が閉じ、書誌情報を検索します。";
  openModal(els.scanModal);
}

let handlingDetection = false;
async function onCameraDetected(text) {
  if (handlingDetection) return;
  handlingDetection = true;
  const isbn = normalizeIsbn(text);
  els.scanStatus.textContent = `検出しました: ${isbn}　書誌情報を検索中...`;
  await stopScanner();
  closeModal(els.scanModal);

  await handleIsbnCaptured(isbn);
  handlingDetection = false;
}

// USB/Bluetoothバーコードリーダー（キーボードエミュレーション型）からの読み取り。
// カメラの起動状態に関わらず、他のダイアログが開いていない/入力欄にフォーカスがない状態であれば
// どの画面からでもそのままスキャンして登録フローに入れる。
async function onHardwareScan(rawText) {
  if (handlingDetection) return;
  handlingDetection = true;
  const isbn = normalizeIsbn(rawText);

  if (els.scanModal.open) {
    els.scanStatus.textContent = `検出しました: ${isbn}　書誌情報を検索中...`;
    await stopScanner();
  }
  document.querySelectorAll("dialog[open]").forEach((dlg) => closeModal(dlg));

  await handleIsbnCaptured(isbn);
  handlingDetection = false;
}
initHardwareScanner(onHardwareScan);

async function handleIsbnCaptured(isbn) {
  const existing = await db.findByIsbn(isbn);
  if (existing) {
    showToast(`この ISBN は既に登録されています：「${existing.title}」`, true);
    openDetail(existing.id);
    return;
  }

  showToast("書誌情報を検索中...");
  const result = await lookupIsbn(isbn);
  if (result.found) {
    openBookForm({ isbn, ...result.data });
    showToast(`書誌情報を取得しました（${sourceLabel(result.data.source)}）。内容を確認して保存してください。`);
  } else {
    openBookForm({ isbn });
    showToast(result.error || "書誌情報が見つかりませんでした。手入力してください。", true);
  }
}

// ---------- ISBN手入力検索 ----------
els.btnIsbnSearch.addEventListener("click", () => {
  els.isbnSearchInput.value = "";
  els.isbnSearchStatus.textContent = "";
  openModal(els.isbnSearchModal);
  setTimeout(() => els.isbnSearchInput.focus(), 50);
});

els.isbnSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); els.isbnSearchBtn.click(); }
});

els.isbnSearchBtn.addEventListener("click", async () => {
  const isbn = normalizeIsbn(els.isbnSearchInput.value);
  if (!isbn) { els.isbnSearchStatus.textContent = "ISBNを入力してください。"; return; }
  els.isbnSearchStatus.textContent = "検索中...";

  const existing = await db.findByIsbn(isbn);
  if (existing) {
    els.isbnSearchStatus.textContent = "";
    closeModal(els.isbnSearchModal);
    showToast(`この ISBN は既に登録されています：「${existing.title}」`, true);
    openDetail(existing.id);
    return;
  }

  const result = await lookupIsbn(isbn);
  closeModal(els.isbnSearchModal);
  if (result.found) {
    openBookForm({ isbn, ...result.data });
    showToast(`書誌情報を取得しました（${sourceLabel(result.data.source)}）。内容を確認して保存してください。`);
  } else {
    openBookForm({ isbn });
    showToast(result.error || "書誌情報が見つかりませんでした。手入力してください。", true);
  }
});

// ---------- 手入力で登録 ----------
els.btnManual.addEventListener("click", () => openBookForm(null));

// ---------- 書籍フォーム ----------
function resetBookForm() {
  els.bookForm.reset();
  els.fId.value = "";
  els.fCoverPreview.removeAttribute("src");
  els.fCoverPreview.style.display = "none";
  els.fDuplicateWarning.hidden = true;
  els.fStatus.textContent = "";
  els.fDelete.hidden = true;
  editingIsbnOriginal = null;
}

function openBookForm(prefill) {
  resetBookForm();
  if (prefill && prefill.id) {
    els.bookModalTitle.textContent = "本を編集";
    els.fDelete.hidden = false;
    editingIsbnOriginal = prefill.isbn || null;
  } else {
    els.bookModalTitle.textContent = "本を登録";
  }
  if (prefill) {
    els.fId.value = prefill.id || "";
    els.fIsbn.value = prefill.isbn || "";
    els.fTitle.value = prefill.title || "";
    els.fAuthor.value = prefill.author || "";
    els.fPublisher.value = prefill.publisher || "";
    els.fPubdate.value = prefill.pubdate || "";
    els.fMemo.value = prefill.memo || "";
    const cover = prefill.coverUrl || prefill.coverData || "";
    if (cover) {
      if (cover.startsWith("data:")) { els.fCoverUrl.value = ""; }
      else { els.fCoverUrl.value = cover; }
      setCoverPreview(cover);
    }
  }
  checkDuplicateIsbn();
  openModal(els.bookModal);
  setTimeout(() => els.fTitle.focus(), 50);
}

function setCoverPreview(src) {
  if (!src) {
    els.fCoverPreview.removeAttribute("src");
    els.fCoverPreview.style.display = "none";
    return;
  }
  els.fCoverPreview.src = src;
  els.fCoverPreview.style.display = "block";
}

els.fCoverUrl.addEventListener("input", () => {
  els.fCoverFile.value = "";
  setCoverPreview(els.fCoverUrl.value.trim());
});

els.fCoverFile.addEventListener("change", () => {
  const file = els.fCoverFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    els.fCoverUrl.value = "";
    setCoverPreview(reader.result);
  };
  reader.readAsDataURL(file);
});

els.fCoverClear.addEventListener("click", () => {
  els.fCoverFile.value = "";
  els.fCoverUrl.value = "";
  setCoverPreview("");
});

async function checkDuplicateIsbn() {
  const isbn = normalizeIsbn(els.fIsbn.value);
  if (!isbn) { els.fDuplicateWarning.hidden = true; return; }
  if (isbn === editingIsbnOriginal) { els.fDuplicateWarning.hidden = true; return; }
  const existing = await db.findByIsbn(isbn);
  const currentId = els.fId.value;
  els.fDuplicateWarning.hidden = !(existing && existing.id !== currentId);
}
els.fIsbn.addEventListener("blur", checkDuplicateIsbn);
els.fIsbn.addEventListener("input", () => { els.fDuplicateWarning.hidden = true; });
// バーコードリーダーがこの欄にフォーカスした状態で直接読み取らせた場合、末尾のEnterで検索を実行する
els.fIsbn.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); els.fIsbnLookup.click(); }
});

els.fIsbnLookup.addEventListener("click", async () => {
  const isbn = normalizeIsbn(els.fIsbn.value);
  if (!isbn) { els.fStatus.textContent = "ISBNを入力してください。"; return; }
  els.fStatus.textContent = "検索中...";
  const result = await lookupIsbn(isbn);
  if (result.found) {
    const data = result.data;
    if (data.title) els.fTitle.value = data.title;
    if (data.author) els.fAuthor.value = data.author;
    if (data.publisher) els.fPublisher.value = data.publisher;
    if (data.pubdate) els.fPubdate.value = data.pubdate;
    if (data.coverUrl) { els.fCoverUrl.value = data.coverUrl; setCoverPreview(data.coverUrl); }
    els.fStatus.textContent = `取得しました（${sourceLabel(data.source)}）。`;
  } else {
    els.fStatus.textContent = result.error || "見つかりませんでした。手入力してください。";
  }
  checkDuplicateIsbn();
});

// ---------- 書名・著者キーワード検索（ISBNで見つからない洋書などの代替手段） ----------
let keywordResultsCache = [];

els.fKeywordSearch.addEventListener("click", () => {
  els.keywordInput.value = els.fTitle.value.trim();
  els.keywordStatus.textContent = "";
  els.keywordResults.innerHTML = "";
  keywordResultsCache = [];
  openModal(els.keywordModal);
  setTimeout(() => els.keywordInput.focus(), 50);
});

els.keywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); els.keywordSearchBtn.click(); }
});

els.keywordSearchBtn.addEventListener("click", async () => {
  const query = els.keywordInput.value.trim();
  if (!query) { els.keywordStatus.textContent = "検索キーワードを入力してください。"; return; }

  els.keywordStatus.textContent = "検索中...";
  els.keywordResults.innerHTML = "";
  let results = [];
  try {
    results = await searchByKeyword(query);
  } catch {
    els.keywordStatus.textContent = "検索に失敗しました（通信エラー）。もう一度お試しください。";
    return;
  }
  keywordResultsCache = results;

  if (results.length === 0) {
    els.keywordStatus.textContent = "候補が見つかりませんでした。キーワードを変えてお試しください。";
    return;
  }
  els.keywordStatus.textContent = `${results.length} 件見つかりました。選択してください。`;
  els.keywordResults.innerHTML = results.map((r, i) => `
    <li>
      <button type="button" class="keyword-result" data-index="${i}">
        ${r.coverUrl
          ? `<img class="keyword-result-cover" src="${escapeAttr(r.coverUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'keyword-result-cover-placeholder',textContent:'📕'}))">`
          : `<div class="keyword-result-cover-placeholder">📕</div>`}
        <div class="keyword-result-info">
          <p class="keyword-result-title">${escapeHtml(r.title)}</p>
          <p class="keyword-result-meta">${escapeHtml(r.author || "著者不明")}</p>
          <p class="keyword-result-meta">${escapeHtml([r.publisher, r.pubdate].filter(Boolean).join(" / ") || sourceLabel(r.source))}</p>
        </div>
      </button>
    </li>
  `).join("");

  els.keywordResults.querySelectorAll(".keyword-result").forEach((btn) => {
    btn.addEventListener("click", () => selectKeywordResult(keywordResultsCache[Number(btn.dataset.index)]));
  });
});

function selectKeywordResult(candidate) {
  if (!candidate) return;
  if (candidate.title) els.fTitle.value = candidate.title;
  if (candidate.author) els.fAuthor.value = candidate.author;
  if (candidate.publisher) els.fPublisher.value = candidate.publisher;
  if (candidate.pubdate) els.fPubdate.value = candidate.pubdate;
  if (candidate.isbn) els.fIsbn.value = candidate.isbn;
  if (candidate.coverUrl) { els.fCoverUrl.value = candidate.coverUrl; setCoverPreview(candidate.coverUrl); }
  els.fStatus.textContent = `候補を反映しました（${sourceLabel(candidate.source)}）。内容を確認して保存してください。`;
  closeModal(els.keywordModal);
  checkDuplicateIsbn();
}

els.bookForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = els.fTitle.value.trim();
  if (!title) { els.fStatus.textContent = "書名は必須です。"; els.fTitle.focus(); return; }

  const id = els.fId.value || db.makeId();
  const isExisting = !!els.fId.value;
  let createdAt = new Date().toISOString();
  if (isExisting) {
    const existing = await db.getBook(id);
    if (existing) createdAt = existing.createdAt;
  }

  const cover = els.fCoverPreview.style.display !== "none" ? els.fCoverPreview.src : "";

  const book = {
    id,
    isbn: normalizeIsbn(els.fIsbn.value),
    title,
    author: els.fAuthor.value.trim(),
    publisher: els.fPublisher.value.trim(),
    pubdate: els.fPubdate.value.trim(),
    memo: els.fMemo.value.trim(),
    coverUrl: cover,
    createdAt,
  };

  try {
    await db.saveBook(book);
    showToast(isExisting ? "更新しました。" : "登録しました。");
    closeModal(els.bookModal);
    await loadBooks();
  } catch (err) {
    els.fStatus.textContent = "保存に失敗しました：" + (err && err.message ? err.message : err);
  }
});

els.fDelete.addEventListener("click", async () => {
  const id = els.fId.value;
  if (!id) return;
  if (!confirm("この本を削除しますか？")) return;
  await db.deleteBook(id);
  closeModal(els.bookModal);
  showToast("削除しました。");
  await loadBooks();
});

// ---------- 詳細表示 ----------
async function openDetail(id) {
  const book = await db.getBook(id);
  if (!book) { showToast("本が見つかりませんでした。", true); return; }
  currentDetailId = id;
  const cover = book.coverUrl || book.coverData;
  if (cover) { els.dCover.src = cover; els.dCover.style.display = "block"; }
  else { els.dCover.removeAttribute("src"); els.dCover.style.display = "none"; }
  els.dTitle.textContent = book.title || "（タイトル未設定）";
  els.dAuthor.textContent = book.author || "-";
  els.dPublisher.textContent = book.publisher || "-";
  els.dPubdate.textContent = book.pubdate || "-";
  els.dIsbn.textContent = book.isbn || "-";
  els.dMemo.textContent = book.memo || "-";
  els.dCreatedAt.textContent = formatDate(book.createdAt);
  openModal(els.detailModal);
}

els.dEdit.addEventListener("click", async () => {
  const book = await db.getBook(currentDetailId);
  closeModal(els.detailModal);
  openBookForm(book);
});

els.dDelete.addEventListener("click", async () => {
  if (!currentDetailId) return;
  if (!confirm("この本を削除しますか？")) return;
  await db.deleteBook(currentDetailId);
  closeModal(els.detailModal);
  showToast("削除しました。");
  await loadBooks();
});

// ---------- エクスポート / インポート ----------
els.btnExport.addEventListener("click", () => {
  if (allBooks.length === 0) { showToast("エクスポートする本がありません。", true); return; }
  const format = els.exportFormat.value;
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    downloadTextFile(`books-${stamp}.csv`, toCSV(allBooks), "text/csv;charset=utf-8");
  } else {
    downloadTextFile(`books-${stamp}.json`, toJSON(allBooks), "application/json;charset=utf-8");
  }
  showToast("エクスポートしました。");
});

els.btnImport.addEventListener("click", () => els.importFile.click());

els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files[0];
  els.importFile.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    let records;
    if (file.name.toLowerCase().endsWith(".csv")) {
      records = fromCSV(text);
    } else {
      records = fromJSON(text);
    }

    const normalized = records
      .filter((r) => (r.title || "").toString().trim())
      .map((r) => ({
        id: r.id && String(r.id).trim() ? String(r.id) : db.makeId(),
        isbn: normalizeIsbn(r.isbn),
        title: String(r.title || "").trim(),
        author: String(r.author || "").trim(),
        publisher: String(r.publisher || "").trim(),
        pubdate: String(r.pubdate || "").trim(),
        memo: String(r.memo || "").trim(),
        coverUrl: String(r.coverUrl || r.coverData || "").trim(),
        createdAt: r.createdAt && !Number.isNaN(new Date(r.createdAt).getTime())
          ? new Date(r.createdAt).toISOString()
          : new Date().toISOString(),
      }));

    if (normalized.length === 0) { showToast("インポートできるデータがありませんでした。", true); return; }

    await db.bulkPut(normalized);
    await loadBooks();
    showToast(`${normalized.length} 件インポートしました。`);
  } catch (err) {
    showToast("インポートに失敗しました：" + (err && err.message ? err.message : err), true);
  }
});

// ---------- 初期化 ----------
(async function init() {
  const ok = await db.isStorageAvailable();
  if (!ok) {
    showToast("この端末では保存機能が利用できません。手入力で内容を確認することはできますが、保存されません。", true);
  }
  await loadBooks();
})();
