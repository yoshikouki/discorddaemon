/** Channel configuration from ddd.toml */
export interface ChannelConfig {
  id: string;
  on_message: string;
}

/** Top-level ddd.toml structure */
export interface Config {
  bot: {
    token: string;
  };
  channels: Record<string, ChannelConfig>;
}

/** JSON payload passed to hook stdin */
export interface HookInput {
  attachments: {
    id: string;
    filename: string;
    url: string;
    size: number;
  }[];
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  channel_id: string;
  channel_name: string;
  content: string;
  id: string;
  timestamp: string;
}

/** Result from hook execution */
export interface HookResult {
  exitCode: number;
  output: string;
  success: boolean;
}
