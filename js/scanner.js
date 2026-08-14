// html5-qrcode を使ったバーコードスキャナのラッパー
// ISBN バーコードは EAN-13 形式なので、それを中心にいくつかのフォーマットを許可する。

let scannerInstance = null;

export function isCameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof window.Html5Qrcode !== "undefined";
}

/**
 * スキャナーを起動する。
 * @param {string} elementId カメラ映像を表示する要素のID
 * @param {(text: string, result: any) => void} onDetected バーコード検出時のコールバック
 * @param {(err: string) => void} [onError] 起動エラー時のコールバック
 */
export async function startScanner(elementId, onDetected, onError) {
  if (!isCameraSupported()) {
    if (onError) onError("カメラがサポートされていません。");
    return false;
  }

  await stopScanner();

  scannerInstance = new window.Html5Qrcode(elementId, {
    formatsToSupport: [
      window.Html5QrcodeSupportedFormats.EAN_13,
      window.Html5QrcodeSupportedFormats.EAN_8,
      window.Html5QrcodeSupportedFormats.UPC_A,
      window.Html5QrcodeSupportedFormats.UPC_E,
      window.Html5QrcodeSupportedFormats.CODE_128,
    ],
    verbose: false,
  });

  const config = {
    fps: 10,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75);
      return { width: size, height: Math.max(size * 0.55, 80) };
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
