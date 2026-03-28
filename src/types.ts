export interface ChannelConfig {
  id: string;
  name: string;
  on_message: string;
}

export interface Config {
  channels: Map<string, ChannelConfig>;
  configDir: string;
  configPath: string;
  defaultGuild?: string;
  defaultHook?: string;
  token: string;
}

export interface HookInput {
  message: {
    id: string;
    content: string;
    author: {
      id: string;
      username: string;
      bot: boolean;
    };
    channel: {
      id: string;
      name: string | null;
    };
    guild: {
      id: string;
      name: string;
    } | null;
    timestamp: string;
  };
}

export interface HookResult {
  error: string;
  exitCode: number;
  output: string;
  success: boolean;
  timedOut: boolean;
}
