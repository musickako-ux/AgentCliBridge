import { Adapter, chunkText } from "./base.js";
import { AgentEngine } from "../core/agent.js";
import { Store } from "../core/store.js";
import { reloadConfig, TelegramConfig } from "../core/config.js";
import { toTelegramMarkdown } from "../core/markdown.js";
import { t, getCommandDescriptions } from "../core/i18n.js";

const EDIT_INTERVAL = 1500;

interface TgUpdate {
  update_id: number;
  message?: any;
}

export class TelegramAdapter implements Adapter {
  private running = false;
  private offset = 0;
  private reminderTimer?: ReturnType<typeof setInterval>;
  private autoTimer?: ReturnType<typeof setInterval>;
  private autoRunning = false;

  constructor(
    private engine: AgentEngine,
    private store: Store,
    private config: TelegramConfig,
    private locale: string = "en"
  ) {}

  private get api() {
    return `https://api.telegram.org/bot${this.config.token}`;
  }

  private async call(method: string, body?: any): Promise<any> {
    for (let i = 0; i < 3; i++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(`${this.api}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const json = await res.json();
        return json.result;
      } catch (err) {
        if (i === 2) throw err;
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }

  private async reply(chatId: number, text: string, parseMode?: string): Promise<any> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }

  private async editMsg(chatId: number, msgId: number, text: string, parseMode?: string) {
    try {
      await this.call("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      });
    } catch {}
  }

  private async handleUpdate(update: TgUpdate) {
    const msg = update.message;
    if (!msg) return;
    const uid = msg.from?.id;
    const chatId = msg.chat.id;
    if (!uid) return;

    const groupId = msg.chat.type !== "private" ? String(chatId) : undefined;
    if (!this.engine.access.isAllowed(String(uid), groupId)) {
      console.log(`[telegram] user ${uid} not allowed`);
      return;
    }

    const text = (msg.text || "").trim();
    console.log(`[telegram] ${uid}: ${text.slice(0, 50)}`);

    // Management commands
    if (text === "/start" || text === "/help") {
      await this.reply(chatId, t(this.locale, "help"));
      return;
    }
    if (text === "/new") {
      this.store.clearSession(String(uid));
      await this.reply(chatId, t(this.locale, "session_cleared"));
      return;
    }
    if (text === "/usage") {
      const u = this.store.getUsage(String(uid));
      await this.reply(chatId, `Requests: ${u.count}\nCost: $${u.total_cost.toFixed(4)}`);
      return;
    }
    if (text === "/allusage") {
      const rows = this.store.getUsageAll();
      if (!rows.length) { await this.reply(chatId, t(this.locale, "no_usage")); return; }
      await this.reply(chatId, rows.map(r => `${r.user_id}: ${r.count} reqs, $${r.total_cost.toFixed(4)}`).join("\n"));
      return;
    }
    if (text === "/history") {
      const rows = this.store.getHistory(String(uid), 5);
      if (!rows.length) { await this.reply(chatId, t(this.locale, "no_history")); return; }
      const out = rows.reverse().map(r => `[${new Date(r.created_at).toLocaleString()}] ${r.role}: ${r.content.slice(0, 150)}`).join("\n\n");
      await this.reply(chatId, out);
      return;
    }
    if (text === "/model") {
      const eps = this.engine.getEndpoints();
      await this.reply(chatId, `Endpoints (${eps.length}):\n` + eps.map(e => `• ${e.name}: ${e.model || "default"}`).join("\n"));
      return;
    }
    if (text === "/reload") {
      try { const c = reloadConfig(); this.engine.reloadConfig(c); this.locale = c.locale; await this.reply(chatId, t(this.locale, "config_reloaded")); }
      catch (e: any) { await this.reply(chatId, t(this.locale, "reload_failed") + e.message); }
      return;
    }

    // File upload
    if (msg.document || msg.photo) {
      let fileId: string;
      let fileName: string;
      if (msg.document) { fileId = msg.document.file_id; fileName = msg.document.file_name || "upload"; }
      else { const p = msg.photo[msg.photo.length - 1]; fileId = p.file_id; fileName = "photo.jpg"; }
      try {
        const file = await this.call("getFile", { file_id: fileId });
        const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
        const resp = await fetch(url);
        const buf = Buffer.from(await resp.arrayBuffer());
        const { writeFileSync } = await import("fs");
        const { join } = await import("path");
        const ws = this.engine.getWorkDir(String(uid));
        writeFileSync(join(ws, fileName), buf);
        const prompt = msg.caption || `Analyze the uploaded file: ${fileName}`;
        await this.handlePrompt(chatId, String(uid), prompt);
      } catch (e: any) { await this.reply(chatId, t(this.locale, "upload_failed") + e.message); }
      return;
    }

    // Text message — send to Claude (skill system handles intents)
    if (text) await this.handlePrompt(chatId, String(uid), text);
  }

  private async handlePrompt(chatId: number, uid: string, text: string) {
    if (this.engine.isLocked(uid)) {
      await this.reply(chatId, t(this.locale, "still_processing"));
      return;
    }
    const placeholder = await this.reply(chatId, t(this.locale, "thinking"));
    const msgId = placeholder.message_id;
    let lastEdit = 0;

    try {
      console.log(`[telegram] running claude for ${uid}...`);
      const res = await this.engine.runStream(uid, text, "telegram", String(chatId),
        async (_chunk: string, full: string) => {
          const now = Date.now();
          if (now - lastEdit < EDIT_INTERVAL) return;
          lastEdit = now;
          const preview = full.slice(-3500) + "\n\n⏳...";
          await this.editMsg(chatId, msgId, preview);
        }
      );
      console.log(`[telegram] claude done for ${uid}, cost=$${res.cost?.toFixed(4)}`);

      const maxLen = this.config.chunk_size || 4000;
      const md = toTelegramMarkdown(res.text);
      const chunks = chunkText(md, maxLen);
      try {
        await this.editMsg(chatId, msgId, chunks[0], "MarkdownV2");
      } catch {
        await this.editMsg(chatId, msgId, res.text);
      }
      for (let i = 1; i < chunks.length; i++) {
        try {
          await this.reply(chatId, chunks[i], "MarkdownV2");
        } catch {
          await this.reply(chatId, chunks[i]);
        }
      }
    } catch (err: any) {
      console.error("[telegram] claude error:", err);
      await this.editMsg(chatId, msgId, `Error: ${err.message || "unknown"}`);
    }
  }

  async start(): Promise<void> {
    this.running = true;
    console.log("[telegram] starting long polling...");
    this.reminderTimer = setInterval(() => this.checkReminders(), 30000);
    this.autoTimer = setInterval(() => this.processAutoTasks(), 60000);
    await this.registerCommands();
    while (this.running) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(`${this.api}/getUpdates?offset=${this.offset}&timeout=5`, { signal: ctrl.signal });
        clearTimeout(timer);
        const json = await res.json() as any;
        if (!json.ok) { console.error("[telegram] poll error:", json); continue; }
        for (const update of json.result) {
          this.offset = update.update_id + 1;
          this.handleUpdate(update).catch(e => console.error("[telegram] handler error:", e));
        }
      } catch (err) {
        console.error("[telegram] poll fetch error:", err);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    if (this.autoTimer) clearInterval(this.autoTimer);
  }

  private async registerCommands(): Promise<void> {
    try {
      await this.call("setMyCommands", { commands: getCommandDescriptions(this.locale) });
      console.log("[telegram] commands registered");
    } catch (e) { console.error("[telegram] failed to register commands:", e); }
  }

  private async checkReminders(): Promise<void> {
    try {
      const due = this.store.getDueReminders().filter(r => r.platform === "telegram");
      for (const r of due) {
        await this.reply(Number(r.chat_id), t(this.locale, "reminder_notify", { desc: r.description }));
        this.store.markReminderSent(r.id);
      }
    } catch (e) { console.error("[telegram] reminder error:", e); }
  }

  private async processAutoTasks(): Promise<void> {
    if (this.autoRunning) return;
    const task = this.store.getNextAutoTask();
    if (!task) return;
    this.autoRunning = true;
    this.store.markTaskRunning(task.id);
    const chatId = Number(task.chat_id);
    await this.reply(chatId, t(this.locale, "auto_starting", { id: task.id, desc: task.description }));
    try {
      console.log(`[telegram] auto-task #${task.id} for ${task.user_id}`);
      const res = await this.engine.runStream(task.user_id, task.description, "telegram", task.chat_id);
      this.store.markTaskResult(task.id, "done");
      const maxLen = this.config.chunk_size || 4000;
      const chunks = chunkText(res.text || "(no output)", maxLen);
      await this.reply(chatId, t(this.locale, "auto_done", { id: task.id, cost: (res.cost || 0).toFixed(4) }));
      for (const c of chunks) await this.reply(chatId, c);
    } catch (err: any) {
      this.store.markTaskResult(task.id, "failed");
      await this.reply(chatId, t(this.locale, "auto_failed", { id: task.id, err: err.message || "unknown" }));
    } finally {
      this.autoRunning = false;
    }
  }
}
