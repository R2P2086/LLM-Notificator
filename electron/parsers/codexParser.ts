import type { SpeakMessage } from "./claudeCodeParser";

interface CodexEventMsg {
  type: "event_msg";
  timestamp: string;
  payload: {
    type: string;
    turn_id?: string;
    last_agent_message?: string | null;
    [key: string]: unknown;
  };
}

interface CodexResponseItem {
  type: "response_item";
  timestamp: string;
  payload: {
    type: string;
    name?: string;
    arguments?: string;
    call_id?: string;
  };
}

/**
 * Codex の JSONL ログ行を解析して通知トリガーを検出する。
 *
 * Codex のイベント形式:
 *   { type: "event_msg", payload: { type: <event_type>, ... } }
 *
 * 確認済みイベント一覧（sandbox=elevated モードでの観測結果）:
 *   task_started, task_complete, user_message, agent_message,
 *   token_count, exec_command_end, patch_apply_end, thread_name_updated
 *
 * 通知トリガー:
 *   - event_msg / task_complete                              → happy  (AI がターン完了)
 *   - response_item / function_call + require_escalated      → relaxed (承認ダイアログ表示)
 */
export function parseCodexLog(line: string): SpeakMessage[] {
  try {
    const entry = JSON.parse(line);

    if (entry.type === "event_msg") {
      const evt = entry as CodexEventMsg;
      if (evt.payload?.type === "task_complete") {
        return [{ type: "speak", text: "", emotion: "happy" }];
      }
      return [];
    }

    if (entry.type === "response_item") {
      const item = entry as CodexResponseItem;
      if (item.payload?.type === "function_call" && item.payload?.arguments) {
        try {
          const args = JSON.parse(item.payload.arguments) as Record<string, unknown>;
          if (args.sandbox_permissions === "require_escalated") {
            return [{ type: "speak", text: "", emotion: "relaxed" }];
          }
        } catch {
          // arguments が JSON でない場合は無視
        }
      }
      return [];
    }

    return [];
  } catch {
    return [];
  }
}
