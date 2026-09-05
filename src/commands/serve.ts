import { createReadStream, existsSync, type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { indexes, loadLists } from "@/commands/indexes";
import { pack } from "@/commands/pack";
import { loadPackages, type Repo } from "@/context";
import { info, report } from "@/lib/log";

/** Content types for what `dist/` holds; anything else is served as octet-stream. */
const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".althsource": "application/zip",
  ".js": "text/javascript",
};

/** Leading `../` segments left after normalisation, which would escape `dist/`. */
const TRAVERSAL = /^(\.\.[/\\])+/;

/** How long after the last change to wait before rebuilding, so an editor's save burst is one build. */
const DEBOUNCE_MS = 300;

const OK = 200;
const NOT_FOUND = 404;

/** A running dev server: the URL it prints and a way to stop it. */
export interface Serving {
  url: string;
  close: () => Promise<void>;
}

/**
 * Packs and indexes the whole repository, reporting failures instead of throwing.
 *
 * A broken package while serving is a message on stderr, not a dead server; the previous
 * build stays served until the next successful one.
 */
async function rebuild(repo: Repo): Promise<void> {
  try {
    const packages = await loadPackages(repo);
    await pack(repo, packages);
    await indexes(repo, packages);
  } catch (error) {
    report(error);
  }
}

/** The first non-internal IPv4 address, which is what a phone on the same wifi can reach. */
function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

/**
 * The file under `dist/` a request names, or null when it names nothing servable.
 *
 * Null covers a missing file, a directory, a path that would escape `dist/`, and a URL
 * that does not decode.
 */
async function resolveFile(dist: string, url: string): Promise<string | null> {
  let path: string;
  try {
    path = normalize(decodeURIComponent(url)).replace(TRAVERSAL, "");
  } catch {
    return null;
  }
  const file = join(dist, path);
  const servable = file.startsWith(dist) && existsSync(file) && (await stat(file)).isFile();
  return servable ? file : null;
}

/** A static server over `dist/` that sends `cache-control: no-store` so the app never caches a dev build. */
function fileServer(dist: string): Server {
  return createServer(async (request, response) => {
    const file = await resolveFile(dist, request.url ?? "/");
    if (file === null) {
      response.writeHead(NOT_FOUND).end();
      return;
    }
    response.writeHead(OK, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(response);
  });
}

/** Watches `packages/` and `lists/` and rebuilds once per burst of changes. */
function watchRepo(repo: Repo): FSWatcher[] {
  let timer: NodeJS.Timeout | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      info("change detected, rebuilding");
      rebuild(repo).catch(report);
    }, DEBOUNCE_MS);
  };
  return [
    watch(repo.packages, { recursive: true }, trigger),
    watch(repo.lists, { recursive: true }, trigger),
  ];
}

/**
 * The `serve` command: packs, indexes, serves `dist/` on the lan and rebuilds on change.
 *
 * Binds every interface and prints the lan URL of each list's `index.json`, which is what
 * the app's developer list points at. Port 0 binds a free port. Resolves once listening;
 * the returned `close` stops the watchers and the server.
 *
 * @throws `CliError` when there is no `lists/` directory, before any port is bound.
 */
export async function serve(repo: Repo, port: number): Promise<Serving> {
  const lists = await loadLists(repo);
  await rebuild(repo);
  const server = fileServer(repo.dist);
  const watchers = watchRepo(repo);

  await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
  const address = server.address();
  const bound = typeof address === "object" && address !== null ? address.port : port;
  const url = `http://${lanAddress()}:${bound}/`;
  info(`serving ${repo.dist} on ${url}`);
  for (const list of lists) info(`  ${list.name}: ${url}${list.target}/index.json`);

  return {
    url,
    close: () => {
      for (const watcher of watchers) watcher.close();
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
