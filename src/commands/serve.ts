import { createReadStream, existsSync, type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { indexes, loadLists } from "@/commands/indexes";
import { pack } from "@/commands/pack";
import { site, sitePath } from "@/commands/site";
import { loadPackages, type Repo } from "@/context";
import { CliError, info, report } from "@/lib/log";

/** Content types for what `dist/` holds; anything else is served as octet-stream. */
const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".althsource": "application/zip",
  ".js": "text/javascript",
  ".html": "text/html; charset=utf-8",
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
    await site(repo, packages);
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
 * A directory resolves to its `index.html` when it has one, the way Pages will serve the
 * generated site. Null covers a missing file, a directory without one, a path that would
 * escape `dist/`, and a URL that does not decode.
 */
async function resolveFile(dist: string, url: string): Promise<string | null> {
  let path: string;
  try {
    path = normalize(decodeURIComponent(url)).replace(TRAVERSAL, "");
  } catch {
    return null;
  }
  const target = join(dist, path);
  if (!(target.startsWith(dist) && existsSync(target))) return null;
  const file = (await stat(target)).isDirectory() ? join(target, "index.html") : target;
  if (!(existsSync(file) && (await stat(file)).isFile())) return null;
  return file;
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
 * Binds the port and reports the one it got, since port 0 picks a free one.
 *
 * A busy port is the common way this fails and it arrives as an `error` event rather than a
 * rejection, so without this it surfaces as an unhandled event and a stack trace.
 *
 * @throws `CliError` naming the port when something already holds it.
 */
async function listen(server: Server, port: number): Promise<number> {
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new CliError([`port ${port} is already in use - pass --port <n> to pick another`], {
        cause: error,
      });
    }
    throw error;
  }
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : port;
}

/**
 * The `serve` command: packs, indexes, serves `dist/` on the lan and rebuilds on change.
 *
 * Binds every interface and prints the lan URL of each list's `index.json`, which is what
 * the app's developer list points at. Port 0 binds a free port. Resolves once listening;
 * the returned `close` stops the watchers and the server.
 *
 * @throws `CliError` when there is no `lists/` directory, or when the port is taken.
 */
export async function serve(repo: Repo, port: number): Promise<Serving> {
  const lists = await loadLists(repo);
  await rebuild(repo);
  const server = fileServer(repo.dist);
  const watchers = watchRepo(repo);

  let bound: number;
  try {
    bound = await listen(server, port);
  } catch (error) {
    for (const watcher of watchers) watcher.close();
    throw error;
  }
  const url = `http://${lanAddress()}:${bound}/`;
  info(`serving ${repo.dist} on ${url}`);
  for (const list of lists) {
    info(`  ${list.name}: ${url}${list.target}/index.json`);
    if (existsSync(sitePath(repo, list.target)))
      info(`  ${" ".repeat(list.name.length)}  ${url}${list.target}/site/`);
  }

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
