import { AgentEngine } from "../core/agent.js";
import { Store } from "../core/store.js";
import { t } from "../core/i18n.js";
import { log as rootLog } from "../core/logger.js";

const log = rootLog.child("adapter-base");

export interface Adapter {
  start(): Promise<void>;
  stop(): void;
  reloadConfig?(config: any, locale: string): void;
}

/** Close any unclosed code fences in truncated text */
export function closeCodeFences(text: string): string {
  const count = (text.match(/```/g) || []).length;
  return count % 2 === 1 ? text + "\n```" : text;
}

/** Split long text into chunks respecting newlines, with code-block-aware balancing */
export function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  // Phase 1: split by newlines (existing logic)
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }

  // Phase 2: balance code fences across chunks
  // Ensures each chunk is self-contained valid MarkdownV2
  let inCode = false;
  let lang = "";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const startsInCode: boolean = inCode;

    // Scan fences in original chunk to determine end state and track language
    const fenceRegex = /```(\w*)/g;
    let toggleState: boolean = startsInCode;
    let m: RegExpExecArray | null;
    while ((m = fenceRegex.exec(chunk)) !== null) {
      // Opening fence (not in code) → track language
      if (!toggleState && m[1]) {
        lang = m[1];
      }
      toggleState = !toggleState;
    }
    inCode = toggleState;

    // Apply fixes: reopen/close code blocks as needed
    let fixed = chunk;
    if (startsInCode) {
      fixed = "```" + lang + "\n" + fixed;
    }
    if (inCode) {
      fixed = fixed + "\n```";
      // inCode stays true — next chunk's content is still logically inside code
    }

    chunks[i] = fixed;
  }

  return chunks;
}

/**
 * Abstract base class for platform adapters.
 * Implements common logic for auto-tasks, reminders, approvals, file sends,
 * and status/session commands. Subclasses implement platform-specific I/O.
 */
export abstract class AdapterBase implements Adapter {
  protected reminderTimer?: ReturnType<typeof setInterval>;
  protected autoTimer?: ReturnType<typeof setInterval>;
  protected approvalTimer?: ReturnType<typeof setInterval>;
  protected fileSendTimer?: ReturnType<typeof setInterval>;
  protected activeAutoTasks = 0;
  protected maxParallel = 1;

  constructor(
    protected engine: AgentEngine,
    protected store: Store,
    protected locale: string = "en"
  ) {}

  abstract get platformName(): string;
  abstract get chunkSize(): number;

  /** Send a plain text message to a chat. Return a message ID string if possible. */
  abstract sendText(chatId: string, text: string): Promise<string | void>;
  /** Send a file to a chat. Return true on success. */
  abstract sendFile(chatId: string, filePath: string, caption: string): Promise<boolean>;
  /** Send formatted result text (with platform-specific markdown). Chunks as needed. */
  abstract sendFormattedResult(chatId: string, text: string): Promise<void>;
  /** Send an approval request with approve/reject UI. */
  abstract sendApprovalRequest(chatId: string, taskId: number, description: string): Promise<void>;

  abstract start(): Promise<void>;
  abstract stop(): void;

  protected startTimers(): void {
    this.maxParallel = this.engine.getMaxParallel();
    this.reminderTimer = setInterval(() => this.checkReminders(), 30000);
    this.autoTimer = setInterval(() => this.processAutoTasks(), 5000);
    this.approvalTimer = setInterval(() => this.checkApprovals(), 15000);
    this.fileSendTimer = setInterval(() => this.checkFileSends(), 5000);
  }

  protected stopTimers(): void {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    if (this.autoTimer) clearInterval(this.autoTimer);
    if (this.approvalTimer) clearInterval(this.approvalTimer);
    if (this.fileSendTimer) clearInterval(this.fileSendTimer);
  }

  protected async checkReminders(): Promise<void> {
    try {
      const due = this.store.getDueReminders().filter(r => r.platform === this.platformName);
      for (const r of due) {
        await this.sendText(r.chat_id, t(this.locale, "reminder_notify", { desc: r.description }));
        this.store.markReminderSent(r.id);
      }
    } catch (e: any) { log.error("reminder error", { platform: this.platformName, error: e?.message }); }
  }

  protected async processAutoTasks(): Promise<void> {
    // Reset tasks stuck in 'running' for more than 30 minutes
    this.store.resetStuckTasks(30 * 60 * 1000);
    const available = this.maxParallel - this.activeAutoTasks;
    if (available <= 0) return;
    const tasks = this.store.getNextAutoTasks(this.platformName, available);
    for (const task of tasks) {
      this.activeAutoTasks++;
      this.store.markTaskRunning(task.id);
      this.runAutoTask(task).finally(() => { this.activeAutoTasks--; this.processAutoTasks(); });
    }
  }

