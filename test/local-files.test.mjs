import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAttachment } from "../build/discord/attachments.js";
import { loadConfig } from "../build/config.js";

const limits = { attachmentBytes: 1024 * 1024, attachmentTimeoutMs: 1000 };

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "mcp-local-files-"));
  const root = join(base, "stickers");
  mkdirSync(root);
  writeFileSync(join(root, "ok.png"), "inside");
  writeFileSync(join(base, "secret.env"), "outside");
  return { base, root, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
function policy(root, overrides = {}) {
  return {
    allowedGuildIds: [], allowedChannelIds: [], allowedDmUserIds: [],
    allowLocalFiles: true, allowLocalFilesOverHttp: false, allowedLocalRoots: [root],
    remoteMode: true, ...overrides,
  };
}

test("HTTP mode refuses local paths unless allowLocalFilesOverHttp is set, even with allowLocalFiles + roots", async () => {
  const s = sandbox();
  try {
    await assert.rejects(loadAttachment(join(s.root, "ok.png"), undefined, policy(s.root), limits, true), /Remote HTTP mode cannot read local file paths/);
  } finally { s.cleanup(); }
});

test("HTTP mode with explicit opt-in reads a file inside the allowed root", async () => {
  const s = sandbox();
  try {
    await assert.doesNotReject(loadAttachment(join(s.root, "ok.png"), undefined, policy(s.root, { allowLocalFilesOverHttp: true }), limits, true));
  } finally { s.cleanup(); }
});

test("HTTP opt-in still enforces the root allowlist", async () => {
  const s = sandbox();
  try {
    const p = policy(s.root, { allowLocalFilesOverHttp: true });
    await assert.rejects(loadAttachment(join(s.base, "secret.env"), undefined, p, limits, true), /outside configured allowed roots/);
    await assert.rejects(loadAttachment(join(s.root, "..", "secret.env"), undefined, p, limits, true), /outside configured allowed roots/);
  } finally { s.cleanup(); }
});

test("HTTP opt-in cannot escape the root through a symlink", async (t) => {
  const s = sandbox();
  try {
    try { symlinkSync(join(s.base, "secret.env"), join(s.root, "link.png")); }
    catch { t.skip("symlinks not permitted on this host"); return; }
    await assert.rejects(loadAttachment(join(s.root, "link.png"), undefined, policy(s.root, { allowLocalFilesOverHttp: true }), limits, true), /outside configured allowed roots/);
  } finally { s.cleanup(); }
});

test("HTTP opt-in does nothing when allowLocalFiles is off", async () => {
  const s = sandbox();
  try {
    await assert.rejects(loadAttachment(join(s.root, "ok.png"), undefined, policy(s.root, { allowLocalFiles: false, allowLocalFilesOverHttp: true }), limits, true), /Local file attachments are disabled/);
  } finally { s.cleanup(); }
});

test("config: allowLocalFilesOverHttp defaults to false and requires allowLocalFiles", () => {
  const s = sandbox();
  const previous = process.env.MCP_CONFIG_PATH;
  try {
    const cfgPath = join(s.base, "config.json");
    process.env.MCP_CONFIG_PATH = cfgPath;
    const env = { DISCORD_TOKEN: "x", MCP_TRANSPORT: "stdio" };

    writeFileSync(cfgPath, JSON.stringify({ policy: { allowLocalFiles: true, allowedLocalRoots: [s.root] } }));
    assert.equal(loadConfig(env).policy.allowLocalFilesOverHttp, false);

    writeFileSync(cfgPath, JSON.stringify({ policy: { allowLocalFilesOverHttp: true } }));
    assert.throws(() => loadConfig(env), /allowLocalFilesOverHttp requires policy\.allowLocalFiles/);
  } finally {
    if (previous === undefined) delete process.env.MCP_CONFIG_PATH; else process.env.MCP_CONFIG_PATH = previous;
    s.cleanup();
  }
});
