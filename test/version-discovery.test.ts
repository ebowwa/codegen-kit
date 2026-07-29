import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverInternalVersions } from "../src/version-discovery.js";

/** Write a package.json at <repoRoot>/<relDir>/package.json with the given fields. */
function writePkg(repoRoot: string, relDir: string, pkg: Record<string, unknown>): void {
  const abs = join(repoRoot, relDir);
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, "package.json"), JSON.stringify(pkg));
}

describe("discoverInternalVersions", () => {
  test("finds scoped packages in the monorepo and returns them prefixed with ^", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "vd-"));
    writePkg(repoRoot, "packages/foo", { name: "@ebowwa/foo", version: "1.2.3" });
    writePkg(repoRoot, "packages/bar", { name: "@ebowwa/bar", version: "0.4.1" });
    // Unscoped package must be ignored entirely.
    writePkg(repoRoot, "packages/other", { name: "unscoped-pkg", version: "9.9.9" });
    // package.json missing a version field must be skipped.
    writePkg(repoRoot, "packages/no-version", { name: "@ebowwa/noversion" });

    const versions = discoverInternalVersions({ repoRoot, scope: "@ebowwa" });

    expect(versions["@ebowwa/foo"]).toBe("^1.2.3");
    expect(versions["@ebowwa/bar"]).toBe("^0.4.1");
    expect(versions["unscoped-pkg"]).toBeUndefined();
    expect(versions["@ebowwa/noversion"]).toBeUndefined();
  });

  test("versionPrefix:'' returns raw versions without the leading ^", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "vd-raw-"));
    writePkg(repoRoot, "packages/foo", { name: "@ebowwa/foo", version: "2.0.0" });

    const raw = discoverInternalVersions({ repoRoot, scope: "@ebowwa", versionPrefix: "" });
    expect(raw["@ebowwa/foo"]).toBe("2.0.0");
  });

  test("externalEntries are applied last and override discovered entries", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "vd-ext-"));
    writePkg(repoRoot, "packages/foo", { name: "@ebowwa/foo", version: "1.2.3" });

    const versions = discoverInternalVersions({
      repoRoot,
      scope: "@ebowwa",
      externalEntries: {
        "@ebowwa/foo": "link:../packages/foo", // overrides the discovered ^1.2.3
        "@ebowwa/runpod": "external",          // brand-new entry, not on disk
      },
    });

    expect(versions["@ebowwa/foo"]).toBe("link:../packages/foo");
    expect(versions["@ebowwa/runpod"]).toBe("external");
  });

  test("external entries are passed through untouched (no prefix added)", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "vd-extpass-"));
    const versions = discoverInternalVersions({
      repoRoot,
      scope: "@ebowwa",
      versionPrefix: "^",
      externalEntries: { "@ebowwa/runpod": "external" },
    });
    expect(versions["@ebowwa/runpod"]).toBe("external");
  });

  test("published-but-not-co-located packages under node_modules/@scope are discovered", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "vd-nm-"));
    writePkg(repoRoot, "packages/foo", { name: "@ebowwa/foo", version: "1.0.0" });
    // A published package only present in node_modules (not co-located in the monorepo).
    writePkg(repoRoot, "node_modules/@ebowwa/published", { name: "@ebowwa/published", version: "3.1.4" });

    const versions = discoverInternalVersions({ repoRoot, scope: "@ebowwa" });
    expect(versions["@ebowwa/foo"]).toBe("^1.0.0");
    expect(versions["@ebowwa/published"]).toBe("^3.1.4");
  });

  test("skips configured dirs during the walk", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "vd-skip-"));
    writePkg(repoRoot, "packages/foo", { name: "@ebowwa/foo", version: "1.0.0" });
    // A scoped package inside dist/ — must be skipped (build output, not authoritative).
    writePkg(repoRoot, "dist/pkg", { name: "@ebowwa/built", version: "0.0.0" });

    const versions = discoverInternalVersions({ repoRoot, scope: "@ebowwa" });
    expect(versions["@ebowwa/foo"]).toBe("^1.0.0");
    expect(versions["@ebowwa/built"]).toBeUndefined();
  });
});
