// Writes docs/TESTS.md: every automated test of the Mac app, by package and file, in the words of
// the test itself. Generated rather than written by hand, so it never drifts from the code:
//   pnpm tests:list
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Each package that has tests, with what it is in plain words. */
const PACKAGES = [
  { dir: "apps/desktop", about: "The Mac app itself: dictation flow, accounts, history, settings, updates." },
  {
    dir: "packages/core",
    about: "The heart: your spelling rules, the paste and history, learning from your fixes.",
  },
  { dir: "packages/providers", about: "The connection to our server that hears and writes the text." },
];

function list(dir) {
  const name = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).name;
  const out = execFileSync("pnpm", ["--filter", name, "exec", "vitest", "list", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return { name, tests: JSON.parse(out.slice(out.indexOf("["))) };
}

const sections = [];
const counts = [];
let total = 0;
for (const pkg of PACKAGES) {
  const { name, tests } = list(pkg.dir);
  total += tests.length;
  counts.push(`| \`${name}\` | ${tests.length} | ${pkg.about} |`);
  const byFile = new Map();
  for (const test of tests) {
    const file = relative(join(root, pkg.dir), test.file);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(test);
  }
  const lines = [`## ${name} (${tests.length})`, "", pkg.about, ""];
  for (const [file, fileTests] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### \`${file}\` (${fileTests.length})`, "");
    let group = null;
    for (const test of fileTests) {
      const parts = test.name.split(" > ");
      const title = parts.pop();
      const heading = parts.join(" › ");
      if (heading && heading !== group) {
        lines.push(`**${heading}**`, "");
        group = heading;
      }
      lines.push(`- ${title}`);
    }
    lines.push("");
  }
  sections.push(lines.join("\n"));
}

const doc = `# Tests

Every automated test of the Mac app (${total} in all), in the words of the test itself. Each line is
something the app must do; \`pnpm check\` runs them all, and a change is not done until they pass.

This file is generated: run \`pnpm tests:list\` after adding or renaming a test. It covers the Mac
app only; the Windows app and the server keep their own tests in their own repositories.

| Package | Tests | What it covers |
|---|---|---|
${counts.join("\n")}

**Run them:** \`pnpm check\` (all, with lint and types) · \`pnpm --filter @subx/desktop test\` (one package)

${sections.join("\n")}`;

writeFileSync(join(root, "docs", "TESTS.md"), doc);
console.log(`docs/TESTS.md: ${total} tests`);
