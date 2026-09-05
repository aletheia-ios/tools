import { existsSync } from "node:fs";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OWN_ROOT, type Repo } from "@/context";
import { CliError, info } from "@/lib/log";

/** The package skeleton shipped with the cli: an offline source that passes `check` as-is. */
const TEMPLATE = join(OWN_ROOT, "template");

/** File extensions that get placeholder substitution; everything else is copied verbatim. */
const TEXT = new Set([".json", ".ts", ".md"]);

/** A valid package slug: reverse-DNS, matching the sdk's `slug` scalar. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

/** A placeholder as written in the template and the text that replaces it. */
type Substitution = [placeholder: string, value: string];

/** Rewrites every text file under `dir`, replacing each placeholder wherever it appears. */
async function substitute(dir: string, values: Substitution[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await substitute(path, values);
      continue;
    }
    if (!TEXT.has(path.slice(path.lastIndexOf(".")))) continue;
    let text = await readFile(path, "utf8");
    for (const [placeholder, value] of values) text = text.replaceAll(placeholder, value);
    await writeFile(path, text);
  }
}

/**
 * The `new` command: copies the template to `packages/<slug>` and fills in the slug and
 * display name.
 *
 * The result is an offline source with `hosts: []` that passes `check` unchanged, so the
 * first thing seen from a new package is green.
 *
 * @throws `CliError` when the slug is not lowercase-letters-digits-hyphens or the folder
 *   already exists.
 */
export async function create(repo: Repo, slug: string, name: string): Promise<void> {
  if (!SLUG.test(slug)) {
    throw new CliError([`"${slug}" is not a slug - reverse-dns, such as com.example.mysite`]);
  }
  const folder = slug.slice(slug.lastIndexOf(".") + 1);
  const dir = join(repo.packages, folder);
  if (existsSync(dir)) throw new CliError([`packages/${folder} already exists`]);
  await cp(TEMPLATE, dir, { recursive: true });
  await substitute(dir, [
    ["__SLUG__", slug],
    ["__NAME__", name],
  ]);
  info(
    `created packages/${folder} - it passes \`aletheia check\` as an offline source; replace src/ with the real one`,
  );
}
