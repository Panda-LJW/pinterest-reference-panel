import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { writeTextToMacClipboard } from "../dist/server.bundle.js";

// Exercise the real writer on every CI platform without touching its clipboard.
function clipboard(t, behavior = {}) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "darwin" });
  const exists = fs.existsSync;
  t.mock.method(fs, "existsSync", path => ["/usr/bin/pbcopy", "/usr/bin/pbpaste"].includes(path) || exists(path));
  const calls = [];
  let stored = "";
  t.mock.method(childProcess, "spawn", (file, args, options) => {
    const name = file.split("/").at(-1);
    const call = { name, args, options, input: "", killed: null };
    calls.push(call);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.kill = signal => { call.killed = signal; return true; };
    child.stdin = new Writable({
      write(chunk, _encoding, done) { call.input += chunk.toString("utf8"); done(); },
      final(done) {
        done();
        queueMicrotask(() => {
          if (behavior.stall === name) return;
          if (behavior.error === name) { child.emit("error", new Error("private content")); return; }
          if (name === "pbcopy") stored = call.input;
          else child.stdout.write(behavior.readback ?? stored);
          child.stdout.end();
          child.emit("close", behavior.fail === name ? 1 : 0);
        });
      }
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    Object.defineProperty(process, "platform", platform);
  });
  return calls;
}

test("clipboard uses explicit UTF-8 and verifies exact Chinese, emoji and multiline paths", async t => {
  const calls = clipboard(t);
  const text = "/tmp/摄影 参考/海报🎨.png\n/tmp/café/构图.jpg";
  await writeTextToMacClipboard(text);
  assert.deepEqual(calls.map(call => call.name), ["pbcopy", "pbpaste"]);
  assert.equal(calls[0].input, text);
  assert.deepEqual(calls[1].args, ["-Prefer", "txt"]);
  for (const call of calls) {
    for (const key of ["LANG", "LC_ALL", "LC_CTYPE"]) assert.equal(call.options.env[key], "en_US.UTF-8");
    assert.equal(call.options.shell, undefined);
  }
});

for (const [label, behavior] of [
  ["empty clipboard despite exit 0", { readback: "" }],
  ["different clipboard text", { readback: "/private/unrelated.png" }],
  ["truncated clipboard text", { readback: "/tmp/参考" }],
  ["oversized external clipboard", { readback: "x".repeat(16_385) }],
  ["copy process failure", { fail: "pbcopy" }],
  ["readback process failure", { fail: "pbpaste" }],
  ["copy spawn failure", { error: "pbcopy" }]
]) {
  test(`clipboard rejects ${label} without leaking content or retrying`, async t => {
    const calls = clipboard(t, behavior);
    await assert.rejects(writeTextToMacClipboard("/tmp/参考.png"), error => {
      assert.equal(error.status, 503);
      assert.equal(error.message, "未能确认路径已写入剪贴板，请重新复制");
      return true;
    });
    assert.equal(calls.filter(call => call.name === "pbcopy").length, 1);
    if (behavior.fail === "pbcopy" || behavior.error === "pbcopy") assert.equal(calls.length, 1);
  });
}

for (const stall of ["pbcopy", "pbpaste"]) {
  test(`clipboard bounds a stalled ${stall} and kills it before reporting failure`, async t => {
    const calls = clipboard(t, { stall });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = assert.rejects(writeTextToMacClipboard("/tmp/参考.png"), /未能确认/);
    await setImmediate();
    t.mock.timers.tick(5_000);
    await pending;
    assert.equal(calls.at(-1).name, stall);
    assert.equal(calls.at(-1).killed, "SIGKILL");
  });
}

test("clipboard rejects empty, NUL and oversized input before spawning", async t => {
  const calls = clipboard(t);
  for (const text of ["", "a\0b", "中".repeat(5_462)]) {
    await assert.rejects(writeTextToMacClipboard(text), /无效或过长/);
  }
  assert.equal(calls.length, 0);
});
