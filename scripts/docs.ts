import { join } from "node:path";
import { Glob } from "bun";

const docsDir = join(import.meta.dirname, "..", "docs");
const glob = new Glob("*.md");
const files = Array.from(glob.scanSync(docsDir)).sort();

console.log("docs/");
for (let i = 0; i < files.length; i++) {
  const isLast = i === files.length - 1;
  const prefix = isLast ? "└── " : "├── ";
  const content = await Bun.file(join(docsDir, files[i])).text();
  const heading = content.match(/^#\s+(.+)$/m)?.[1] ?? "";
  const label = heading ? `${files[i]}  — ${heading}` : files[i];
  console.log(`${prefix}${label}`);
}
