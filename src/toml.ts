const SECTION_RE = /^\[([^\]]+)\]$/;
const KV_RE = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"$/;

/**
 * Minimal TOML parser — string values only, sections, comments.
 * Returns Record<section, Record<key, value>>.
 * Top-level keys go under the "" section.
 */
export function parseTOML(
  input: string
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = "";

  for (const raw of input.split("\n")) {
    const line = raw.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      currentSection = sectionMatch[1] ?? "";
      result[currentSection] ??= {};
      continue;
    }

    const kvMatch = line.match(KV_RE);
    if (kvMatch) {
      const key = kvMatch[1] ?? "";
      const value = kvMatch[2] ?? "";
      result[currentSection] ??= {};
      const section = result[currentSection];
      if (section) {
        section[key] = value;
      }
      continue;
    }

    throw new Error(`Invalid TOML line: ${line}`);
  }

  return result;
}
