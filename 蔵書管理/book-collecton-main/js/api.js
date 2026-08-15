// ISBN・キーワードから書誌情報を取得する。
// ISBN検索：openBD（日本の書籍）→ Google Books → Open Library の順にフォールバックする。
// openBDは日本国内の書籍に特化しているため洋書はほぼヒットしない。Google Books / Open Library は
// どちらも洋書を含む海外の書誌データを持っているが、どちらか一方だけでは網羅できないことがあるため、
// 両方を順に試すことでヒット率を上げている。

export function normalizeIsbn(raw) {
  return String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
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

async function fetchOpenLibrary(isbn) {
  const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`);
  if (!res.ok) throw new Error(`OpenLibrary HTTP ${res.status}`);
  const data = await res.json();
  const entry = data[`ISBN:${isbn}`];
  if (!entry) return null;

  const hasData = entry.title || (entry.authors && entry.authors.length) || (entry.publishers && entry.publishers.length) || entry.publish_date;
  if (!hasData) return null;

  return {
    isbn,
    title: entry.title || "",
    author: (entry.authors || []).map((a) => a.name).join(", "),
    publisher: (entry.publishers || []).map((p) => p.name).join(", "),
    pubdate: entry.publish_date || "",
    coverUrl: entry.cover?.medium || entry.cover?.small || "",
    source: "OpenLibrary",
  };
}

const ISBN_SOURCES = [fetchOpenBD, fetchGoogleBooks, fetchOpenLibrary];

/**
 * ISBN をキーに書誌情報を検索する。openBD → Google Books → Open Library の順に試す。
 * @param {string} rawIsbn
 * @returns {Promise<{found: boolean, data: object|null, error?: string}>}
 */
export async function lookupIsbn(rawIsbn) {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn) {
    return { found: false, data: null, error: "ISBNが入力されていません。" };
  }

  let hadNetworkError = false;
  for (const fetcher of ISBN_SOURCES) {
    try {
      const result = await fetcher(isbn);
      if (result) return { found: true, data: result };
    } catch {
      hadNetworkError = true;
    }
  }

  if (hadNetworkError) {
    return { found: false, data: null, error: "書誌情報の取得に失敗しました（通信エラー）。手入力するか、書名・著者での検索をお試しください。" };
  }
  return { found: false, data: null, error: "該当する書誌情報が見つかりませんでした。手入力するか、書名・著者での検索をお試しください。" };
}

async function searchGoogleBooksByKeyword(query) {
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10`);
  if (!res.ok) throw new Error(`GoogleBooks HTTP ${res.status}`);
  const data = await res.json();
  const items = data.items || [];
  return items.map((item) => {
    const info = item.volumeInfo || {};
    const ids = info.industryIdentifiers || [];
    const isbn13 = ids.find((id) => id.type === "ISBN_13");
    const isbn10 = ids.find((id) => id.type === "ISBN_10");
    let coverUrl = "";
    if (info.imageLinks) {
      coverUrl = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || "";
      coverUrl = coverUrl.replace(/^http:/, "https:");
    }
    return {
      isbn: normalizeIsbn((isbn13 || isbn10 || {}).identifier || ""),
      title: info.title || "",
      author: (info.authors || []).join(", "),
      publisher: info.publisher || "",
      pubdate: info.publishedDate || "",
      coverUrl,
      source: "GoogleBooks",
    };
  }).filter((c) => c.title);
}

async function searchOpenLibraryByKeyword(query) {
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=title,author_name,first_publish_year,isbn,publisher,cover_i`);
  if (!res.ok) throw new Error(`OpenLibrary HTTP ${res.status}`);
  const data = await res.json();
  const docs = data.docs || [];
  return docs.map((doc) => {
    const isbn = (doc.isbn || []).find((i) => normalizeIsbn(i).length === 13) || (doc.isbn || [])[0] || "";
    return {
      isbn: normalizeIsbn(isbn),
      title: doc.title || "",
      author: (doc.author_name || []).join(", "),
      publisher: (doc.publisher || [])[0] || "",
      pubdate: doc.first_publish_year ? String(doc.first_publish_year) : "",
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : "",
      source: "OpenLibrary",
    };
  }).filter((c) => c.title);
}

/**
 * 書名・著者などのキーワードで書誌情報の候補を検索する（ISBNで見つからない場合の代替手段）。
 * Google Books と Open Library の両方を検索し、結果をまとめて返す。
 * @param {string} query
 * @returns {Promise<Array<object>>} 候補の配列（見つからなければ空配列）
 */
export async function searchByKeyword(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const [googleResults, openLibraryResults] = await Promise.all([
    searchGoogleBooksByKeyword(q).catch(() => []),
    searchOpenLibraryByKeyword(q).catch(() => []),
  ]);

  const combined = [...googleResults, ...openLibraryResults];
  // 同じISBNの重複や、タイトル+著者が完全一致する重複を取り除く
  const seen = new Set();
  const deduped = [];
  for (const candidate of combined) {
    const key = candidate.isbn ? `isbn:${candidate.isbn}` : `title:${candidate.title}|${candidate.author}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped.slice(0, 15);
}
