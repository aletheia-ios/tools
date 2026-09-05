import { capture } from "@test/repo";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError, info, kb, report, warn } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CliError", () => {
  it("joins its lines into the message and keeps the cause", () => {
    // arrange
    const cause = new Error("disk");

    // act
    const error = new CliError(["one", "two"], { cause });

    // assert
    expect(error.name).toBe("CliError");
    expect(error.message).toBe("one\ntwo");
    expect(error.lines).toEqual(["one", "two"]);
    expect(error.cause).toBe(cause);
  });
});

describe("report", () => {
  it("prints each line of a CliError on stderr", () => {
    // arrange
    const captured = capture();

    // act
    report(new CliError(["a", "b"]));

    // assert
    expect(captured.err).toEqual(["a", "b"]);
  });

  it("prints anything else as-is", () => {
    // arrange
    const captured = capture();
    const error = new TypeError("boom");

    // act
    report(error);

    // assert
    expect(captured.err).toEqual([String(error)]);
  });
});

describe("info and warn", () => {
  it("write to stdout and stderr with the warning prefix", () => {
    // arrange
    const captured = capture();

    // act
    info("hello");
    warn("careful");

    // assert
    expect(captured.out).toEqual(["hello"]);
    expect(captured.err).toEqual(["warning: careful"]);
  });
});

describe("kb", () => {
  it("formats bytes with one decimal", () => {
    // arrange
    const bytes = 1536;

    // act
    const text = kb(bytes);

    // assert
    expect(text).toBe("1.5 kB");
  });
});
