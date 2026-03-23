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
    id: string;
    channel_id: string;
    channel_name: string;
    author: {
        id: string;
        username: string;
        bot: boolean;
    };
    content: string;
    timestamp: string;
    attachments: {
        id: string;
        filename: string;
        url: string;
        size: number;
    }[];
}

/** Result from hook execution */
export interface HookResult {
    success: boolean;
    output: string;
    exitCode: number;
}
