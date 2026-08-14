// html5-qrcode を使ったスキャナのラッパー。
// 「バーコード（ISBN=EAN-13など）」と「QRコード」は形状もデコード処理も異なるため、
// フォーマットとスキャン枠の形をモードごとに分けて、1フレームあたりの解析負荷と
// 枠の使い勝手をそれぞれに最適化する。

let scannerInstance = null;

// モードごとに読み取り対象のフォーマットを限定する（同時に多くのフォーマットを
// デコードしようとするほど1フレームあたりの処理が重くなり、検出精度が落ちるため）。
const FORMAT_GROUPS = {
  barcode: ["EAN_13", "EAN_8", "UPC_A", "UPC_E"],
  qr: ["QR_CODE"],
};

export function isCameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof window.Html5Qrcode !== "undefined";
}

/**
 * スキャナーを起動する。
 * @param {string} elementId カメラ映像を表示する要素のID
 * @param {"barcode"|"qr"} mode 読み取り対象。バーコード(EAN/UPC)かQRコードかを指定する
 * @param {(text: string, result: any) => void} onDetected 検出時のコールバック
 * @param {(err: string) => void} [onError] 起動エラー時のコールバック
 */
export async function startScanner(elementId, mode, onDetected, onError) {
  if (!isCameraSupported()) {
    if (onError) onError("カメラがサポートされていません。");
    return false;
  }

  await stopScanner();

  const formatNames = FORMAT_GROUPS[mode] || FORMAT_GROUPS.barcode;
  scannerInstance = new window.Html5Qrcode(elementId, {
    formatsToSupport: formatNames.map((name) => window.Html5QrcodeSupportedFormats[name]),
    verbose: false,
  });

  const config = {
    fps: 10,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const minSide = Math.min(viewfinderWidth, viewfinderHeight);
      if (mode === "qr") {
        // QRコードはほぼ正方形なので、正方形の枠を使う
        const size = Math.floor(minSide * 0.7);
        return { width: size, height: size };
      }
      // ISBNバーコード(EAN-13)は横に長い形状なので、横長の枠を使う
      const width = Math.floor(Math.min(viewfinderWidth * 0.9, minSide * 1.6));
      const height = Math.max(Math.floor(width * 0.32), 70);
      return { width, height };
    },
  };

  let stopped = false;
  const handleSuccess = (decodedText, decodedResult) => {
    if (stopped) return;
    onDetected(decodedText, decodedResult);
  };
  const handleFailure = () => { /* フレームごとの未検出は無視する */ };

  try {
    await scannerInstance.start({ facingMode: "environment" }, config, handleSuccess, handleFailure);
    return true;
  } catch (err) {
    stopped = true;
    if (onError) onError(err && err.message ? err.message : String(err));
    return false;
  }
}

export async function stopScanner() {
  if (!scannerInstance) return;
  try {
    await scannerInstance.stop();
    scannerInstance.clear();
  } catch {
    // すでに停止している場合などは無視する
  } finally {
    scannerInstance = null;
  }
}
