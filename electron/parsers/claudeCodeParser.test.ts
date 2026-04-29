import { describe, it, expect } from "vitest";
import { parseClaudeCodeLog } from "./claudeCodeParser";

function makeAssistantMsg(stopReason: string | null, content: unknown[]) {
  return JSON.stringify({
    message: { type: "message", role: "assistant", content, stop_reason: stopReason },
  });
}

describe("parseClaudeCodeLog", () => {
  describe("end_turn: テキストあり → happy", () => {
    it("text content があれば happy を返す", () => {
      const line = makeAssistantMsg("end_turn", [{ type: "text", text: "タスク完了しました" }]);
      const result = parseClaudeCodeLog(line);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ type: "speak", text: "", emotion: "happy" });
    });

    it("text content がなければ空を返す", () => {
      const line = makeAssistantMsg("end_turn", [{ type: "thinking", thinking: "..." }]);
      expect(parseClaudeCodeLog(line)).toHaveLength(0);
    });

    it("text が空文字のみなら空を返す", () => {
      const line = makeAssistantMsg("end_turn", [{ type: "text", text: "   " }]);
      expect(parseClaudeCodeLog(line)).toHaveLength(0);
    });
  });

  describe("tool_use: AskUserQuestion → relaxed", () => {
    it("AskUserQuestion は relaxed を返す", () => {
      const line = makeAssistantMsg("tool_use", [
        { type: "text", text: "確認します" },
        { type: "tool_use", name: "AskUserQuestion" },
      ]);
      const result = parseClaudeCodeLog(line);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ type: "speak", text: "", emotion: "relaxed" });
    });
  });

  describe("tool_use: Bash", () => {
    it("Bash が許可されていなければ relaxed", () => {
      const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: "Bash" }]);
      const result = parseClaudeCodeLog(line, undefined, undefined, () => false);
      expect(result[0]).toMatchObject({ emotion: "relaxed" });
    });

    it("Bash が許可されていれば surprised", () => {
      const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: "Bash" }]);
      const result = parseClaudeCodeLog(line, undefined, undefined, () => true);
      expect(result[0]).toMatchObject({ emotion: "surprised" });
    });

    it("isToolAllowed 未指定は relaxed (デフォルト false)", () => {
      const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: "Bash" }]);
      expect(parseClaudeCodeLog(line)[0]).toMatchObject({ emotion: "relaxed" });
    });

    it("input.command が isToolAllowed に渡される", () => {
      const line = makeAssistantMsg("tool_use", [
        { type: "tool_use", name: "Bash", input: { command: "echo hello" } },
      ]);
      let capturedCommand: string | undefined;
      parseClaudeCodeLog(line, undefined, undefined, (_name, command) => {
        capturedCommand = command;
        return true;
      });
      expect(capturedCommand).toBe("echo hello");
    });

    it("input がなければ command は undefined で渡される", () => {
      const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: "Bash" }]);
      let capturedCommand: string | undefined = "sentinel";
      parseClaudeCodeLog(line, undefined, undefined, (_name, command) => {
        capturedCommand = command;
        return false;
      });
      expect(capturedCommand).toBeUndefined();
    });
  });

  describe("tool_use: APPROVAL_REQUIRED_TOOLS (Edit/Write/MultiEdit/NotebookEdit)", () => {
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      it(`${tool} が拒否されていれば relaxed`, () => {
        const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: tool }]);
        const result = parseClaudeCodeLog(line, undefined, undefined, () => false);
        expect(result[0]).toMatchObject({ emotion: "relaxed" });
      });

      it(`${tool} が許可されていれば空を返す`, () => {
        const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: tool }]);
        expect(parseClaudeCodeLog(line, undefined, undefined, () => true)).toHaveLength(0);
      });
    }
  });

  describe("tool_use: mcp__ ツール", () => {
    it("mcp__tool が拒否されていれば relaxed", () => {
      const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: "mcp__server__tool" }]);
      const result = parseClaudeCodeLog(line, undefined, undefined, () => false);
      expect(result[0]).toMatchObject({ emotion: "relaxed" });
    });

    it("mcp__tool が許可されていれば空を返す", () => {
      const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: "mcp__server__tool" }]);
      expect(parseClaudeCodeLog(line, undefined, undefined, () => true)).toHaveLength(0);
    });
  });

  describe("tool_use: その他のツール (Read/Glob 等) は無視", () => {
    for (const tool of ["Read", "Glob", "WebSearch", "ToolSearch", "Agent"]) {
      it(`${tool} は常に空を返す`, () => {
        const line = makeAssistantMsg("tool_use", [{ type: "tool_use", name: tool }]);
        expect(parseClaudeCodeLog(line)).toHaveLength(0);
        expect(parseClaudeCodeLog(line, undefined, undefined, () => false)).toHaveLength(0);
        expect(parseClaudeCodeLog(line, undefined, undefined, () => true)).toHaveLength(0);
      });
    }
  });

  describe("フィルタリング - 除外すべきメッセージ", () => {
    it("通常のuserメッセージは無視する", () => {
      const line = JSON.stringify({ message: { type: "message", role: "user", content: [{ type: "text", text: "test" }] } });
      expect(parseClaudeCodeLog(line)).toHaveLength(0);
    });

    it("typeがmessage以外は無視する", () => {
      const line = JSON.stringify({ message: { type: "other_type", role: "assistant", content: [], stop_reason: "end_turn" } });
      expect(parseClaudeCodeLog(line)).toHaveLength(0);
    });

    it("messageプロパティがない場合は無視する", () => {
      expect(parseClaudeCodeLog(JSON.stringify({ other: "data" }))).toHaveLength(0);
    });

    it("contentが配列でない場合は無視する", () => {
      const line = JSON.stringify({ message: { type: "message", role: "assistant", content: "not an array", stop_reason: "end_turn" } });
      expect(parseClaudeCodeLog(line)).toHaveLength(0);
    });

    it("stop_reason がない場合は無視する", () => {
      const line = JSON.stringify({ message: { type: "message", role: "assistant", content: [{ type: "text", text: "hello" }] } });
      expect(parseClaudeCodeLog(line)).toHaveLength(0);
    });

    it("tool_use で tool_use コンテンツがなければ無視する", () => {
      const line = makeAssistantMsg("tool_use", [{ type: "text", text: "hello" }]);
      expect(parseClaudeCodeLog(line)).toHaveLength(0);
    });
  });

  describe("エラーハンドリング", () => {
    it("不正なJSONは空配列を返す", () => {
      expect(parseClaudeCodeLog("this is not valid JSON {")).toHaveLength(0);
    });

    it("空文字列は空配列を返す", () => {
      expect(parseClaudeCodeLog("")).toHaveLength(0);
    });

    it("nullやundefinedを含むJSONでもクラッシュしない", () => {
      expect(parseClaudeCodeLog(JSON.stringify({ message: null }))).toHaveLength(0);
    });
  });
});
