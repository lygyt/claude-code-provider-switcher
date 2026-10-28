import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyDir,
  extractJsonObject,
  median,
  normalizeRelativePath,
  removeDir,
  tokenize,
  walkFiles
} from "../src/util.mjs";

test("normalizeRelativePath accepts safe workspace paths", () => {
  assert.equal(normalizeRelativePath("solution.js"), "solution.js");
  assert.equal(normalizeRelativePath("./src/deep/file.js"), "src/deep/file.js");
  assert.equal(normalizeRelativePath("src\\windows\\file.js"), "src/windows/file.js");
});

test("normalizeRelativePath rejects traversal and absolute paths", () => {
  for (const unsafe of ["../secret.txt", "src/../../secret.txt", "/etc/passwd", "C:\\Windows\\file", "src//file.js", ""]) {
    assert.throws(() => normalizeRelativePath(unsafe), /path|Absolute|Unsafe|non-empty/i, unsafe);
  }
});

test("extractJsonObject handles braces inside strings and surrounding prose", () => {
  const value = extractJsonObject('Here is the result: {"files":{"a.js":"const x = \\"}\\"\\n"},"rationale":"ok"} done');
  assert.equal(value.files["a.js"], 'const x = "}"\n');
  assert.equal(value.rationale, "ok");
});

test("extractJsonObject rejects responses without JSON", () => {
  assert.throws(() => extractJsonObject("no object here"), /valid JSON object/);
  assert.throws(() => extractJsonObject("{broken"), /valid JSON object/);
});

test("median handles empty, odd, and even arrays", () => {
  assert.equal(median([]), undefined);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 2]), 3);
});

test("tokenize keeps words and CJK terms", () => {
  assert.deepEqual(tokenize("Sorting intervals, O(n log n)"), ["sorting", "intervals", "log"]);
  assert.deepEqual(tokenize("动态规划"), ["动态规划"]);
});

test("copyDir and walkFiles skip runtime directories deterministically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-util-"));
  try {
    const source = path.join(root, "source");
    await fs.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.mkdir(path.join(source, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(source, "b.txt"), "b", "utf8");
    await fs.writeFile(path.join(source, "nested", "a.txt"), "a", "utf8");
    await fs.writeFile(path.join(source, "node_modules", "ignored.js"), "x", "utf8");

    assert.deepEqual(await walkFiles(source), ["b.txt", "nested/a.txt"]);

    const destination = path.join(root, "destination");
    await copyDir(source, destination);
    assert.deepEqual(await walkFiles(destination), ["b.txt", "nested/a.txt"]);
    await assert.rejects(fs.access(path.join(destination, "node_modules")));
  } finally {
    await removeDir(root);
  }
});
