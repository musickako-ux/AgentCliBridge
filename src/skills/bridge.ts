import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SkillContext {
  userId: string;
  chatId: string;
  platform: string;
  locale: string;
}

export function generateSkillDoc(ctx: SkillContext): string {
  const ctlPath = resolve(__dirname, "../ctl.js");
  const ctl = `node ${ctlPath}`;

  if (ctx.locale === "zh") {
    return [
      `## ClaudeBridge 内置能力`,
      ``,
      `你正在 ClaudeBridge 中运行，连接着 ${ctx.platform} 平台。`,
      `当前用户 ID: ${ctx.userId} | 聊天 ID: ${ctx.chatId} | 平台: ${ctx.platform}`,
      ``,
      `你可以通过 Bash 工具调用以下命令来管理用户的记忆、任务、提醒和自动任务：`,
      ``,
      `### 记忆管理`,
      `- 保存记忆: \`${ctl} memory add ${ctx.userId} "内容"\``,
      `- 查看记忆: \`${ctl} memory list ${ctx.userId}\``,
      `- 清除记忆: \`${ctl} memory clear ${ctx.userId}\``,
      ``,
      `### 任务管理`,
      `- 添加任务: \`${ctl} task add ${ctx.userId} ${ctx.platform} ${ctx.chatId} "任务描述"\``,
      `- 查看任务: \`${ctl} task list ${ctx.userId}\``,
      `- 完成任务: \`${ctl} task done <任务ID> ${ctx.userId}\``,
      ``,
      `### 提醒`,
      `- 设置提醒: \`${ctl} reminder add ${ctx.userId} ${ctx.platform} ${ctx.chatId} <分钟数> "提醒内容"\``,
      `- 查看提醒: \`${ctl} reminder list ${ctx.userId}\``,
      ``,
      `### 自动任务`,
      `- 创建自动任务: \`${ctl} auto add ${ctx.userId} ${ctx.platform} ${ctx.chatId} "任务描述"\``,
      `- 查看自动任务: \`${ctl} auto list ${ctx.userId}\``,
      `- 取消自动任务: \`${ctl} auto cancel <任务ID>\``,
      ``,
      `### 使用指南`,
      `- 用户要你记住某事 → 使用 memory add`,
      `- 用户问你记住了什么 → 使用 memory list`,
      `- 用户要设置提醒 → 使用 reminder add（计算分钟数）`,
      `- 用户要添加任务/待办 → 使用 task add`,
      `- 命令输出 JSON，请用自然语言向用户回复结果，不要直接展示 JSON`,
      `- 提醒会由 Bridge 定时器自动推送，你只需创建即可`,
    ].join("\n");
  }

  return [
    `## ClaudeBridge Built-in Skills`,
    ``,
    `You are running inside ClaudeBridge, connected to the ${ctx.platform} platform.`,
    `Current user ID: ${ctx.userId} | Chat ID: ${ctx.chatId} | Platform: ${ctx.platform}`,
    ``,
    `You can use the Bash tool to call these commands to manage the user's memories, tasks, reminders, and auto-tasks:`,
    ``,
    `### Memory Management`,
    `- Save a memory: \`${ctl} memory add ${ctx.userId} "content"\``,
    `- List memories: \`${ctl} memory list ${ctx.userId}\``,
    `- Clear memories: \`${ctl} memory clear ${ctx.userId}\``,
    ``,
    `### Task Management`,
    `- Add a task: \`${ctl} task add ${ctx.userId} ${ctx.platform} ${ctx.chatId} "task description"\``,
    `- List tasks: \`${ctl} task list ${ctx.userId}\``,
    `- Complete a task: \`${ctl} task done <task_id> ${ctx.userId}\``,
    ``,
    `### Reminders`,
    `- Set a reminder: \`${ctl} reminder add ${ctx.userId} ${ctx.platform} ${ctx.chatId} <minutes> "description"\``,
    `- List reminders: \`${ctl} reminder list ${ctx.userId}\``,
    ``,
    `### Auto Tasks`,
    `- Queue an auto task: \`${ctl} auto add ${ctx.userId} ${ctx.platform} ${ctx.chatId} "description"\``,
    `- List auto tasks: \`${ctl} auto list ${ctx.userId}\``,
    `- Cancel an auto task: \`${ctl} auto cancel <task_id>\``,
    ``,
    `### Guidelines`,
    `- User wants you to remember something → use memory add`,
    `- User asks what you remember → use memory list`,
    `- User wants a reminder → use reminder add (calculate minutes)`,
    `- User wants to add a task/todo → use task add`,
    `- Commands output JSON. Respond to the user in natural language, do not dump raw JSON.`,
    `- Reminders are automatically pushed by Bridge timers — you only need to create them.`,
  ].join("\n");
}
