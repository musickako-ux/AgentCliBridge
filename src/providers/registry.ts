import type { Provider } from "./base.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { GeminiProvider } from "./gemini.js";

const providers = new Map<string, Provider>([
  ["claude", new ClaudeProvider()],
  ["codex", new CodexProvider()],
  ["gemini", new GeminiProvider()],
]);

export function getProvider(name: string): Provider {
  const p = providers.get(name);
  if (!p) throw new Error(`Unknown provider: ${name}. Available: ${[...providers.keys()].join(", ")}`);
  return p;
}
