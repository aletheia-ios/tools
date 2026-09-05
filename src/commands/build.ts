import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { build as esbuild } from "esbuild";
import { bundlePath, OWN_ROOT, type Package, type Repo } from "@/context";
import { CliError, info, kb } from "@/lib/log";

/**
 * A fallback resolution root for the bundler.
 *
 * The sdk installed next to this cli resolves from here, so a repository that has not
 * installed `@aletheia-ios/sdk` itself still builds.
 */
const OWN_NODE_MODULES = join(OWN_ROOT, "node_modules");

/** Matches a zod file in esbuild's input list, under a flat or pnpm layout. */
const ZOD_INPUT = /node_modules\/(\.pnpm\/)?zod[/@]/;

/** A package after `build`: where its bundle landed and how big it is. */
export interface Built {
  pkg: Package;
  path: string;
  bytes: number;
}

/**
 * Bundles one package's `src/index.ts` to `dist/build/<slug>/main.js`.
 *
 * The output is a single ES2022 iife for a neutral platform, with no node or dom
 * assumptions, ending by leaving the default export on `globalThis.__source` where the
 * host reads it after evaluation.
 *
 * @throws `CliError` when the bundle pulled in zod, which means the source imported
 *   `@aletheia-ios/sdk/schemas` and would ship a validator to every phone.
 */
export async function buildOne(repo: Repo, pkg: Package): Promise<Built> {
  const outfile = bundlePath(repo, pkg.folder);
  await mkdir(dirname(outfile), { recursive: true });
  const result = await esbuild({
    entryPoints: [join(pkg.dir, "src", "index.ts")],
    bundle: true,
    format: "iife",
    globalName: "__bundle",
    footer: { js: "globalThis.__source = __bundle.default;" },
    platform: "neutral",
    target: "es2022",
    outfile,
    tsconfig: join(pkg.dir, "tsconfig.json"),
    nodePaths: [OWN_NODE_MODULES],
    logLevel: "warning",
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.some((input) => ZOD_INPUT.test(input))) {
    throw new CliError([
      `${pkg.folder}: main.js bundles zod - a source must not import @aletheia-ios/sdk/schemas`,
    ]);
  }
  const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
  return { pkg, path: outfile, bytes };
}

/** The `build` command: bundles each package in turn and prints its size. */
export async function build(repo: Repo, packages: Package[]): Promise<Built[]> {
  const built: Built[] = [];
  for (const pkg of packages) {
    const one = await buildOne(repo, pkg);
    info(`${pkg.folder}: main.js ${kb(one.bytes)}`);
    built.push(one);
  }
  return built;
}
