import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR, DATA_DIR } from "../paths";

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

export async function initCommand(
  configDir = CONFIG_DIR,
  dataDir = DATA_DIR
): Promise<void> {
  await mkdir(configDir, { recursive: true });

  const configPath = join(configDir, "ddd.toml");
  const configFile = Bun.file(configPath);

  if (await configFile.exists()) {
    throw new Error(`${configPath} already exists`);
  }

  await Bun.write(configPath, TEMPLATE_CONFIG);
  console.error(`[ddd] Created ${configPath}`);

  const hooksDir = join(configDir, "hooks");
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

  await mkdir(dataDir, { recursive: true });
  console.error(`[ddd] Created ${dataDir}/`);

  console.error(`\n[ddd] Ready! Edit ${configPath}, then run: ddd start`);
}
