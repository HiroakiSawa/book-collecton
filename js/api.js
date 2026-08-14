// ISBN から書誌情報を取得する。openBD を優先し、見つからなければ Google Books にフォールバックする。

export function normalizeIsbn(raw) {
  return String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

/**
 * QRコードなど、ISBN単体とは限らないテキスト（URLなどを含む）からISBNらしき文字列を抽出する。
 * バーコード（EAN-13）はデコード結果がそのまま数字列になるが、QRコードは
 * 「https://example.com/isbn/978...」のようにISBNの前後に別の文字列が付くことがあるため、
 * テキスト中から数字・ハイフン主体のまとまりを探し、ISBN-13/ISBN-10として妥当なものを返す。
 * @param {string} text
 * @returns {string|null} 正規化済みのISBN、見つからなければ null
 */
export function extractIsbnFromText(text) {
  if (!text) return null;
  const raw = String(text);
  // 数字・ハイフン・スペース・Xで構成された、ある程度の長さのまとまりを候補として抽出する
  const segments = raw.match(/[0-9][0-9Xx \-]{7,}[0-9Xx]/g) || [raw];
  for (const segment of segments) {
    const normalized = normalizeIsbn(segment);
    if (normalized.length === 13 && /^97[89]/.test(normalized)) return normalized;
    if (normalized.length === 10) return normalized;
  }
  return null;
}

async function fetchOpenBD(isbn) {
  const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn)}`);
  if (!res.ok) throw new Error(`openBD HTTP ${res.status}`);
  const data = await res.json();
  const entry = Array.isArray(data) ? data[0] : null;
  if (!entry) return null;

  const summary = entry.summary || {};
  const authors = summary.author || "";

  let publisher = summary.publisher || "";
  let pubdate = summary.pubdate || "";
  // より詳細な情報が onix にあれば補完する
  try {
    const desc = entry.onix?.DescriptiveDetail;
    const pub = entry.onix?.PublishingDetail;
    if (!publisher && pub?.Imprint?.ImprintName) publisher = pub.Imprint.ImprintName;
    if (!publisher && pub?.Publisher?.PublisherName) publisher = pub.Publisher.PublisherName;
  } catch { /* onix は無くてもよい */ }

  const hasData = summary.title || authors || publisher || pubdate || summary.cover;
  if (!hasData) return null;

  return {
    isbn,
    title: summary.title || "",
    author: authors || "",
    publisher: publisher || "",
    pubdate: pubdate || "",
    coverUrl: summary.cover || "",
    source: "openBD",
  };
}

async function fetchGoogleBooks(isbn) {
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`);
  if (!res.ok) throw new Error(`GoogleBooks HTTP ${res.status}`);
  const data = await res.json();
  const item = data.items && data.items[0];
  if (!item) return null;
  const info = item.volumeInfo || {};
  const hasData = info.title || (info.authors && info.authors.length) || info.publisher || info.publishedDate;
  if (!hasData) return null;

  let coverUrl = "";
  if (info.imageLinks) {
    coverUrl = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || "";
    coverUrl = coverUrl.replace(/^http:/, "https:");
  }

  return {
    isbn,
    title: info.title || "",
    author: (info.authors || []).join(", "),
    publisher: info.publisher || "",
    pubdate: info.publishedDate || "",
    coverUrl,
    source: "GoogleBooks",
  };
}

/**
 * ISBN をキーに書誌情報を検索する。
 * @param {string} rawIsbn
 * @returns {Promise<{found: boolean, data: object|null, error?: string}>}
 */
export async function lookupIsbn(rawIsbn) {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn) {
    return { found: false, data: null, error: "ISBNが入力されていません。" };
  }

  let openBDError = null;
  try {
    const openBDResult = await fetchOpenBD(isbn);
    if (openBDResult) return { found: true, data: openBDResult };
  } catch (err) {
    openBDError = err;
  }

  try {
    const googleResult = await fetchGoogleBooks(isbn);
    if (googleResult) return { found: true, data: googleResult };
  } catch (err) {
    if (openBDError) {
      return { found: false, data: null, error: "書誌情報の取得に失敗しました（通信エラー）。手入力してください。" };
    }
  }

  return { found: false, data: null, error: "該当する書誌情報が見つかりませんでした。手入力してください。" };
}
