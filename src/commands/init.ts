import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG_DIR } from "../config";

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

export async function initCommand(baseDir = DEFAULT_CONFIG_DIR): Promise<void> {
  await mkdir(baseDir, { recursive: true });

  const configPath = join(baseDir, "ddd.toml");
  const configFile = Bun.file(configPath);

  if (await configFile.exists()) {
    throw new Error(`${configPath} already exists`);
  }

  await Bun.write(configPath, TEMPLATE_CONFIG);
  console.error(`[ddd] Created ${configPath}`);

  const hooksDir = join(baseDir, "hooks");
  await mkdir(hooksDir, { recursive: true });
  console.error(`[ddd] Created ${hooksDir}/`);

  const hookPath = join(hooksDir, "echo.sh");
  const hookFile = Bun.file(hookPath);
  if (await hookFile.exists()) {
    console.error("[ddd] hooks/echo.sh already exists, skipping");
  } else {
    await Bun.write(hookPath, TEMPLATE_HOOK);
    await chmod(hookPath, 0o755);
    console.error(`[ddd] Created ${hookPath}`);
  }

  console.error(`\n[ddd] Ready! Edit ${configPath}, then run: ddd start`);
}
