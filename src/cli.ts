import process from "node:process";
import { parseArgs } from "node:util";
import { build } from "@/commands/build";
import { check } from "@/commands/check";
import { indexes } from "@/commands/indexes";
import { live } from "@/commands/live";
import { create } from "@/commands/new";
import { pack } from "@/commands/pack";
import { serve } from "@/commands/serve";
import { site } from "@/commands/site";
import { findRepo, loadPackage, loadPackages } from "@/context";
import { CliError, info, report } from "@/lib/log";

/** What `aletheia`, `aletheia --help` and an unknown command print. */
const USAGE = `usage: aletheia <command> [options]

  build [--only <slug>]     bundle each package's src/index.ts to dist/build/<slug>/main.js
  check [--only <slug>]     typecheck, build, verify exports and run fixtures under JavaScriptCore
  pack  [--only <slug>]     build, rasterise the icon and zip to dist/packages/<slug>-v<version>.althsource
  index                     write dist/<target>/index.json for every list in lists/
  site  [--base <url>]      write dist/<target>/site/ - the page a reader adds the list from,
                            addressing each list at <base>/<target>/index.json when given
  serve [--port <n>]        pack, index, serve dist/ on the lan and rebuild on change
  new <slug> [--name <n>]   scaffold packages/<slug> from the template
  live <slug> <series|-> [query]
                            run a package against the live site in node and print what it returns

Run from anywhere inside a repository that has a packages/ directory.`;

/** The port `serve` binds when `--port` is not given. */
const DEFAULT_PORT = "8787";

/**
 * Parses the arguments and dispatches to one command.
 *
 * Every command runs from the repository found above the working directory, and all but
 * `serve` and `new` load the packages first so a broken manifest fails before any work.
 *
 * @throws `CliError` for an unknown command or a missing positional, plus whatever the
 *   command throws.
 */
async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      only: { type: "string", multiple: true },
      port: { type: "string" },
      name: { type: "string" },
      base: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) {
    info(USAGE);
    return;
  }

  const repo = findRepo();
  switch (command) {
    case "build":
      await build(repo, await loadPackages(repo, values.only));
      return;
    case "check":
      await check(repo, await loadPackages(repo, values.only));
      return;
    case "pack":
      await pack(repo, await loadPackages(repo, values.only));
      return;
    case "index":
      await indexes(repo, await loadPackages(repo));
      return;
    case "site":
      await site(repo, await loadPackages(repo), values.base);
      return;
    case "serve":
      await serve(repo, Number.parseInt(values.port ?? DEFAULT_PORT, 10));
      return;
    case "new": {
      const [slug] = rest;
      if (slug === undefined) throw new CliError(["usage: aletheia new <slug> [--name <name>]"]);
      await create(repo, slug, values.name ?? slug);
      return;
    }
    case "live": {
      const [slug, series, text] = rest;
      if (slug === undefined || series === undefined) {
        throw new CliError(["usage: aletheia live <slug> <series|-> [query]"]);
      }
      await live(repo, await loadPackage(repo, slug), series, text ?? "");
      return;
    }
    default:
      throw new CliError([`unknown command "${command}"`, "", USAGE]);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  report(error);
  process.exit(1);
});
