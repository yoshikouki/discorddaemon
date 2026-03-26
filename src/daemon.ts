import type { Message } from "discord.js";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { type AuditWriter, nullAuditWriter } from "./audit";
import { executeHook } from "./hook";
import { IpcServer } from "./ipc/server";
import { type Logger, nullLogger } from "./logger";
import { buildMessageInfo } from "./message-info";
import type { DaemonStats, StatsTracker } from "./stats";
import type { Config, HookInput, HookResult } from "./types";

export type HookExecutor = (
  scriptPath: string,
  input: HookInput,
  options?: { timeout?: number; signal?: AbortSignal; cwd?: string }
) => Promise<HookResult>;

export interface DaemonOptions {
  audit?: AuditWriter;
  logger?: Logger;
  stats?: StatsTracker;
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
  private readonly logger: Logger;
  private readonly hookLogger: Logger;
  private readonly audit: AuditWriter;
  private readonly stats: StatsTracker | null;
  private ipcServer: IpcServer | null = null;

  constructor(
    config: Config,
    hookExecutor?: HookExecutor,
    options?: DaemonOptions
  ) {
    this.config = config;
    this.hookExecutor = hookExecutor ?? executeHook;
    this.abortController = new AbortController();
    this.logger = options?.logger ?? nullLogger;
    this.hookLogger = this.logger.child({ component: "hook" });
    this.audit = options?.audit ?? nullAuditWriter;
    this.stats = options?.stats ?? null;
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
      this.logger.info("Logged in", { user: c.user.tag });
      this.logger.info("Watching channels", {
        count: this.config.channels.size,
      });
      this.audit.write("daemon_started", {
        user: c.user.tag,
        channels: this.config.channels.size,
      });

      // Start IPC server after gateway is ready
      this.ipcServer = new IpcServer(c, this.config.token, undefined, {
        statsProvider: () => this.getStats(),
      });
      this.ipcServer.start().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error("Failed to start IPC server", { error: msg });
      });
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message);
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error("Client error", { error: error.message });
    });

    await this.client.login(this.config.token);
  }

  stop(): void {
    this.logger.info("Shutting down");
    this.audit.write("daemon_stopped");
    this.ipcServer?.stop();
    this.abortController.abort();
    this.client.destroy();
    this.logger.info("Stopped");
  }

  getStats(): DaemonStats | null {
    return this.stats?.getStats() ?? null;
  }

  private handleMessage(message: Message): void {
    if (message.author.bot) {
      return;
    }

    const channelConfig = this.config.channels.get(message.channelId);
    if (!channelConfig) {
      return;
    }

    this.stats?.recordMessageReceived();
    this.audit.write("message_received", {
      channel: channelConfig.name,
      channelId: message.channelId,
      user: message.author.username,
      userId: message.author.id,
    });

    this.runHook(message, channelConfig.on_message).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.hookLogger.error("Error in channel", {
        channel: channelConfig.name,
        error: errMsg,
      });
    });
  }

  private async runHook(message: Message, scriptPath: string): Promise<void> {
    const input = buildHookInput(message);
    const startTime = Date.now();
    const result = await this.hookExecutor(scriptPath, input, {
      signal: this.abortController.signal,
      cwd: this.config.configDir,
    });
    const durationMs = Date.now() - startTime;

    this.stats?.recordHookExecuted();

    if (result.timedOut) {
      this.stats?.recordHookError();
      this.hookLogger.warn("Timed out", { script: scriptPath, durationMs });
      this.audit.write("hook_executed", {
        script: scriptPath,
        success: false,
        timedOut: true,
        durationMs,
      });
      return;
    }

    if (!result.success) {
      this.stats?.recordHookError();
      if (result.error) {
        this.hookLogger.error("stderr output", { stderr: result.error });
      }
      this.hookLogger.error("Non-zero exit", {
        exitCode: result.exitCode,
        script: scriptPath,
      });
      this.audit.write("hook_executed", {
        script: scriptPath,
        success: false,
        exitCode: result.exitCode,
        durationMs,
      });
      return;
    }

    this.audit.write("hook_executed", {
      script: scriptPath,
      success: true,
      durationMs,
    });

    if (result.output) {
      try {
        await message.reply(result.output);
        this.stats?.recordReplySent();
        this.audit.write("reply_sent", {
          channelId: message.channelId,
          messageId: message.id,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.hookLogger.error("Failed to send reply", { error: errMsg });
        this.audit.write("reply_failed", {
          channelId: message.channelId,
          error: errMsg,
        });
      }
    }
  }
}
