/** Bytes per kilobyte as the size lines report it. */
const KB = 1024;

/**
 * A failure the cli reports as plain lines and exits 1 on.
 *
 * Anything else that escapes is a bug in the cli and is printed with its stack. Commands
 * collect every problem they can find into one `CliError` so a broken repository is fixed
 * in one round trip rather than one file at a time.
 */
export class CliError extends Error {
  /** One problem per line, already prefixed with the file or package it belongs to. */
  readonly lines: string[];

  constructor(lines: string[], options?: ErrorOptions) {
    super(lines.join("\n"), options);
    this.name = "CliError";
    this.lines = lines;
  }
}

/** Prints a progress line to stdout. */
export function info(message: string): void {
  console.log(message);
}

/** Prints a non-fatal problem to stderr with a `warning:` prefix. */
export function warn(message: string): void {
  console.warn(`warning: ${message}`);
}

/**
 * Prints an error to stderr: a `CliError` as its lines, anything else as-is with its stack.
 *
 * Shared by the process entry and by `serve`, which keeps running after a failed rebuild.
 */
export function report(error: unknown): void {
  if (error instanceof CliError) for (const line of error.lines) console.error(line);
  else console.error(error);
}

/** Formats a byte count as `12.3 kB`. */
export function kb(bytes: number): string {
  return `${(bytes / KB).toFixed(1)} kB`;
}
