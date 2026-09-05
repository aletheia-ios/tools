import { mkdtempSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { OWN_ROOT } from "@/context";
import { CliError } from "@/lib/log";
import { findIcon, ICON_SIZE, rasterise } from "./icon";

const TEMPLATE_ICON = join(OWN_ROOT, "template", "icon.svg");

function dir(): string {
  return mkdtempSync(join(tmpdir(), "aletheia-icon-"));
}

function png(size: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
}

describe("findIcon", () => {
  it("returns the single icon present", async () => {
    // arrange
    const folder = dir();
    await copyFile(TEMPLATE_ICON, join(folder, "icon.svg"));

    // act
    const path = findIcon(folder, "demo");

    // assert
    expect(path).toBe(join(folder, "icon.svg"));
  });

  it("rejects a folder with no icon", () => {
    // arrange
    const folder = dir();

    // act
    const attempt = () => findIcon(folder, "demo");

    // assert
    expect(attempt).toThrow(CliError);
    expect(attempt).toThrow(/no icon/);
  });

  it("rejects a folder with more than one icon", async () => {
    // arrange
    const folder = dir();
    await copyFile(TEMPLATE_ICON, join(folder, "icon.svg"));
    await writeFile(join(folder, "icon.png"), await png(300));

    // act
    const attempt = () => findIcon(folder, "demo");

    // assert
    expect(attempt).toThrow(/more than one icon \(icon.svg, icon.png\)/);
  });
});

describe("rasterise", () => {
  it("turns an svg into a square png of the package size", async () => {
    // arrange
    const source = TEMPLATE_ICON;

    // act
    const buffer = await rasterise(source, "demo");
    const metadata = await sharp(buffer).metadata();

    // assert
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(ICON_SIZE);
    expect(metadata.height).toBe(ICON_SIZE);
  });

  it("accepts a raster that is large enough", async () => {
    // arrange
    const folder = dir();
    const source = join(folder, "icon.png");
    await writeFile(source, await png(256));

    // act
    const metadata = await sharp(await rasterise(source, "demo")).metadata();

    // assert
    expect(metadata.width).toBe(ICON_SIZE);
  });

  it("rejects a raster that is too small to upscale", async () => {
    // arrange
    const folder = dir();
    const source = join(folder, "icon.png");
    await writeFile(source, await png(64));

    // act
    const attempt = rasterise(source, "demo");

    // assert
    await expect(attempt).rejects.toThrow(/icon is 64x64, need at least 256px/);
  });
});
