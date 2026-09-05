import { existsSync } from "node:fs";
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
  slug: string;
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
export async function loadPackage(repo: Repo, slug: string): Promise<Package> {
  const dir = join(repo.packages, slug);
  const problems: string[] = [];

  const manifestResult = SourceManifest.safeParse(await readJSON(join(dir, "source.json")));
  problems.push(...issues(`${slug}/source.json`, manifestResult));
  if (manifestResult.success && manifestResult.data.slug !== slug) {
    problems.push(
      `${slug}/source.json slug: "${manifestResult.data.slug}" must match the folder name`,
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
  return { slug, dir, manifest: manifestResult.data, filters: filtersResult.data, auth };
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
