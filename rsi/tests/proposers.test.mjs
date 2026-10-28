import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandProposer } from "../src/proposers.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(testsDir, "..");

test("CommandProposer runs in an empty temporary directory and cleans it up", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-proposer-test-"));
  const probeScript = path.join(root, "probe.cjs");
  const probeOutput = path.join(root, "probe.json");
  try {
    await fs.writeFile(
      probeScript,
      [
        'const fs = require("node:fs");',
        "fs.writeFileSync(process.argv[2], JSON.stringify({ cwd: process.cwd(), entries: fs.readdirSync(process.cwd()) }));",
        'console.log(JSON.stringify({ files: {} }));'
      ].join("\n"),
      "utf8"
    );

    const proposer = new CommandProposer({
      command: process.execPath,
      args: [probeScript, probeOutput],
      timeoutMs: 30000
    });
    const proposal = await proposer.propose({ prompt: "ignored" });
    assert.deepEqual(proposal.files, {});

    const probe = JSON.parse(await fs.readFile(probeOutput, "utf8"));
    assert.notEqual(path.resolve(probe.cwd), path.resolve(rsiRoot));
    assert.match(path.basename(probe.cwd), /^rsi-proposal-/);
    assert.deepEqual(probe.entries, []);
    await assert.rejects(fs.stat(probe.cwd), /ENOENT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CommandProposer still honors an explicitly supplied cwd", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-proposer-test-"));
  const probeScript = path.join(root, "probe.cjs");
  const probeOutput = path.join(root, "probe.json");
  try {
    await fs.writeFile(
      probeScript,
      [
        'const fs = require("node:fs");',
        "fs.writeFileSync(process.argv[2], JSON.stringify({ cwd: process.cwd(), entries: fs.readdirSync(process.cwd()) }));",
        'console.log(JSON.stringify({ files: {} }));'
      ].join("\n"),
      "utf8"
    );

    const proposer = new CommandProposer({
      command: process.execPath,
      args: [probeScript, probeOutput],
      timeoutMs: 30000,
      cwd: root
    });
    await proposer.propose({ prompt: "ignored" });

    const probe = JSON.parse(await fs.readFile(probeOutput, "utf8"));
    assert.equal(path.resolve(probe.cwd), path.resolve(root));
    assert.ok(probe.entries.includes("probe.cjs"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
