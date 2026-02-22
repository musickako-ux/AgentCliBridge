/** Round-robin API key rotation with cooldown on failure */
export class KeyRotator {
  private keys: string[];
  private index = 0;
  private cooldowns = new Map<number, number>(); // index → cooldown until timestamp
  private cooldownMs = 60_000; // 1 min cooldown on failure

  constructor(keys: string[]) {
    this.keys = keys.filter(Boolean);
    if (!this.keys.length) throw new Error("No API keys configured");
  }

  next(): string {
    const now = Date.now();
    const len = this.keys.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.index + i) % len;
      const until = this.cooldowns.get(idx) || 0;
      if (now >= until) {
        this.index = (idx + 1) % len;
        return this.keys[idx];
      }
    }
    // all on cooldown, use next anyway
    const idx = this.index;
    this.index = (idx + 1) % len;
    return this.keys[idx];
  }

  markFailed(key: string): void {
    const idx = this.keys.indexOf(key);
    if (idx >= 0) this.cooldowns.set(idx, Date.now() + this.cooldownMs);
  }

  get count(): number {
    return this.keys.length;
  }

  reload(keys: string[]) {
    this.keys = keys.filter(Boolean);
    this.index = 0;
    this.cooldowns.clear();
  }
}
