import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  dts: false,
  hash: false,
  fixedExtension: false,
  exports: false,
  deps: { neverBundle: ["@aletheia-ios/sdk", "esbuild", "fflate", "sharp", "zod"] },
  banner: { js: "#!/usr/bin/env node" },
});
