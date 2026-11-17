// Publishes an installer to the releases repo. This is the ONLY path that publishes:
// `pnpm dist:win` builds the same installer with `--publish never`, so the EXEs produced while
// testing can never become an update someone's machine downloads.
//
// The GitHub token is read from the credential helper git already uses to push, so there is no
// token in a file, in the repo, or in the shell history.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const REPO = "voldemort9999/subxvoice-releases";

function githubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  // `git credential fill` prints key=value lines; the password is the token.
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const token = out.match(/^password=(.*)$/m)?.[1];
  if (!token) {
    console.error("No GitHub token. Either set GH_TOKEN, or run a `git push` once so the");
    console.error("credential helper stores one.");
    process.exit(1);
  }
  return token;
}

const token = githubToken();

async function github(method, path, body) {
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: body && JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/**
 * Creates the release before electron-builder runs.
 *
 * electron-builder uploads each artifact concurrently, and every uploader creates the release if
 * it finds none — so on a first publish two of them race and the assets land in two separate
 * releases sharing one tag, neither of them complete. An already-present release is just reused.
 */
async function ensureRelease() {
  const tag = `v${version}`;
  const found = await github("GET", `/releases/tags/${tag}`);
  if (found.status === 200) {
    if (found.body.draft) await github("PATCH", `/releases/${found.body.id}`, { draft: false });
    console.log(`Reusing the existing ${tag} release.`);
    return;
  }
  const created = await github("POST", "/releases", {
    tag_name: tag,
    name: `SUBXVoice ${version}`,
    draft: false,
    prerelease: false,
  });
  if (created.status !== 201) {
    console.error(`Could not create the ${tag} release:`, created.status, created.body.message);
    process.exit(1);
  }
  console.log(`Created the ${tag} release.`);
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, GH_TOKEN: token },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

console.log(`\nPublishing SUBXVoice ${version} to the releases repo.`);
console.log("Every installed copy will download this. Ctrl+C now if that is not what you meant.\n");

await ensureRelease();
run("node", ["scripts/build-icon.mjs"]);
run("npx", ["electron-vite", "build"]);
run("npx", ["electron-builder", "--win", "--publish", "always"]);

console.log(`\nDone. SUBXVoice ${version} is live.`);
console.log(`https://github.com/${REPO}/releases/latest`);
