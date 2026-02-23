import { Client, GatewayIntentBits, Message } from "discord.js";
import { writeFileSync } from "fs";
import { join } from "path";
import { Adapter, chunkText } from "./base.js";
import { AgentEngine } from "../core/agent.js";
import { Store } from "../core/store.js";
import { reloadConfig, DiscordConfig } from "../core/config.js";
import { t, getCommandDescriptions } from "../core/i18n.js";

const EDIT_INTERVAL = 1500;

export class DiscordAdapter implements Adapter {
  private client: Client;
  private reminderTimer?: ReturnType<typeof setInterval>;
  private autoTimer?: ReturnType<typeof setInterval>;
  private autoRunning = false;

  constructor(
    private engine: AgentEngine,
    private store: Store,
    private config: DiscordConfig,
    private locale: string = "en"
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });
    this.setup();
  }

  private setup(): void {
    this.client.on("messageCreate", async (msg: Message) => {
      if (msg.author.bot) return;
      const isDM = !msg.guild;
      const isMentioned = msg.mentions.has(this.client.user!);
      if (!isDM && !isMentioned) return;

      const groupId = msg.guild ? String(msg.guild.id) : undefined;
      if (!this.engine.access.isAllowed(msg.author.id, groupId)) return;

      const text = msg.content.replace(/<@!?\d+>/g, "").trim();

      // Management commands
      if (text === "!help") {
        await msg.reply(t(this.locale, "help").replaceAll("/", "!"));
        return;
      }
      if (text === "!new") {
        this.store.clearSession(msg.author.id);
        await msg.reply(t(this.locale, "session_cleared"));
        return;
      }
      if (text === "!usage") {
        const u = this.store.getUsage(msg.author.id);
        await msg.reply(`Requests: ${u.count}\nTotal cost: $${u.total_cost.toFixed(4)}`);
        return;
      }
      if (text === "!allusage") {
        const rows = this.store.getUsageAll();
        if (!rows.length) { await msg.reply(t(this.locale, "no_usage")); return; }
        const out = rows.map((r) => `${r.user_id}: ${r.count} reqs, $${r.total_cost.toFixed(4)}`).join("\n");
        await msg.reply(out);
        return;
      }
      if (text === "!history") {
        const rows = this.store.getHistory(msg.author.id, 5);
        if (!rows.length) { await msg.reply(t(this.locale, "no_history")); return; }
        const out = rows.reverse().map((r) => {
          const ts = new Date(r.created_at).toLocaleString();
          return `[${ts}] ${r.role}: ${r.content.slice(0, 150)}`;
        }).join("\n\n");
        await msg.reply(out);
        return;
      }
      if (text === "!model") {
        const eps = this.engine.getEndpoints();
        const out = `Endpoints (${eps.length}):\n` +
          eps.map((e) => `• ${e.name}: ${e.model || "default"}`).join("\n");
        await msg.reply(out);
        return;
      }
      if (text === "!reload") {
        try {
          const c = reloadConfig();
          this.engine.reloadConfig(c);
          this.locale = c.locale;
          await msg.reply(t(this.locale, "config_reloaded"));
        } catch (err: any) {
          await msg.reply(t(this.locale, "reload_failed") + err.message);
        }
        return;
      }

      // File upload handling
      if (msg.attachments.size > 0) {
        const ws = this.engine.getWorkDir(msg.author.id);
        for (const [, att] of msg.attachments) {
          try {
            const resp = await fetch(att.url);
            const buf = Buffer.from(await resp.arrayBuffer());
            writeFileSync(join(ws, att.name || "upload"), buf);
          } catch {}
        }
        const names = [...msg.attachments.values()].map(a => a.name).join(", ");
        const prompt = text || `Analyze the uploaded file(s): ${names}`;
        await this.handlePrompt(msg, prompt);
        return;
      }

      // Text message — send to Claude (skill system handles intents)
      if (!text) return;
      await this.handlePrompt(msg, text);
    });
  }

  private async handlePrompt(msg: Message, text: string) {
    if (this.engine.isLocked(msg.author.id)) {
      await msg.reply(t(this.locale, "still_processing"));
      return;
    }

    const placeholder = await msg.reply(t(this.locale, "thinking"));
    let lastEdit = 0;
    let lastText = "";

    try {
      const res = await this.engine.runStream(
        msg.author.id, text, "discord", String(msg.channelId),
        async (_chunk: string, full: string) => {
          const now = Date.now();
          if (now - lastEdit < EDIT_INTERVAL) return;
          const preview = full.slice(-1900) + "\n\n⏳...";
          if (preview === lastText) return;
          lastText = preview;
          lastEdit = now;
          try { await placeholder.edit(preview); } catch {}
        }
      );

      const maxLen = this.config.chunk_size || 1900;
      const chunks = chunkText(res.text, maxLen);
      try { await placeholder.edit(chunks[0]); } catch {}
      for (let i = 1; i < chunks.length; i++) {
        await msg.reply(chunks[i]);
      }
    } catch (err: any) {
      console.error("[discord] error:", err);
      try { await placeholder.edit(`Error: ${err.message || "unknown"}`); } catch {}
    }
  }

  async start(): Promise<void> {
    console.log("[discord] starting bot...");
    await this.client.login(this.config.token);
    console.log(`[discord] logged in as ${this.client.user?.tag}`);
    this.reminderTimer = setInterval(() => this.checkReminders(), 30000);
    this.autoTimer = setInterval(() => this.processAutoTasks(), 60000);
  }

  stop(): void {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.client.destroy();
  }

  private async checkReminders(): Promise<void> {
    try {
      const due = this.store.getDueReminders().filter(r => r.platform === "discord");
      for (const r of due) {
        const ch = await this.client.channels.fetch(r.chat_id);
        if (ch?.isTextBased() && "send" in ch) await (ch as any).send(t(this.locale, "reminder_notify", { desc: r.description }));
        this.store.markReminderSent(r.id);
      }
    } catch (e) { console.error("[discord] reminder error:", e); }
  }

  private async processAutoTasks(): Promise<void> {
    if (this.autoRunning) return;
    const task = this.store.getNextAutoTask("discord");
    if (!task) return;
    this.autoRunning = true;
    this.store.markTaskRunning(task.id);
    try {
      const ch = await this.client.channels.fetch(task.chat_id);
      if (!ch?.isTextBased() || !("send" in ch)) throw new Error("channel not found");
      const channel = ch as any;
      await channel.send(t(this.locale, "auto_starting", { id: task.id, desc: task.description }));
      console.log(`[discord] auto-task #${task.id} for ${task.user_id}`);
      const res = await this.engine.runStream(task.user_id, task.description, "discord", task.chat_id);
      this.store.markTaskResult(task.id, "done");
      const maxLen = this.config.chunk_size || 1900;
      const chunks = chunkText(res.text || "(no output)", maxLen);
      await channel.send(t(this.locale, "auto_done", { id: task.id, cost: (res.cost || 0).toFixed(4) }));
      for (const c of chunks) await channel.send(c);
    } catch (err: any) {
      this.store.markTaskResult(task.id, "failed");
      console.error(`[discord] auto-task #${task.id} failed:`, err);
      try {
        const ch = await this.client.channels.fetch(task.chat_id);
        if (ch?.isTextBased() && "send" in ch) {
          await (ch as any).send(t(this.locale, "auto_failed", { id: task.id, err: err.message || "unknown" }));
        }
      } catch {}
    } finally {
      this.autoRunning = false;
    }
  }
}
