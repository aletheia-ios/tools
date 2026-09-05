import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { build } from "@/commands/build";
import { iconPath, type Package, packagePath, type Repo } from "@/context";
import { findIcon, rasterise } from "@/lib/icon";
import { info, kb } from "@/lib/log";
import { deterministicZip } from "@/lib/zip";

/** How many hex characters of the sha256 the progress line shows. */
const SHORT_HASH = 12;

/** A package after `pack`: where the archive and icon landed, the size and the sha256. */
export interface Packed {
  pkg: Package;
  path: string;
  icon: string;
  bytes: number;
  sha256: string;
}

/**
 * The `pack` command: builds each package, rasterises its icon, and zips the package files
 * to `dist/packages/<slug>-v<version>.althsource`.
 *
 * The archive holds `source.json`, `filters.json`, `icon.png`, `main.js` and, when the
 * package has one, `auth.json`. The zip is deterministic, so the same content always gives
 * the same bytes and sha256. The icon is also written on its own to `dist/icons/` for the
 * index to link.
 */
export async function pack(repo: Repo, packages: Package[]): Promise<Packed[]> {
  const built = await build(repo, packages);
  const packed: Packed[] = [];
  for (const { pkg, path } of built) {
    const icon = await rasterise(findIcon(pkg.dir, pkg.slug), pkg.slug);
    const files: Record<string, Uint8Array> = {
      "source.json": await readFile(join(pkg.dir, "source.json")),
      "filters.json": await readFile(join(pkg.dir, "filters.json")),
      "icon.png": icon,
      "main.js": await readFile(path),
    };
    if (existsSync(join(pkg.dir, "auth.json"))) {
      files["auth.json"] = await readFile(join(pkg.dir, "auth.json"));
    }
    const zip = deterministicZip(files);

    const out = packagePath(repo, pkg);
    const iconOut = iconPath(repo, pkg.slug);
    await mkdir(dirname(out), { recursive: true });
    await mkdir(dirname(iconOut), { recursive: true });
    await writeFile(out, zip);
    await writeFile(iconOut, icon);

    const sha256 = createHash("sha256").update(zip).digest("hex");
    info(
      `${pkg.slug}: ${out.slice(repo.root.length + 1)} ${kb(zip.byteLength)} ${sha256.slice(0, SHORT_HASH)}`,
    );
    packed.push({ pkg, path: out, icon: iconOut, bytes: zip.byteLength, sha256 });
  }
  return packed;
}
