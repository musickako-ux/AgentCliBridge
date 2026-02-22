import { spawn, ChildProcess } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";
import { Config } from "./config.js";
import { Store } from "./store.js";
import { UserLock } from "./lock.js";
import { AccessControl } from "./permissions.js";
import { EndpointRotator, Endpoint } from "./keys.js";

export interface AgentResponse {
  text: string;
  sessionId: string;
  cost?: number;
}

export type StreamCallback = (chunk: string, full: string) => void | Promise<void>;

export class AgentEngine {
  private lock: UserLock;
  private rotator: EndpointRotator;
  access: AccessControl;

  constructor(
    private config: Config,
    private store: Store
  ) {
    this.lock = new UserLock(
      config.redis.enabled ? config.redis.url : undefined
    );
    this.access = new AccessControl(
      config.access.allowed_users,
      config.access.allowed_groups
    );
    this.rotator = new EndpointRotator(config.endpoints);
  }

  reloadConfig(config: Config) {
    this.config = config;
    this.access.reload(config.access.allowed_users, config.access.allowed_groups);
    this.rotator.reload(config.endpoints);
  }

  getEndpoints(): { name: string; model: string }[] {
    return this.rotator.list();
  }

  getEndpointCount(): number {
    return this.rotator.count;
  }

  private getWorkDir(userId: string): string {
    if (!this.config.workspace.isolation) {
      return this.config.agent.cwd || process.cwd();
    }
    const dir = join(this.config.workspace.base_dir, userId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  isLocked(userId: string): boolean {
    return this.lock.isLocked(userId);
  }

  async runStream(
    userId: string,
    prompt: string,
    platform: string,
    onChunk?: StreamCallback
  ): Promise<AgentResponse> {
    const release = await this.lock.acquire(userId);
    try {
      this.store.addHistory(userId, platform, "user", prompt);
      const res = await this._executeWithRetry(userId, prompt, platform, onChunk);
      this.store.addHistory(userId, platform, "assistant", res.text);
      this.store.recordUsage(userId, platform, res.cost || 0);
      return res;
    } finally {
      release();
    }
  }

  private async _executeWithRetry(
    userId: string,
    prompt: string,
    platform: string,
    onChunk?: StreamCallback
  ): Promise<AgentResponse> {
    const maxRetries = Math.min(this.rotator.count, 3);
    let lastErr: any;
    for (let i = 0; i < maxRetries; i++) {
      const ep = this.rotator.next();
      try {
        return await this._execute(userId, prompt, platform, ep, onChunk);
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message || "");
        if (msg.includes("429") || msg.includes("401") || msg.includes("529")) {
          console.warn(`[agent] endpoint ${ep.name} failed, rotating`);
          this.rotator.markFailed(ep);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  private _execute(
    userId: string,
    prompt: string,
    platform: string,
    ep: Endpoint,
    onChunk?: StreamCallback
  ): Promise<AgentResponse> {
    return new Promise((resolve, reject) => {
      const sessionId = this.store.getSession(userId) || "";
      const cwd = this.getWorkDir(userId);

      const args = ["-p", prompt, "--verbose", "--output-format", "stream-json"];
      if (ep.model) args.push("--model", ep.model);
      if (sessionId) args.push("-r", sessionId);

      const env: Record<string, string> = { ...process.env as Record<string, string> };
      env.ANTHROPIC_API_KEY = ep.api_key;
      if (ep.base_url) env.ANTHROPIC_BASE_URL = ep.base_url;

      const child = spawn("claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });

      let fullText = "";
      let newSessionId = sessionId;
      let cost = 0;
      let buffer = "";

      child.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
              newSessionId = msg.session_id;
            }
            if (msg.type === "assistant" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "text" && block.text) {
                  fullText += block.text + "\n";
                  if (onChunk) onChunk(block.text, fullText);
                }
              }
            }
            if (msg.type === "result") {
              if (msg.result) fullText = msg.result;
              if (msg.total_cost_usd) cost = msg.total_cost_usd;
            }
          } catch {}
        }
      });

      let stderr = "";
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      child.on("close", (code) => {
        if (newSessionId) this.store.setSession(userId, newSessionId, platform);
        if (code === 0 || fullText.trim()) {
          resolve({ text: fullText.trim() || "(no response)", sessionId: newSessionId, cost });
        } else {
          reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      child.on("error", reject);
    });
  }
}