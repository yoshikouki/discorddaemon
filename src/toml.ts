type TomlTable = Record<string, string | TomlTable>;

function stripComment(line: string): string {
    let inString = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];

        if (char === '"' && line[index - 1] !== "\\") {
            inString = !inString;
        }

        if (char === "#" && !inString) {
            return line.slice(0, index).trim();
        }
    }

    return line.trim();
}

function unescapeTomlString(value: string): string {
    return value.replace(/\\(["\\])/g, "$1");
}

function getOrCreateTable(root: TomlTable, path: string[]): TomlTable {
    let current = root;

    for (const segment of path) {
        const existing = current[segment];

        if (existing === undefined) {
            const next: TomlTable = {};
            current[segment] = next;
            current = next;
            continue;
        }

        if (typeof existing === "string") {
            throw new Error(`Invalid TOML: "${segment}" is already a value.`);
        }

        current = existing;
    }

    return current;
}

export function parseToml(source: string): TomlTable {
    const root: TomlTable = {};
    let currentTable = root;

    for (const [lineNumber, rawLine] of source.split(/\r?\n/u).entries()) {
        const line = stripComment(rawLine);

        if (!line) {
            continue;
        }

        const tableMatch = line.match(/^\[(.+)\]$/u);
        if (tableMatch) {
            const path = tableMatch[1]
                .split(".")
                .map((segment) => segment.trim())
                .filter(Boolean);

            if (path.length === 0) {
                throw new Error(
                    `Invalid TOML on line ${lineNumber + 1}: empty table name.`,
                );
            }

            currentTable = getOrCreateTable(root, path);
            continue;
        }

        const keyValueMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"(.*)"$/u);
        if (!keyValueMatch) {
            throw new Error(
                `Invalid TOML on line ${lineNumber + 1}: expected key = \"value\".`,
            );
        }

        const [, key, rawValue] = keyValueMatch;
        currentTable[key] = unescapeTomlString(rawValue);
    }

    return root;
}
