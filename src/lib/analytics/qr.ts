import "server-only";
import QRCode from "qrcode";

/**
 * SVG з QR-кодом для адреси (вектор: друкується без втрати якості).
 * Рівень корекції M і поле 2 модулі: надійно сканується навіть зі стікера з подряпинами.
 */
export async function renderQrSvg(text: string): Promise<string | null> {
  try {
    return await QRCode.toString(text, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}
