import { loadConfig } from "../config";
import { Daemon } from "../daemon";

export async function startCommand(args: { config?: string }): Promise<void> {
  const config = await loadConfig(args.config);
  const daemon = new Daemon(config);

  const shutdown = () => {
    daemon.stop();
    setTimeout(() => process.exit(0), 100);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await daemon.start();
}
