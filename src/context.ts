import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { AuthSpec, Filters, SourceManifest } from "@aletheia-ios/sdk/schemas";
import type {
  AuthSpec as Auth,
  Filters as FilterList,
  SourceManifest as Manifest,
} from "@aletheia-ios/sdk/types";
import type { z } from "zod";
import { CliError } from "@/lib/log";

/** The repository the cli operates on: the folder holding `packages/` and the paths under it. */
export interface Repo {
  root: string;
  packages: string;
  lists: string;
  dist: string;
}

/** One source package, loaded and validated: its folder plus the parsed json files. */
export interface Package {
  /** The manifest's reverse-DNS slug: the package's global identity. */
  slug: string;
  /** The directory name under `packages/`, which is what `--only` and progress lines use. */
  folder: string;
  dir: string;
  manifest: Manifest;
  filters: FilterList;
  /** The parsed `auth.json`, or null when the package has none. */
  auth: Auth | null;
}

/**
 * Finds this cli's own package root by walking up to the folder holding `template/`.
 *
 * `dist/cli.js` and `src/commands/*.ts` sit at different depths, so a fixed relative path
 * would resolve correctly from only one of them.
 */
function ownRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "template"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("template/ not found next to the aletheia cli");
    dir = parent;
  }
  return dir;
}

/** The folder this cli is installed in, holding `template/` and its own `node_modules/`. */
export const OWN_ROOT = ownRoot();

/**
 * This cli's own `name@version`, recorded in each index entry.
 *
 * A bundler upgrade can change `main.js` for unchanged source, so two lists can hold the same
 * package at different shas without anyone tampering. This is what tells them apart.
 */
export const BUILT_WITH = ((): string => {
  const own = JSON.parse(readFileSync(join(OWN_ROOT, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  return `${own.name}@${own.version}`;
})();

/**
 * Locates the repository from a working directory: the nearest ancestor holding `packages/`.
 *
 * @throws `CliError` when no ancestor has one.
 */
export function findRepo(cwd: string = process.cwd()): Repo {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, "packages"))) {
      return {
        root: dir,
        packages: join(dir, "packages"),
        lists: join(dir, "lists"),
        dist: join(dir, "dist"),
      };
    }
    const parent = dirname(dir);
    if (parent === dir) throw new CliError([`no packages/ directory found above ${cwd}`]);
    dir = parent;
  }
}

/**
 * Reads and parses a json file.
 *
 * @throws `CliError` naming the file when it is missing or malformed, with the original error
 *   as the cause.
 */
async function readJSON(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new CliError([`${path}: ${error instanceof Error ? error.message : String(error)}`], {
      cause: error,
    });
  }
}

/**
 * Whether a manifest slug belongs in a folder of this name.
 *
 * Slugs are reverse-DNS, so `packages/mangadex` holding `com.example.mangadex` keeps the
 * folder list readable. The full slug is accepted too, which is the way out when two
 * publishers' packages in one repository end in the same segment.
 */
function namesFolder(slug: string, folder: string): boolean {
  return slug === folder || slug.slice(slug.lastIndexOf(".") + 1) === folder;
}

/** Turns a failed parse into `file path: message` lines; empty for a successful one. */
function issues(file: string, result: z.ZodSafeParseResult<unknown>): string[] {
  if (result.success) return [];
  return result.error.issues.map(
    (issue) => `${file} ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
}

/**
 * Loads one package by folder name, validating `source.json`, `filters.json` and, when
 * present, `auth.json` against the sdk schemas.
 *
 * Every problem across the three files is collected before anything is thrown, and the
 * manifest's slug has to match the folder name because the folder is what lists refer to.
 *
 * @throws `CliError` listing every problem found.
 */
export async function loadPackage(repo: Repo, folder: string): Promise<Package> {
  const dir = join(repo.packages, folder);
  const slug = folder;
  const problems: string[] = [];

  const manifestResult = SourceManifest.safeParse(await readJSON(join(dir, "source.json")));
  problems.push(...issues(`${slug}/source.json`, manifestResult));
  if (manifestResult.success && !namesFolder(manifestResult.data.slug, slug)) {
    problems.push(
      `${slug}/source.json slug: "${manifestResult.data.slug}" must match the folder name or end with it`,
    );
  }

  const filtersResult = Filters.safeParse(await readJSON(join(dir, "filters.json")));
  problems.push(...issues(`${slug}/filters.json`, filtersResult));

  let auth: Auth | null = null;
  if (existsSync(join(dir, "auth.json"))) {
    const authResult = AuthSpec.safeParse(await readJSON(join(dir, "auth.json")));
    problems.push(...issues(`${slug}/auth.json`, authResult));
    if (authResult.success) auth = authResult.data;
  }

  if (!existsSync(join(dir, "src", "index.ts"))) problems.push(`${slug}/src/index.ts is missing`);

  if (problems.length > 0 || !manifestResult.success || !filtersResult.success) {
    throw new CliError(problems);
  }
  return {
    slug: manifestResult.data.slug,
    folder,
    dir,
    manifest: manifestResult.data,
    filters: filtersResult.data,
    auth,
  };
}

/**
 * Loads every package folder under `packages/`, sorted by name, skipping dotfolders.
 *
 * With `only` (the `--only` flags) the set is narrowed first, and a name that is not a
 * folder is an error rather than silently nothing. Problems from every package are
 * collected before anything is thrown.
 *
 * @throws `CliError` listing unknown `only` names, or every problem across the packages.
 */
export async function loadPackages(repo: Repo, only?: string[]): Promise<Package[]> {
  const names = (await readdir(repo.packages, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => only === undefined || only.includes(name))
    .sort();
  if (only !== undefined) {
    const missing = only.filter((name) => !names.includes(name));
    if (missing.length > 0) throw new CliError(missing.map((name) => `no package "${name}"`));
  }
  const problems: string[] = [];
  const packages: Package[] = [];
  for (const name of names) {
    try {
      packages.push(await loadPackage(repo, name));
    } catch (error) {
      if (error instanceof CliError) problems.push(...error.lines);
      else throw error;
    }
  }
  if (problems.length > 0) throw new CliError(problems);
  return packages;
}

/** Where `build` writes a package's bundle: `dist/build/<slug>/main.js`. */
export function bundlePath(repo: Repo, slug: string): string {
  return join(repo.dist, "build", slug, "main.js");
}

/** Where `pack` writes a package's archive: `dist/packages/<slug>-v<version>.althsource`. */
export function packagePath(repo: Repo, pkg: Package): string {
  return join(repo.dist, "packages", `${pkg.slug}-v${pkg.manifest.version}.althsource`);
}

/** Where `pack` writes a package's rasterised icon: `dist/icons/<slug>.png`. */
export function iconPath(repo: Repo, slug: string): string {
  return join(repo.dist, "icons", `${slug}.png`);
}
