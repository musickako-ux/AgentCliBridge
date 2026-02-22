const messages: Record<string, Record<string, string>> = {
  en: {
    help: "ClaudeBridge ready.\n\nManagement commands:\n/new - clear session\n/usage - your stats\n/allusage - all stats\n/history - recent chats\n/model - endpoints info\n/reload - reload config\n/help - show this help\n\nJust chat naturally to manage memories, tasks, reminders, and more — Claude handles it all.",
    session_cleared: "Session cleared.",
    no_usage: "No usage data.",
    no_history: "No history.",
    config_reloaded: "Config reloaded.",
    reload_failed: "Reload failed: ",
    thinking: "⏳ Thinking...",
    still_processing: "⏳ Still processing...",
    upload_failed: "Upload failed: ",
    reminder_notify: "⏰ Reminder: {desc}",
    auto_starting: "🤖 Auto task #{id} starting:\n{desc}",
    auto_done: "✅ Auto task #{id} done (cost: ${cost}):",
    auto_failed: "❌ Auto task #{id} failed: {err}",
    page_expired: "Page expired. Please resend your question.",
  },
  zh: {
    help: "ClaudeBridge 就绪。\n\n管理命令：\n/new - 清除会话\n/usage - 你的用量\n/allusage - 所有用量\n/history - 最近对话\n/model - 端点信息\n/reload - 重载配置\n/help - 显示帮助\n\n直接对话即可管理记忆、任务、提醒等 — Claude 会自动处理。",
    session_cleared: "会话已清除。",
    no_usage: "暂无用量数据。",
    no_history: "暂无历史记录。",
    config_reloaded: "配置已重载。",
    reload_failed: "重载失败：",
    thinking: "⏳ 思考中...",
    still_processing: "⏳ 仍在处理...",
    upload_failed: "上传失败：",
    reminder_notify: "⏰ 提醒：{desc}",
    auto_starting: "🤖 自动任务 #{id} 开始执行：\n{desc}",
    auto_done: "✅ 自动任务 #{id} 完成（花费：${cost}）：",
    auto_failed: "❌ 自动任务 #{id} 失败：{err}",
    page_expired: "页面已过期，请重新发送问题。",
  },
};

const commandDescriptions: Record<string, Record<string, string>> = {
  en: {
    new: "Clear session", usage: "Your usage stats", allusage: "All users usage",
    history: "Recent conversations", model: "Current model/endpoints", reload: "Reload config",
    help: "Show all commands",
  },
  zh: {
    new: "清除会话", usage: "你的用量", allusage: "所有用量",
    history: "最近对话", model: "端点信息", reload: "重载配置",
    help: "显示帮助",
  },
};

export function t(locale: string, key: string, vars?: Record<string, string | number>): string {
  const lang = messages[locale] ? locale : "en";
  let msg = messages[lang][key] ?? messages.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) msg = msg.replaceAll(`{${k}}`, String(v));
  return msg;
}

export function getCommandDescriptions(locale: string): { command: string; description: string }[] {
  const lang = commandDescriptions[locale] ? locale : "en";
  return Object.entries(commandDescriptions[lang]).map(([command, description]) => ({ command, description }));
}
