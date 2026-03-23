import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const docsDir = join(import.meta.dirname, "..", "docs");
const files = readdirSync(docsDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

console.log("docs/");
for (let i = 0; i < files.length; i++) {
  const isLast = i === files.length - 1;
  const prefix = isLast ? "└── " : "├── ";
  const content = readFileSync(join(docsDir, files[i]), "utf-8");
  const heading = content.match(/^#\s+(.+)$/m)?.[1] ?? "";
  const label = heading ? `${files[i]}  — ${heading}` : files[i];
  console.log(`${prefix}${label}`);
}
