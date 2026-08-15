// CSV / JSON でのバックアップ用エクスポート・インポート

const CSV_COLUMNS = ["id", "isbn", "title", "author", "publisher", "pubdate", "memo", "coverUrl", "createdAt"];

function csvEscape(value) {
  const str = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function toCSV(books) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const book of books) {
    lines.push(CSV_COLUMNS.map((col) => csvEscape(book[col])).join(","));
  }
  return "﻿" + lines.join("\r\n"); // BOM付きでExcel等でも文字化けしないようにする
}

export function toJSON(books) {
  return JSON.stringify(books, null, 2);
}

/**
 * RFC4180 相当のシンプルな CSV パーサー。
 * @param {string} text
 * @returns {string[][]}
 */
function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (c === "\r") {
      // \r\n の \n 側で改行処理するのでここでは何もしない
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function fromCSV(text) {
  const rows = parseCSVRows(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const obj = {};
    header.forEach((col, idx) => { obj[col] = row[idx] !== undefined ? row[idx] : ""; });
    records.push(obj);
  }
  return records;
}

export function fromJSON(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSONは本の配列である必要があります。");
  return data;
}

export function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
