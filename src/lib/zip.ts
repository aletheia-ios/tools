import { zipSync } from "fflate";

/**
 * The modification time stamped on every entry.
 *
 * A fixed mtime is what makes two builds of the same content byte-identical, which the app
 * relies on to treat one package published by two lists as one package.
 */
const EPOCH = new Date("2000-01-01T00:00:00Z");

/**
 * Zips files into bytes that depend only on their names and contents.
 *
 * Entries are written in sorted name order with the fixed mtime and maximum deflate, so
 * the same input always produces the same archive and the same sha256.
 */
export function deterministicZip(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date; level: 9 }]> = {};
  for (const name of Object.keys(files).sort()) {
    entries[name] = [files[name] as Uint8Array, { mtime: EPOCH, level: 9 }];
  }
  return zipSync(entries);
}
