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

  // a zip records a DOS timestamp of the local calendar fields, so a UTC-pinned mtime rendered
  // differently per machine and produced byte-different archives of identical files
  it("stamps the same dos timestamp whatever the machine's timezone", () => {
    // arrange: 2000-01-01 00:00, packed little-endian at the local file header's fixed offsets
    const dosTime = 0;
    const dosDate = (2000 - 1980) * 512 + 1 * 32 + 1;
    const word = (bytes: Uint8Array, at: number) =>
      (bytes[at] as number) + (bytes[at + 1] as number) * 256;

    // act
    const zip = deterministicZip({ "a.txt": encoder.encode("alpha") });

    // assert
    expect(word(zip, 10)).toBe(dosTime);
    expect(word(zip, 12)).toBe(dosDate);
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
