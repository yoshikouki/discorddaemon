import { parseArgs } from "node:util";

export type CliCommand =
    | { name: "start"; configPath: string }
    | { name: "init" };

const DEFAULT_CONFIG_PATH = "ddd.toml";

function buildUsage(): string {
    return ["Usage:", "  ddd start [-c path]", "  ddd init"].join("\n");
}

export function parseCliArgs(args: string[]): CliCommand {
    const [command, ...rest] = args;

    if (!command) {
        throw new Error(buildUsage());
    }

    if (command === "init") {
        if (rest.length > 0) {
            throw new Error(`Unknown arguments for init.\n\n${buildUsage()}`);
        }

        return { name: "init" };
    }

    if (command === "start") {
        const { values, positionals } = parseArgs({
            args: rest,
            options: {
                config: {
                    type: "string",
                    short: "c",
                    default: DEFAULT_CONFIG_PATH,
                },
            },
            allowPositionals: true,
            strict: true,
        });

        if (positionals.length > 0) {
            throw new Error(`Unknown arguments for start.\n\n${buildUsage()}`);
        }

        return {
            name: "start",
            configPath: values.config,
        };
    }

    throw new Error(`Unknown command: ${command}\n\n${buildUsage()}`);
}
