import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { deterministicZip } from "./zip";

const encoder = new TextEncoder();

describe("deterministicZip", () => {
  it("produces identical bytes for the same files in any order", () => {
    // arrange
    const a = encoder.encode("alpha");
    const b = encoder.encode("beta");

    // act
    const first = deterministicZip({ "a.txt": a, "b.txt": b });
    const second = deterministicZip({ "b.txt": b, "a.txt": a });

    // assert
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("round-trips every file", () => {
    // arrange
    const files = { "source.json": encoder.encode("{}"), "main.js": encoder.encode("1;") };

    // act
    const unpacked = unzipSync(deterministicZip(files));

    // assert
    expect(Object.keys(unpacked).sort()).toEqual(["main.js", "source.json"]);
    expect(Buffer.from(unpacked["main.js"] as Uint8Array).toString()).toBe("1;");
  });
});
