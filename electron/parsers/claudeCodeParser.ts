// Modified from the original cc-mascot project by kazakago.
// Original: https://github.com/kazakago/cc-mascot (Apache License 2.0)

export interface SpeakMessage {
  type: "speak";
  text: string;
  emotion?: "neutral" | "happy" | "angry" | "sad" | "relaxed" | "surprised";
}

interface ContentItem {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AssistantMessage {
  type: string;
  role: string;
  content: ContentItem[] | string;
  stop_reason?: string | null;
}

interface LogEntry {
  parentUuid?: string;
  message?: AssistantMessage;
}

// Only these tools (besides Bash/AskUserQuestion) can require user approval.
// Everything else (Read, Glob, WebSearch, ToolSearch, Agent, etc.) is silently ignored.
const APPROVAL_REQUIRED_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Claude CodeのJSONLログ行を解析して通知トリガーを検出する。
 *
 * Approach B: stop_reason + content type で感情を決定
 *   - stop_reason "end_turn" + text content → happy (エラーキーワードあり → sad)
 *   - stop_reason "tool_use" + AskUserQuestion → relaxed
 *   - stop_reason "tool_use" + Bash (allowedTools 外) → relaxed
 *   - stop_reason "tool_use" + Bash (allowedTools 内) → surprised
 *   - stop_reason "tool_use" + その他 (allowedTools 外) → relaxed
 *   - stop_reason "tool_use" + その他 (allowedTools 内) → 無視
 *   それ以外 (thinking のみ等) は無視。
 */
export function parseClaudeCodeLog(
  line: string,
  _includeSubAgents?: boolean,
  _logFilePath?: string,
  isToolAllowed?: (name: string, command?: string) => boolean,
): SpeakMessage[] {
  try {
    const entry: LogEntry = JSON.parse(line);
    const msg = entry.message;

    if (!msg || msg.role !== "assistant" || msg.type !== "message") return [];
    if (!Array.isArray(msg.content)) return [];

    const content = msg.content as ContentItem[];
    const stopReason = msg.stop_reason;

    if (stopReason === "end_turn") {
      const textItem = content.find((item) => item.type === "text" && item.text?.trim());
      if (!textItem) return [];
      return [{ type: "speak", text: "", emotion: "happy" }];
    }

    if (stopReason === "tool_use") {
      const toolItem = content.find((item) => item.type === "tool_use" && item.name);
      if (!toolItem?.name) return [];

      const toolName = toolItem.name;

      if (toolName === "AskUserQuestion") {
        return [{ type: "speak", text: "", emotion: "relaxed" }];
      }

      if (toolName === "Bash") {
        const command = typeof toolItem.input?.command === "string" ? toolItem.input.command : undefined;
        const allowed = isToolAllowed?.(toolName, command) ?? false;
        return [{ type: "speak", text: "", emotion: allowed ? "surprised" : "relaxed" }];
      }

      if (toolName === "Read" || toolName === "Edit") {
        const filePath = typeof toolItem.input?.file_path === "string" ? toolItem.input.file_path : undefined;
        if (isToolAllowed && !isToolAllowed(toolName, filePath)) {
          return [{ type: "speak", text: "", emotion: "relaxed" }];
        }
        return [];
      }

      // その他のツール: 承認が必要になりうるもののみ通知（mcp__ プレフィックスも対象）
      if (!APPROVAL_REQUIRED_TOOLS.has(toolName) && !toolName.startsWith("mcp__")) return [];
      if (isToolAllowed && !isToolAllowed(toolName)) {
        return [{ type: "speak", text: "", emotion: "relaxed" }];
      }

      return [];
    }

    return [];
  } catch {
    return [];
  }
}
