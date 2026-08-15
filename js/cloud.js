// Firebase (Authentication + Firestore) を使った複数端末間の同期。
//
// 【セットアップ手順】
// 1. https://console.firebase.google.com でプロジェクトを作成
// 2. 左メニュー「Firestore Database」→ データベースを作成（リージョンは asia-northeast1 推奨）
// 3. 左メニュー「Authentication」→「Sign-in method」で「Google」を有効化
// 4. 「Authentication」→「Settings」→「承認済みドメイン」に、このアプリを配信するドメイン
//    （例: あなたのGitHub Pagesのドメイン。localhost は最初から登録済み）を追加
// 5. プロジェクトの設定 → 全般 →「マイアプリ」からウェブアプリを追加し、
//    表示された firebaseConfig の値を下の FIREBASE_CONFIG に貼り付ける
// 6. Firestoreのルールタブに以下を貼り付けて公開する（自分のデータしか読み書きできないようにする設定）:
//
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /users/{userId}/books/{bookId} {
//         allow read, write: if request.auth != null && request.auth.uid == userId;
//       }
//     }
//   }
//
// 注意: Firebase SDKはCDNから動的にimport()する（トップレベルの静的importにしない）。
// 未設定の状態や、CDNに到達できないネットワーク環境でも、このファイルの読み込み自体は
// 必ず成功するようにするため（isConfigured() がSDKなしで判定できるようにするため）。

const SDK_VERSION = "10.14.1";

// ▼▼▼ ここを Firebase コンソールで取得した実際の値に置き換えてください ▼▼▼
const FIREBASE_CONFIG = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};
// ▲▲▲ ここまで ▲▲▲

let app = null;
let auth = null;
let firestore = null;
let provider = null;
let sdk = null;
let initPromise = null;

export function isConfigured() {
  return Object.values(FIREBASE_CONFIG).every((v) => typeof v === "string" && !v.includes("REPLACE_ME"));
}

async function loadSdk() {
  if (sdk) return sdk;
  const [appMod, authMod, firestoreMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
  ]);
  sdk = { ...appMod, ...authMod, ...firestoreMod };
  return sdk;
}

// 複数箇所から同時に呼ばれても初期化が一度だけ走るようにする
function ensureInitialized() {
  if (app) return Promise.resolve();
  if (!initPromise) {
    initPromise = (async () => {
      if (!isConfigured()) {
        throw new Error("Firebaseが設定されていません（js/cloud.js の FIREBASE_CONFIG を確認してください）。");
      }
      let mod;
      try {
        mod = await loadSdk();
      } catch (err) {
        initPromise = null; // 次回また読み込みを再試行できるようにする
        throw new Error("Firebase SDKの読み込みに失敗しました。通信環境をご確認ください。");
      }
      app = mod.initializeApp(FIREBASE_CONFIG);
      auth = mod.getAuth(app);
      firestore = mod.getFirestore(app);
      provider = new mod.GoogleAuthProvider();
    })();
  }
  return initPromise;
}

/** Googleアカウントでのサインインを開始する（リダイレクト方式。結果は consumeRedirectResult() で受け取る） */
export async function signIn() {
  await ensureInitialized();
  return sdk.signInWithRedirect(auth, provider);
}

export async function signOutUser() {
  await ensureInitialized();
  return sdk.signOut(auth);
}

/**
 * サインイン状態の変化を監視する。callback には user（未サインイン時は null）が渡される。
 * Firebaseが未設定・SDKの読み込みに失敗した場合は、常に「未サインイン」として扱う。
 * @returns {Promise<() => void>} 購読解除用の関数
 */
export async function onAuthChange(callback) {
  try {
    await ensureInitialized();
  } catch (err) {
    callback(null);
    return () => {};
  }
  return sdk.onAuthStateChanged(auth, callback);
}

/** リダイレクトでのサインイン完了後、結果を確定させる（ページ読み込み時に一度呼ぶ） */
export async function consumeRedirectResult() {
  try {
    await ensureInitialized();
    await sdk.getRedirectResult(auth);
  } catch (err) {
    console.error("サインインの確認に失敗しました", err);
  }
}

function booksCollection(uid) {
  return sdk.collection(firestore, "users", uid, "books");
}

/**
 * ユーザーの蔵書一覧をリアルタイム購読する。
 * @param {string} uid
 * @param {(books: object[]) => void} onUpdate 一覧が変化するたびに呼ばれる
 * @param {(err: Error) => void} [onError]
 * @returns {Promise<() => void>} 購読解除用の関数
 */
export async function subscribeToBooks(uid, onUpdate, onError) {
  await ensureInitialized();
  return sdk.onSnapshot(
    booksCollection(uid),
    (snapshot) => onUpdate(snapshot.docs.map((d) => d.data())),
    (err) => { if (onError) onError(err); }
  );
}

// アップロードした画像（data:URL）はFirestoreのドキュメントサイズ上限に触れやすく、
// また同期の対象外とする方針のため、クラウドには保存しない（その端末のローカルキャッシュのみに残す）。
function stripLocalOnlyCover(book) {
  const { coverUrl, ...rest } = book;
  return { ...rest, coverUrl: coverUrl && coverUrl.startsWith("data:") ? "" : (coverUrl || "") };
}

export async function saveBook(uid, book) {
  await ensureInitialized();
  await sdk.setDoc(sdk.doc(booksCollection(uid), book.id), stripLocalOnlyCover(book));
}

export async function deleteBook(uid, id) {
  await ensureInitialized();
  await sdk.deleteDoc(sdk.doc(booksCollection(uid), id));
}

const BATCH_CHUNK_SIZE = 400; // Firestoreの1バッチあたり上限(500)に対して余裕を持たせる

/**
 * 複数冊の蔵書データをまとめてクラウドへ保存する。
 * 端末内(IndexedDB)に残っていた既存データの移行や、JSON/CSVインポート時に使う。
 */
export async function bulkSaveBooks(uid, books) {
  await ensureInitialized();
  for (let i = 0; i < books.length; i += BATCH_CHUNK_SIZE) {
    const chunk = books.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = sdk.writeBatch(firestore);
    chunk.forEach((book) => {
      batch.set(sdk.doc(booksCollection(uid), book.id), stripLocalOnlyCover(book));
    });
    await batch.commit();
  }
}
