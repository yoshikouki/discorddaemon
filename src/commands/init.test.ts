import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "./init";

describe("initCommand", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("creates ddd.toml and hooks/echo.sh", async () => {
    await initCommand(dir);

    const config = await Bun.file(join(dir, "ddd.toml")).text();
    expect(config).toContain("[bot]");
    expect(config).toContain("[channels.general]");

    const hook = await Bun.file(join(dir, "hooks", "echo.sh")).text();
    expect(hook).toStartWith("#!/bin/sh");

    const { access, constants } = await import("node:fs/promises");
    await access(join(dir, "hooks", "echo.sh"), constants.X_OK);
  });

  test("creates hooks directory", async () => {
    await initCommand(dir);
    const entries = await readdir(join(dir, "hooks"));
    expect(entries).toContain("echo.sh");
  });

  test("throws if ddd.toml already exists", async () => {
    await Bun.write(join(dir, "ddd.toml"), "existing");
    await expect(initCommand(dir)).rejects.toThrow("already exists");
  });

  test("does not overwrite existing hooks/echo.sh", async () => {
    const hooksDir = join(dir, "hooks");
    await mkdir(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "echo.sh");
    const customContent = "#!/bin/sh\necho custom\n";
    await Bun.write(hookPath, customContent);
    await chmod(hookPath, 0o755);

    await initCommand(dir);

    const content = await Bun.file(hookPath).text();
    expect(content).toBe(customContent);
  });
});
