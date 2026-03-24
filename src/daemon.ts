import type { Message } from "discord.js";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { executeHook } from "./hook";
import { buildMessageInfo } from "./message-info";
import type { Config, HookInput, HookResult } from "./types";

export type HookExecutor = (
  scriptPath: string,
  input: HookInput,
  options?: { timeout?: number; signal?: AbortSignal; cwd?: string }
) => Promise<HookResult>;

function log(msg: string): void {
  console.error(`[ddd] ${msg}`);
}

export function buildHookInput(message: Message): HookInput {
  const info = buildMessageInfo(message);
  return {
    message: {
      id: info.id,
      content: info.content,
      author: info.author,
      channel: info.channel,
      guild: info.guild,
      timestamp: info.timestamp,
    },
  };
}

export class Daemon {
  private readonly client: Client;
  private readonly config: Config;
  private readonly abortController: AbortController;
  private readonly hookExecutor: HookExecutor;

  constructor(config: Config, hookExecutor?: HookExecutor) {
    this.config = config;
    this.hookExecutor = hookExecutor ?? executeHook;
    this.abortController = new AbortController();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async start(): Promise<void> {
    this.client.once(Events.ClientReady, (c) => {
      log(`Logged in as ${c.user.tag}`);
      log(`Watching ${this.config.channels.size} channel(s)`);
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message);
    });

    this.client.on(Events.Error, (error) => {
      log(`Client error: ${error.message}`);
    });

    await this.client.login(this.config.token);
  }

  stop(): void {
    log("Shutting down...");
    this.abortController.abort();
    this.client.destroy();
    log("Stopped");
  }

  private handleMessage(message: Message): void {
    if (message.author.bot) {
      return;
    }

    const channelConfig = this.config.channels.get(message.channelId);
    if (!channelConfig) {
      return;
    }

    this.runHook(message, channelConfig.on_message).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[hook] Error in #${channelConfig.name}: ${errMsg}`);
    });
  }

  private async runHook(message: Message, scriptPath: string): Promise<void> {
    const input = buildHookInput(message);
    const result = await this.hookExecutor(scriptPath, input, {
      signal: this.abortController.signal,
      cwd: this.config.configDir,
    });

    if (result.timedOut) {
      console.error(`[hook] Timed out: ${scriptPath}`);
      return;
    }

    if (!result.success) {
      if (result.error) {
        console.error(`[hook] stderr: ${result.error}`);
      }
      console.error(`[hook] Exit code ${result.exitCode}: ${scriptPath}`);
      return;
    }

    if (result.output) {
      try {
        await message.reply(result.output);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[hook] Failed to send reply: ${errMsg}`);
      }
    }
  }
}
