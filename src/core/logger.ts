import { writeSync, openSync, closeSync, statSync, renameSync, mkdirSync } from "fs";
import { join } from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let globalLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void { globalLevel = level; }
export function getLogLevel(): LogLevel { return globalLevel; }

// ─── File logging ────────────────────────────────────────
let fileFd: number | null = null;
let filePath = "";
let maxFileSize = 10 * 1024 * 1024; // 10MB
let maxFiles = 5;

export function initFileLog(dir: string, opts?: { max_size_mb?: number; max_files?: number }): void {
  mkdirSync(dir, { recursive: true });
  if (opts?.max_size_mb) maxFileSize = opts.max_size_mb * 1024 * 1024;
  if (opts?.max_files) maxFiles = opts.max_files;
  filePath = join(dir, "bridge.log");
  fileFd = openSync(filePath, "a");
}

export function closeFileLog(): void {
  if (fileFd !== null) { try { closeSync(fileFd); } catch {} fileFd = null; }
}

export function setFileLog(opts: { dir?: string; max_size_mb?: number; max_files?: number; enabled?: boolean }): void {
  closeFileLog();
  if (opts.enabled && opts.dir) initFileLog(opts.dir, opts);
}

function rotateIfNeeded(): void {
  if (fileFd === null || !filePath) return;
  try {
    const st = statSync(filePath);
    if (st.size < maxFileSize) return;
  } catch { return; }
  closeSync(fileFd);
  for (let i = maxFiles - 1; i >= 1; i--) {
    try { renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`); } catch {}
  }
  try { renameSync(filePath, `${filePath}.1`); } catch {}
  fileFd = openSync(filePath, "a");
}

// ─── Sensitive field redaction ───────────────────────────
const SENSITIVE_KEYS = /\b(token|secret|key|password|authorization)\b/i;
const BOT_TOKEN_URL = /\/bot([^/]+)\//g;

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(k) && typeof v === "string") {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string") {
      out[k] = v.replace(BOT_TOKEN_URL, "/bot[REDACTED]/");
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Core emit ───────────────────────────────────────────
function emit(level: LogLevel, module: string, msg: string, extra?: Record<string, unknown>, ctx?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[globalLevel]) return;
  const safe = extra ? redact(extra) : undefined;
  const entry = { ts: new Date().toISOString(), level, module, msg, pid: process.pid, ...ctx, ...safe };
  const line = JSON.stringify(entry) + "\n";
  if (level === "warn" || level === "error") process.stderr.write(line);
  else process.stdout.write(line);
  if (fileFd !== null) {
    rotateIfNeeded();
    try { writeSync(fileFd, line); } catch {}
  }
}

// ─── shortId for request tracing ─────────────────────────
export function shortId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Logger interface ────────────────────────────────────
export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  child(module: string): Logger;
  withContext(ctx: Record<string, unknown>): Logger;
  time(label: string): () => void;
}

function createLogger(module: string, ctx?: Record<string, unknown>): Logger {
  return {
    debug: (msg, extra?) => emit("debug", module, msg, extra, ctx),
    info: (msg, extra?) => emit("info", module, msg, extra, ctx),
    warn: (msg, extra?) => emit("warn", module, msg, extra, ctx),
    error: (msg, extra?) => emit("error", module, msg, extra, ctx),
    child: (sub: string) => createLogger(`${module}:${sub}`, ctx),
    withContext: (newCtx) => createLogger(module, { ...ctx, ...newCtx }),
    time: (label: string) => {
      const start = Date.now();
      return () => emit("info", module, label, { durationMs: Date.now() - start }, ctx);
    },
  };
}

export const log = createLogger("bridge");
