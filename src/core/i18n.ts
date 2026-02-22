const messages: Record<string, Record<string, string>> = {
  en: {
    help: "ClaudeBridge ready.\n\nCommands:\n/new - clear session\n/usage - your stats\n/allusage - all stats\n/history - recent chats\n/model - endpoints info\n/reload - reload config\n/remember <text> - save a memory\n/memories - list memories\n/forget - clear all memories\n/task <desc> - add a task\n/tasks - list pending tasks\n/done <id> - complete a task\n/remind <minutes>m <desc> - set reminder\n/auto <desc> - queue auto task\n/autotasks - list auto tasks\n/cancelauto <id> - cancel auto task\n\nSend text or files to chat. Unknown /commands are forwarded to Claude.",
    session_cleared: "Session cleared.",
    no_usage: "No usage data.",
    no_history: "No history.",
    config_reloaded: "Config reloaded.",
    reload_failed: "Reload failed: ",
    memory_saved: "✅ Memory saved.",
    no_memories: "No memories.",
    memories_cleared: "✅ All memories cleared.",
    task_added: "✅ Task #{id} added.",
    no_tasks: "No pending tasks.",
    task_done: "✅ Task #{id} done.",
    task_not_found: "Task #{id} not found.",
    reminder_set: "✅ Reminder #{id} set for {mins}m.",
    auto_queued: "🤖 Auto task #{id} queued. Will execute when idle.",
    no_auto_tasks: "No auto tasks.",
    auto_cancelled: "✅ Auto task #{id} cancelled.",
    auto_starting: "🤖 Auto task #{id} starting:\n{desc}",
    auto_done: "✅ Auto task #{id} done (cost: ${cost}):",
    auto_failed: "❌ Auto task #{id} failed: {err}",
    thinking: "⏳ Thinking...",
    still_processing: "⏳ Still processing...",
    upload_failed: "Upload failed: ",
    reminder_notify: "⏰ Reminder: {desc}",
    usage_remember: "Usage: /remember <text>",
    usage_task: "Usage: /task <description>",
    usage_done: "Usage: /done <task_id>",
    usage_remind: "Usage: /remind <minutes>m <description>",
    usage_auto: "Usage: /auto <task description>",
    usage_cancelauto: "Usage: /cancelauto <task_id>",
    intent_reminder_set: "✅ Reminder detected: in {mins}m — {desc} (#{id})",
    intent_task_added: "✅ Task detected #{id}: {desc}",
    intent_memory_saved: "✅ Remembered: {desc}",
  },
  zh: {
    help: "ClaudeBridge 就绪。\n\n命令：\n/new - 清除会话\n/usage - 你的用量\n/allusage - 所有用量\n/history - 最近对话\n/model - 端点信息\n/reload - 重载配置\n/remember <文本> - 保存记忆\n/memories - 查看记忆\n/forget - 清除所有记忆\n/task <描述> - 添加任务\n/tasks - 查看待办\n/done <id> - 完成任务\n/remind <分钟>m <描述> - 设置提醒\n/auto <描述> - 排队自动任务\n/autotasks - 查看自动任务\n/cancelauto <id> - 取消自动任务\n\n发送文字或文件即可对话。未知 / 命令会转发给 Claude。",
    session_cleared: "会话已清除。",
    no_usage: "暂无用量数据。",
    no_history: "暂无历史记录。",
    config_reloaded: "配置已重载。",
    reload_failed: "重载失败：",
    memory_saved: "✅ 记忆已保存。",
    no_memories: "暂无记忆。",
    memories_cleared: "✅ 所有记忆已清除。",
    task_added: "✅ 任务 #{id} 已添加。",
    no_tasks: "暂无待办任务。",
    task_done: "✅ 任务 #{id} 已完成。",
    task_not_found: "任务 #{id} 未找到。",
    reminder_set: "✅ 提醒 #{id} 已设置，{mins}分钟后触发。",
    auto_queued: "🤖 自动任务 #{id} 已排队，空闲时执行。",
    no_auto_tasks: "暂无自动任务。",
    auto_cancelled: "✅ 自动任务 #{id} 已取消。",
    auto_starting: "🤖 自动任务 #{id} 开始执行：\n{desc}",
    auto_done: "✅ 自动任务 #{id} 完成（花费：${cost}）：",
    auto_failed: "❌ 自动任务 #{id} 失败：{err}",
    thinking: "⏳ 思考中...",
    still_processing: "⏳ 仍在处理...",
    upload_failed: "上传失败：",
    reminder_notify: "⏰ 提醒：{desc}",
    usage_remember: "用法：/remember <文本>",
    usage_task: "用法：/task <描述>",
    usage_done: "用法：/done <任务ID>",
    usage_remind: "用法：/remind <分钟>m <描述>",
    usage_auto: "用法：/auto <任务描述>",
    usage_cancelauto: "用法：/cancelauto <任务ID>",
    intent_reminder_set: "✅ 已识别提醒：{mins}分钟后 — {desc} (#{id})",
    intent_task_added: "✅ 已识别任务 #{id}：{desc}",
    intent_memory_saved: "✅ 已识别并记住：{desc}",
  },
};

const commandDescriptions: Record<string, Record<string, string>> = {
  en: {
    new: "Clear session", usage: "Your usage stats", allusage: "All users usage",
    history: "Recent conversations", model: "Current model/endpoints", reload: "Reload config",
    remember: "Save a memory", memories: "List your memories", forget: "Clear all memories",
    task: "Add a task", tasks: "List pending tasks", done: "Complete a task",
    remind: "Set a timed reminder", auto: "Queue auto task (runs when idle)",
    autotasks: "List auto tasks", cancelauto: "Cancel an auto task", help: "Show all commands",
  },
  zh: {
    new: "清除会话", usage: "你的用量", allusage: "所有用量",
    history: "最近对话", model: "端点信息", reload: "重载配置",
    remember: "保存记忆", memories: "查看记忆", forget: "清除所有记忆",
    task: "添加任务", tasks: "查看待办", done: "完成任务",
    remind: "设置提醒", auto: "排队自动任务（空闲执行）",
    autotasks: "查看自动任务", cancelauto: "取消自动任务", help: "显示所有命令",
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