  protected async runAutoTask(task: { id: number; user_id: string; platform: string; chat_id: string; description: string; parent_id: number | null }): Promise<void> {
    await this.sendText(task.chat_id, t(this.locale, "auto_starting", { id: task.id, desc: task.description }));
    try {
      log.info("auto-task starting", { taskId: task.id, userId: task.user_id, platform: this.platformName });
      // Always use runParallel for auto-tasks: fresh session, no user session pollution
      const res = await this.engine.runParallel(task.user_id, task.description, this.platformName, task.chat_id, undefined, 0);
      if (res.timedOut) {
        this.store.markTaskResult(task.id, "failed");
        if (res.text) this.store.setTaskResult(task.id, res.text.slice(0, 10000));
        await this.sendText(task.chat_id, t(this.locale, "auto_failed", { id: task.id, err: "timed out" }));
        this._retryIfNeeded(task, "timed out");
        return;
      }
      this.store.markTaskResult(task.id, "done");
      if (res.text) this.store.setTaskResult(task.id, res.text.slice(0, 10000));
      await this.sendText(task.chat_id, t(this.locale, "auto_done", { id: task.id, cost: (res.cost || 0).toFixed(4) }));
      await this.sendFormattedResult(task.chat_id, res.text || "(no output)");
      // Chain progress reporting
      if (task.parent_id) {
        const progress = this.store.getChainProgress(task.parent_id);
        const costSuffix = res.cost ? ` | Cost: $${res.cost.toFixed(4)}` : "";
        await this.sendText(task.chat_id, t(this.locale, "chain_progress", { id: task.parent_id, done: progress.done, total: progress.total, cost: costSuffix }));
      }
    } catch (err: any) {
      this.store.markTaskResult(task.id, "failed");
      await this.sendText(task.chat_id, t(this.locale, "auto_failed", { id: task.id, err: err.message || "unknown" }));
      this._retryIfNeeded(task, (err.message || "unknown").slice(0, 100));
    }
  }

  private _retryIfNeeded(task: { id: number; user_id: string; chat_id: string; description: string; parent_id: number | null }, reason: string): void {
    const retryMatch = task.description.match(/\[retry (\d+)\/3\]/);
    const retryCount = retryMatch ? parseInt(retryMatch[1]) : 0;
    if (retryCount < 3) {
      const retryDesc = retryCount === 0
        ? `[retry 1/3] Previous attempt of task #${task.id} failed (${reason}). Analyze the failure, fix the issue, then: ${task.description}`
        : task.description.replace(`[retry ${retryCount}/3]`, `[retry ${retryCount + 1}/3]`);
      const retryId = this.store.addTask(task.user_id, this.platformName, task.chat_id, retryDesc, undefined, true, task.parent_id || task.id, Date.now() + 120000);
      this.sendText(task.chat_id, t(this.locale, "auto_retry", { id: retryId, attempt: retryCount + 1, parent: task.id })).catch(() => {});
    }
  }

  protected async checkApprovals(): Promise<void> {
    try {
      const pending = this.store.getPendingApprovals(this.platformName);
      for (const task of pending) {
        await this.sendApprovalRequest(task.chat_id, task.id, task.description);
        this.store.markReminderSent(task.id); // reuse reminder_sent to avoid re-sending
      }
    } catch (e: any) { log.error("approval check error", { platform: this.platformName, error: e?.message }); }
  }

  protected async checkFileSends(): Promise<void> {
    const { existsSync } = await import("fs");
    try {
      const pending = this.store.getPendingFileSends(this.platformName);
      for (const f of pending) {
        if (!existsSync(f.file_path)) { this.store.markFileFailed(f.id); continue; }
        try {
          const ok = await this.sendFile(f.chat_id, f.file_path, f.caption);
          if (ok) this.store.markFileSent(f.id);
          else this.store.markFileFailed(f.id);
        } catch (err: any) {
          log.error("file send error", { id: f.id, platform: this.platformName, error: err?.message });
          this.store.markFileFailed(f.id);
        }
      }
    } catch (e: any) { log.error("checkFileSends error", { platform: this.platformName, error: e?.message }); }
  }

  protected async handleStatusCommand(chatId: string, userId: string): Promise<void> {
    const recent = this.store.getRecentAutoTasks(this.platformName, 10);
    if (!recent.length) {
      await this.sendText(chatId, t(this.locale, "no_auto_tasks"));
      return;
    }
    const statusEmoji: Record<string, string> = {
      auto: "[queue]", running: "[run]", done: "[done]", failed: "[fail]",
      approval_pending: "[pending]", cancelled: "[cancel]",
    };
    const lines = recent.map(task => {
      const chain = task.parent_id ? ` (chain #${task.parent_id})` : "";
      let schedInfo = "";
      if (task.status === "auto" && task.scheduled_at && task.scheduled_at > Date.now()) {
        const mins = Math.ceil((task.scheduled_at - Date.now()) / 60000);
        schedInfo = ` [in ${mins}min]`;
      }
      return `${statusEmoji[task.status] || "[?]"} #${task.id} [${task.status}]${schedInfo} ${task.description.slice(0, 60)}${chain}`;
    });
    const stats = this.store.getAutoTaskStats();
    const summary = stats.map(s => `${s.status}: ${s.count}`).join(" | ");
    const report = `${t(this.locale, "status_report")}\n${lines.join("\n")}\n\nSummary: ${summary}`;
    await this.sendText(chatId, report);
  }

  protected async handleSessionsCommand(chatId: string, userId: string): Promise<void> {
    if (!this.engine.isMultiSessionEnabled()) {
      await this.sendText(chatId, "Multi-session mode is disabled.");
      return;
    }
    const sessions = this.engine.getSessionManager().getActive(userId, this.platformName);
    if (!sessions.length) {
      await this.sendText(chatId, t(this.locale, "no_sessions"));
      return;
    }
    const statusIcon: Record<string, string> = { active: "🟢", idle: "🟡", expired: "🔴", closed: "⚫" };
    const lines = sessions.map(s => {
      const ago = Math.round((Date.now() - s.lastActiveAt) / 60000);
      const locked = this.engine.isSessionLocked(s.id) ? " [processing]" : "";
      return `${statusIcon[s.status] || "⚪"} ${s.id.slice(0, 8)} "${s.label || "(no topic)"}" (${ago}min ago, ${s.messageCount} msgs, $${s.totalCost.toFixed(4)})${locked}`;
    });
    await this.sendText(chatId, `${t(this.locale, "sessions_list")}\n${lines.join("\n")}`);
  }
}
