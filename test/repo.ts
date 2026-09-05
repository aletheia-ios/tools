import { mkdtempSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { create } from "@/commands/new";
import { findRepo, loadPackage, OWN_ROOT, type Package, type Repo } from "@/context";

/** Every temp repository made so far, for `cleanupRepos`. */
const created: string[] = [];

/** What a temp repository starts with. */
export interface RepoOptions {
  /** Lists to write under `lists/`, keyed by file name without `.json`; omit for no `lists/` at all. */
  lists?: Record<string, unknown>;
  /** Link this cli's `node_modules` into the repository so its `tsc` and the sdk resolve. */
  nodeModules?: boolean;
}

/** Makes an empty repository with a `packages/` folder in the OS temp directory. */
export async function tempRepo(options: RepoOptions = {}): Promise<Repo> {
  const root = mkdtempSync(join(tmpdir(), "aletheia-tools-"));
  created.push(root);
  await mkdir(join(root, "packages"));
  if (options.lists !== undefined) {
    await mkdir(join(root, "lists"));
    for (const [name, list] of Object.entries(options.lists)) {
      await writeFile(join(root, "lists", `${name}.json`), JSON.stringify(list));
    }
  }
  if (options.nodeModules)
    await symlink(join(OWN_ROOT, "node_modules"), join(root, "node_modules"));
  return findRepo(root);
}

/** Scaffolds a package from the template and loads it. */
export async function scaffold(repo: Repo, slug: string, name = slug): Promise<Package> {
  await create(repo, slug, name);
  return loadPackage(repo, slug);
}

/** Deletes every repository `tempRepo` made; call from `afterAll`. */
export async function cleanupRepos(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

/** What the code under test wrote to stdout and stderr. */
export interface Captured {
  out: string[];
  err: string[];
}

/** Swallows console output and hands back what was written; undo with `vi.restoreAllMocks`. */
export function capture(): Captured {
  const captured: Captured = { out: [], err: [] };
  vi.spyOn(console, "log").mockImplementation((line: unknown) => captured.out.push(String(line)));
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => captured.err.push(String(line)));
  vi.spyOn(console, "error").mockImplementation((line: unknown) => captured.err.push(String(line)));
  return captured;
}
