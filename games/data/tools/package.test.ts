import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>;
}

const read = (path: string): PackageJson => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as PackageJson;

describe("package scripts", () => {
  const root = read("../../package.json");
  const data = read("../package.json");

  it("keep the glyph conversion out of the workspace-wide build", () => {
    // `npm run build` runs the "build" script of every workspace. The conversion downloads
    // KanjiVG on a fresh checkout, and building the games must not need the network.
    expect(root.scripts?.build).toContain("--workspaces");
    expect(data.scripts?.build).toBeUndefined();
    expect(data.scripts?.generate).toBe("tsx build.ts");
  });

  it("still offer the conversion as `npm run data`", () => {
    expect(root.scripts?.data).toBe("npm run generate --workspace @kankyouken/glyph-data");
  });
});
