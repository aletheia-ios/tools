import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "@/commands/build";
import type { Package, Repo } from "@/context";
import { findIcon } from "@/lib/icon";
import { exportsOf, type Fixture, hasJSC, smoke } from "@/lib/jsc";
import { CliError, info, warn } from "@/lib/log";

/** The methods every source must export. */
const REQUIRED = ["search", "details", "chapters", "content"];

/** The methods whose presence the app reads as a capability. */
const OPTIONAL = ["comments", "replies", "chaptersChanged", "isChallenge", "pingURL"];

/**
 * Runs the repository's own `tsc` against the package's tsconfig.
 *
 * Skipped with a warning when TypeScript is not installed in the repository; the bundler
 * strips types without checking them, so this is the only place a type error surfaces.
 * Returns tsc's output lines, empty when it passed.
 */
function typecheck(repo: Repo, pkg: Package): string[] {
  const tsc = join(repo.root, "node_modules", ".bin", "tsc");
  if (!existsSync(tsc)) {
    warn(`${pkg.folder}: typescript is not installed in this repository, skipping typecheck`);
    return [];
  }
  const child = spawnSync(tsc, ["-p", join(pkg.dir, "tsconfig.json"), "--noEmit"], {
    encoding: "utf8",
  });
  if (child.status === 0) return [];
  return child.stdout.trim().split("\n");
}

/** The icon problems for a package as lines, empty when it has exactly one icon. */
function icon(pkg: Package): string[] {
  try {
    findIcon(pkg.dir, pkg.folder);
    return [];
  } catch (error) {
    if (error instanceof CliError) return error.lines;
    throw error;
  }
}

/**
 * Evaluates a built bundle under JavaScriptCore and returns its problems as lines.
 *
 * Verifies the required exports, prints the capabilities the app will derive, and when
 * `fixtures/smoke.json` exists runs the four calls against it. Without fixtures the
 * exports alone are verified and a warning says so.
 */
async function evaluate(pkg: Package, path: string): Promise<string[]> {
  const bundle = await readFile(path, "utf8");
  const exported = exportsOf(bundle);
  if (!exported.ok || exported.result === null) {
    return [`${pkg.folder}: main.js failed to evaluate in JavaScriptCore\n${exported.output}`];
  }
  const missing = REQUIRED.filter((name) => exported.result?.[name] !== "function");
  if (missing.length > 0) return missing.map((name) => `${pkg.folder}: missing export ${name}()`);

  const capabilities = OPTIONAL.filter((name) => exported.result?.[name] === "function");
  if (pkg.auth !== null) capabilities.push("auth");
  const label = `${pkg.folder}: ok [${capabilities.join(", ") || "base"}]`;

  const fixturesPath = join(pkg.dir, "fixtures", "smoke.json");
  if (!existsSync(fixturesPath)) {
    warn(`${pkg.folder}: no fixtures/smoke.json - exports verified, calls not exercised`);
    info(label);
    return [];
  }
  const fixtures = JSON.parse(await readFile(fixturesPath, "utf8")) as Fixture[];
  const result = smoke(bundle, fixtures);
  if (!result.ok || result.result === null) {
    return [`${pkg.folder}: smoke failed in JavaScriptCore\n${result.output}`];
  }
  const out = result.result;
  info(
    `${label} - "${out.details.title}", ${out.search.items.length} results, ${out.chapters.length} chapters, ${out.content.length} pages`,
  );
  return [];
}

/**
 * The `check` command: typecheck, build, then verify each bundle under JavaScriptCore.
 *
 * Type errors stop the run before anything is built. After that every package is checked
 * and every problem reported together. The JavaScriptCore step needs the jsc shell that
 * ships with macOS and is skipped with a warning elsewhere.
 *
 * @throws `CliError` listing every problem found.
 */
export async function check(repo: Repo, packages: Package[]): Promise<void> {
  const problems: string[] = [];
  for (const pkg of packages) problems.push(...typecheck(repo, pkg));
  if (problems.length > 0) throw new CliError(problems);

  const built = await build(repo, packages);
  const jsc = hasJSC();
  if (!jsc) warn("jsc shell not found (macOS only) - skipping the JavaScriptCore run");

  for (const { pkg, path } of built) {
    problems.push(...icon(pkg));
    if (jsc) problems.push(...(await evaluate(pkg, path)));
  }
  if (problems.length > 0) throw new CliError(problems);
}
