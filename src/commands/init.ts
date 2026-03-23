import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

const TEMPLATE_CONFIG = `[bot]
token = ""  # or set DDD_TOKEN env var

[channels.general]
id = ""
on_message = "./hooks/echo.sh"
`;

const TEMPLATE_HOOK = `#!/bin/sh
# Echo hook — reads message JSON from stdin, prints reply to stdout.
# Input format: { "message": { "content": "...", "author": { ... }, ... } }
cat
`;

export async function initCommand(): Promise<void> {
  const configPath = join(process.cwd(), "ddd.toml");
  const configFile = Bun.file(configPath);

  if (await configFile.exists()) {
    console.error("[ddd] ddd.toml already exists");
    process.exit(1);
  }

  await Bun.write(configPath, TEMPLATE_CONFIG);
  console.error("[ddd] Created ddd.toml");

  const hooksDir = join(process.cwd(), "hooks");
  await mkdir(hooksDir, { recursive: true });
  console.error("[ddd] Created hooks/");

  const hookPath = join(hooksDir, "echo.sh");
  const hookFile = Bun.file(hookPath);
  if (await hookFile.exists()) {
    console.error("[ddd] hooks/echo.sh already exists, skipping");
  } else {
    await Bun.write(hookPath, TEMPLATE_HOOK);
    await chmod(hookPath, 0o755);
    console.error("[ddd] Created hooks/echo.sh");
  }

  console.error("\n[ddd] Ready! Edit ddd.toml, then run: ddd start");
}
