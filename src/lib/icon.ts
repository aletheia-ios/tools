import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { CliError } from "@/lib/log";

/** The file names a package may use for its icon, in order of preference. */
const CANDIDATES = ["icon.svg", "icon.png", "icon.jpg"];

/** Width and height in pixels of the `icon.png` inside every package. */
export const ICON_SIZE = 512;

/** The smallest raster the cli will upscale; anything less looks blurred on a phone. */
const MIN_RASTER = 256;

/** The density an svg is rendered at so its edges stay sharp after the resize. */
const SVG_DENSITY = 300;

/**
 * Returns the path of the package's icon.
 *
 * Exactly one of `icon.svg`, `icon.png`, `icon.jpg` must be present: svg is preferred
 * because it rasterises to any size, but a package keeps whichever it has and never two.
 *
 * @throws `CliError` when the folder has no icon or more than one.
 */
export function findIcon(dir: string, slug: string): string {
  const present = CANDIDATES.filter((name) => existsSync(join(dir, name)));
  if (present.length !== 1) {
    throw new CliError([
      present.length === 0
        ? `${slug}: no icon - add icon.svg, icon.png or icon.jpg`
        : `${slug}: more than one icon (${present.join(", ")}) - keep exactly one`,
    ]);
  }
  return join(dir, present[0] as string);
}

/**
 * Renders an icon file to a square png of `ICON_SIZE`, letterboxed on transparency.
 *
 * The app decodes png only, so an svg is rasterised here and never on the device. A raster
 * smaller than `MIN_RASTER` on its long side is refused rather than upscaled.
 *
 * @throws `CliError` when a raster icon is too small.
 */
export async function rasterise(source: string, slug: string): Promise<Buffer> {
  const image = sharp(source, { density: SVG_DENSITY });
  const metadata = await image.metadata();
  if (
    metadata.format !== "svg" &&
    Math.max(metadata.width ?? 0, metadata.height ?? 0) < MIN_RASTER
  ) {
    throw new CliError([
      `${slug}: icon is ${metadata.width}x${metadata.height}, need at least ${MIN_RASTER}px on the long side`,
    ]);
  }
  return image
    .resize(ICON_SIZE, ICON_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}
