import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  log, setLogLevel, initFileLog, closeFileLog, shortId,
} from "../src/core/logger.js";

describe("logger", () => {
  let tmpDir: string;

  afterEach(() => {
    closeFileLog();
    setLogLevel("info");
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  function makeTmp() {
    tmpDir = mkdtempSync(join(tmpdir(), "logger-test-"));
    return tmpDir;
  }

  function lastEntry(dir: string): any {
    const lines = readFileSync(join(dir, "bridge.log"), "utf-8").trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
  }

  it("filters logs by level", () => {
    const dir = makeTmp();
    initFileLog(dir);
    setLogLevel("warn");
    log.info("filtered");
    log.warn("passed");
    closeFileLog();
    const content = readFileSync(join(dir, "bridge.log"), "utf-8").trim();
    const lines = content.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).msg).toBe("passed");
  });

  it("writes to file and rotates", () => {
    const dir = makeTmp();
    initFileLog(dir, { max_size_mb: 0.0001, max_files: 3 });
    for (let i = 0; i < 100; i++) log.info("rotation-test", { i });
    closeFileLog();
    expect(existsSync(join(dir, "bridge.log"))).toBe(true);
    expect(existsSync(join(dir, "bridge.log.1"))).toBe(true);
  });

  it("merges context with withContext", () => {
    const dir = makeTmp();
    initFileLog(dir);
    const reqLog = log.withContext({ rid: "abc123" });
    reqLog.info("ctx-test", { extra: "val" });
    closeFileLog();
    const entry = lastEntry(dir);
    expect(entry.rid).toBe("abc123");
    expect(entry.extra).toBe("val");
    expect(entry.msg).toBe("ctx-test");
  });

  it("records duration with time()", async () => {
    const dir = makeTmp();
    initFileLog(dir);
    const end = log.time("op-test");
    await new Promise(r => setTimeout(r, 50));
    end();
    closeFileLog();
    const entry = lastEntry(dir);
    expect(entry.msg).toBe("op-test");
    expect(entry.durationMs).toBeGreaterThanOrEqual(40);
  });

  it("redacts sensitive fields", () => {
    const dir = makeTmp();
    initFileLog(dir);
    log.info("secret-test", { token: "sk-1234", password: "hunter2", safe: "ok" });
    closeFileLog();
    const entry = lastEntry(dir);
    expect(entry.token).toBe("[REDACTED]");
    expect(entry.password).toBe("[REDACTED]");
    expect(entry.safe).toBe("ok");
  });

  it("redacts bot token in URLs", () => {
    const dir = makeTmp();
    initFileLog(dir);
    log.info("url-test", { url: "https://api.telegram.org/bot123456:ABC/getMe" });
    closeFileLog();
    const entry = lastEntry(dir);
    expect(entry.url).toContain("[REDACTED]");
    expect(entry.url).not.toContain("123456:ABC");
  });

  it("shortId generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => shortId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it("child logger inherits context", () => {
    const dir = makeTmp();
    initFileLog(dir);
    const child = log.withContext({ rid: "r1" }).child("sub");
    child.info("child-test");
    closeFileLog();
    const entry = lastEntry(dir);
    expect(entry.rid).toBe("r1");
    expect(entry.module).toBe("bridge:sub");
  });
});
