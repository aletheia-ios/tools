import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { Index } from "@aletheia-ios/sdk/schemas";
import type { IndexEntry } from "@aletheia-ios/sdk/types";
import { z } from "zod";
import { BUILT_WITH, iconPath, type Package, packagePath, type Repo } from "@/context";
import { CliError, info } from "@/lib/log";

/**
 * Validates one `lists/<name>.json`: the list's display name, the `dist/<target>` folder
 * it publishes to, and the package slugs it includes.
 *
 * `url` is where that target's `index.json` will be served once deployed. Only `site` needs
 * it, to build the deep link and QR a reader adds the list with, so it stays optional until
 * the zone exists. `adult` puts an age gate in front of the generated page.
 */
const List = z.strictObject({
  name: z.string().min(1),
  target: z.string().regex(/^[a-z0-9-]+$/),
  url: z.url().optional(),
  adult: z.boolean().optional(),
  sources: z.array(z.string().min(1)).min(1),
});

/** A parsed source list. */
export type List = z.infer<typeof List>;

/**
 * Loads every `lists/*.json`, sorted by file name.
 *
 * @throws `CliError` when there is no `lists/` directory, or listing every invalid field
 *   across the lists.
 */
export async function loadLists(repo: Repo): Promise<List[]> {
  if (!existsSync(repo.lists)) throw new CliError([`no lists/ directory in ${repo.root}`]);
  const names = (await readdir(repo.lists)).filter((name) => name.endsWith(".json")).sort();
  const lists: List[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const result = List.safeParse(JSON.parse(await readFile(join(repo.lists, name), "utf8")));
    if (result.success) lists.push(result.data);
    else {
      problems.push(
        ...result.error.issues.map(
          (issue) => `lists/${name} ${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      );
    }
  }
  if (problems.length > 0) throw new CliError(problems);
  return lists;
}

/**
 * The package folder's last commit date as ISO 8601.
 *
 * Taken from git so an unchanged package keeps its date across rebuilds and the app does
 * not see a fresh update every deploy. Falls back to now outside a git checkout.
 */
function updatedDate(pkg: Package): string {
  const child = spawnSync("git", ["log", "-1", "--format=%cI", "--", pkg.dir], {
    cwd: pkg.dir,
    encoding: "utf8",
  });
  const iso = child.status === 0 ? child.stdout.trim() : "";
  return iso === "" ? new Date().toISOString() : new Date(iso).toISOString();
}

/**
 * Builds a package's entry for a list: manifest fields, the packed file's size and
 * sha256, and download and icon URLs relative to `dist/<target>/`.
 *
 * @throws `CliError` when the package has not been packed.
 */
async function entry(repo: Repo, pkg: Package, target: string): Promise<IndexEntry> {
  const path = packagePath(repo, pkg);
  if (!existsSync(path)) throw new CliError([`${pkg.folder}: not packed - run pack first`]);
  const bytes = await readFile(path);
  const base = join(repo.dist, target);
  return {
    slug: pkg.slug,
    // advisory here so a list can explain a slug that vanished from it; the app applies the
    // namespace rule against the manifest's copy, never this one
    ...(pkg.manifest.replaces === undefined ? {} : { replaces: pkg.manifest.replaces }),
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    minAppVersion: pkg.manifest.minAppVersion,
    contractVersion: pkg.manifest.contractVersion,
    contentRating: pkg.manifest.contentRating,
    languages: pkg.manifest.languages,
    size: (await stat(path)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    updatedDate: updatedDate(pkg),
    downloadURL: relative(base, path),
    iconURL: relative(base, iconPath(repo, pkg.slug)),
    builtWith: BUILT_WITH,
  };
}

/**
 * The `index` command: writes `dist/<target>/index.json` for every list.
 *
 * The index is validated against the sdk's `Index` schema before it is written, so a
 * deploy never publishes what the app would reject. Next to it, `manifest.json` names the
 * package and icon files that target's deploy has to upload besides its own directory.
 *
 * @throws `CliError` when a list names a package that does not exist or is not packed.
 */
export async function indexes(repo: Repo, packages: Package[]): Promise<void> {
  const bySlug = new Map(packages.map((pkg) => [pkg.slug, pkg]));
  for (const list of await loadLists(repo)) {
    const missing = list.sources.filter((slug) => !bySlug.has(slug));
    if (missing.length > 0) {
      throw new CliError(missing.map((slug) => `list "${list.name}": no package "${slug}"`));
    }
    const members = list.sources.map((slug) => bySlug.get(slug) as Package);
    const entries: IndexEntry[] = [];
    for (const pkg of members) entries.push(await entry(repo, pkg, list.target));

    const index = Index.parse({
      name: list.name,
      updatedDate: new Date().toISOString(),
      sources: entries,
    });
    const dir = join(repo.dist, list.target);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    const manifest = {
      packages: members.map((pkg) => basename(packagePath(repo, pkg))),
      icons: members.map((pkg) => basename(iconPath(repo, pkg.slug))),
    };
    await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    info(`${list.target}/index.json: ${entries.length} source(s)`);
  }
}
