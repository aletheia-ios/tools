import { zipSync } from "fflate";

/** The calendar fields stamped on every entry, as a zip records them. */
const EPOCH = { year: 2000, month: 0, day: 1 };

/**
 * The modification time stamped on every entry.
 *
 * Built from the local-time constructor rather than a UTC instant, because a zip stores a DOS
 * timestamp of the *local* calendar fields. A UTC instant renders as 00:00 on a runner in UTC
 * and 11:00 on a machine in Sydney, which produced byte-different archives of identical files
 * and broke the one guarantee this function exists to make. These arguments read back as
 * 2000-01-01 00:00 from every timezone.
 *
 * Constructed per call so that construction and encoding always see the same timezone.
 */
function epoch(): Date {
  return new Date(EPOCH.year, EPOCH.month, EPOCH.day);
}

/**
 * Zips files into bytes that depend only on their names and contents.
 *
 * Entries are written in sorted name order with a fixed mtime and maximum deflate, so the same
 * input produces the same archive and the same sha256 on any machine, in any timezone.
 */
export function deterministicZip(files: Record<string, Uint8Array>): Uint8Array {
  const mtime = epoch();
  const entries: Record<string, [Uint8Array, { mtime: Date; level: 9 }]> = {};
  for (const name of Object.keys(files).sort()) {
    entries[name] = [files[name] as Uint8Array, { mtime, level: 9 }];
  }
  return zipSync(entries);
}
