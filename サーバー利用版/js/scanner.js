// html5-qrcode を使ったカメラバーコードスキャナのラッパー。
// ISBNバーコード(EAN-13)の読み取りに絞ってフォーマットとスキャン枠を最適化する。

let scannerInstance = null;

// 同時に多くのフォーマットをデコードしようとするほど1フレームあたりの処理が重くなり、
// 検出精度が落ちるため、ISBNに関係するフォーマットのみに絞る。
const BARCODE_FORMATS = ["EAN_13", "EAN_8", "UPC_A", "UPC_E"];

export function isCameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof window.Html5Qrcode !== "undefined";
}

/**
 * カメラでのバーコードスキャンを開始する。
 * @param {string} elementId カメラ映像を表示する要素のID
 * @param {(text: string, result: any) => void} onDetected 検出時のコールバック
 * @param {(err: string) => void} [onError] 起動エラー時のコールバック
 */
export async function startScanner(elementId, onDetected, onError) {
  if (!isCameraSupported()) {
    if (onError) onError("カメラがサポートされていません。");
    return false;
  }

  await stopScanner();

  scannerInstance = new window.Html5Qrcode(elementId, {
    formatsToSupport: BARCODE_FORMATS.map((name) => window.Html5QrcodeSupportedFormats[name]),
    verbose: false,
  });

  const config = {
    fps: 10,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      // ISBNバーコード(EAN-13)は横に長い形状なので、横長の枠を使う
      const minSide = Math.min(viewfinderWidth, viewfinderHeight);
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
