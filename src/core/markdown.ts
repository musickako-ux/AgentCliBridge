/** Escape text for Telegram MarkdownV2 */
export function escapeMarkdownV2(text: string): string {
  // Characters that must be escaped outside code blocks
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Process inline markdown: inline code, links, bold, italic, strikethrough.
 * Order: extract protected elements → escape → restore formatted elements → restore placeholders.
 */
function processInline(text: string): string {
  let s = text;

  // 1. Extract inline code → placeholders (before escaping)
  const inlineCodes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    const escaped = code.replace(/([\\`])/g, "\\$1");
    inlineCodes.push(`\`${escaped}\``);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // 2. Extract markdown links [text](url) → placeholders (before escaping)
  //    Handles one level of nested parens in URLs, e.g. wiki/Rust_(programming_language)
  const links: string[] = [];
  s = s.replace(
    /\[([^\]]+)\]\(([^()]*(?:\([^()]*\))*[^()]*)\)/g,
    (_, linkText, url) => {
      const escapedText = escapeMarkdownV2(linkText);
      // Inside MarkdownV2 link URL, only \ and ) need escaping
      const escapedUrl = url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
      links.push(`[${escapedText}](${escapedUrl})`);
      return `\x00LK${links.length - 1}\x00`;
    }
  );

  // 3. Escape all remaining special chars
  s = escapeMarkdownV2(s);

  // 4. Restore bold **text** → *text* (MarkdownV2 single asterisk)
  s = s.replace(/\\\*\\\*([\s\S]+?)\\\*\\\*/g, "*$1*");

  // 5. Restore italic _text_ → _text_
  s = s.replace(/\\_(.+?)\\_/g, "_$1_");

  // 6. Restore strikethrough ~~text~~ → ~text~
  s = s.replace(/\\~\\~(.+?)\\~\\~/g, "~$1~");

  // 7. Restore link placeholders
  s = s.replace(/\x00LK(\d+)\x00/g, (_, i) => links[Number(i)]);

  // 8. Restore inline code placeholders
  s = s.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[Number(i)]);

  return s;
}

/**
 * Convert standard markdown to Telegram MarkdownV2.
 * Uses iterative scanning for code blocks instead of regex split,
 * properly handling unclosed blocks and multiple consecutive blocks.
 */
export function toTelegramMarkdown(text: string): string {
  const result: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    // Find next code fence ```
    const fenceStart = text.indexOf("```", pos);

    if (fenceStart === -1) {
      // No more code blocks — process rest as inline
      result.push(processInline(text.slice(pos)));
      break;
    }

    // Process text before code block as inline
    if (fenceStart > pos) {
      result.push(processInline(text.slice(pos, fenceStart)));
    }

    // Find closing ```
    const afterOpen = fenceStart + 3;
    const fenceEnd = text.indexOf("```", afterOpen);

    if (fenceEnd === -1) {
      // Unclosed code block — auto-close it
      const raw = text.slice(afterOpen);
      const langMatch = raw.match(/^(\w*)\n?/);
      const lang = langMatch ? langMatch[1] : "";
      const contentStart = langMatch ? langMatch[0].length : 0;
      const code = raw.slice(contentStart).replace(/([\\`])/g, "\\$1");
      result.push(`\`\`\`${lang}\n${code}\n\`\`\``);
      break;
    }

    // Complete code block — extract lang and content, escape only \ and `
    const raw = text.slice(afterOpen, fenceEnd);
    const langMatch = raw.match(/^(\w*)\n?/);
    const lang = langMatch ? langMatch[1] : "";
    const contentStart = langMatch ? langMatch[0].length : 0;
    const code = raw.slice(contentStart).replace(/([\\`])/g, "\\$1");
    result.push(`\`\`\`${lang}\n${code}\`\`\``);

    pos = fenceEnd + 3;
  }

  return result.join("");
}
