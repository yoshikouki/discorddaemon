import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "./init";

describe("initCommand", () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-init-"));
    originalCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true });
  });

  test("creates ddd.toml and hooks/echo.sh", async () => {
    await initCommand();

    const config = await Bun.file(join(dir, "ddd.toml")).text();
    expect(config).toContain("[bot]");
    expect(config).toContain("[channels.general]");

    const hook = await Bun.file(join(dir, "hooks", "echo.sh")).text();
    expect(hook).toStartWith("#!/bin/sh");

    // Verify executable permission — access() throws if not executable
    const { access, constants } = await import("node:fs/promises");
    await access(join(dir, "hooks", "echo.sh"), constants.X_OK);
  });

  test("creates hooks directory", async () => {
    await initCommand();
    const entries = await readdir(join(dir, "hooks"));
    expect(entries).toContain("echo.sh");
  });

  test("does not overwrite existing hooks/echo.sh", async () => {
    const hooksDir = join(dir, "hooks");
    await mkdir(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "echo.sh");
    const customContent = "#!/bin/sh\necho custom\n";
    await Bun.write(hookPath, customContent);
    await chmod(hookPath, 0o755);

    await initCommand();

    const content = await Bun.file(hookPath).text();
    expect(content).toBe(customContent);
  });
});
