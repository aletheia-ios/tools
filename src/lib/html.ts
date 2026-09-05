import qrcode from "qrcode-generator";

/** Error correction level; M survives a phone camera at an angle without doubling the size. */
const QR_CORRECTION = "M";

/** Auto-select the smallest QR version that fits the data. */
const QR_AUTO_VERSION = 0;

/** Module size in the generated SVG; the viewBox scales it, so this only sets the aspect grid. */
const QR_CELL = 4;

/**
 * Escapes text for use in HTML markup or a double-quoted attribute.
 *
 * Everything interpolated into a page comes from a package's own json, so it is author-supplied
 * rather than trusted.
 */
export function escapeHTML(value: string): string {
  // ampersand first, or it would escape the ampersands the later replacements introduce
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Renders a QR code for a URL as a standalone, scalable `<svg>` element.
 *
 * Generated at build time so the page needs no script and no network to draw it.
 */
export function qrSVG(url: string): string {
  const code = qrcode(QR_AUTO_VERSION, QR_CORRECTION);
  code.addData(url);
  code.make();
  return code.createSvgTag({ cellSize: QR_CELL, margin: 0, scalable: true });
}
