#!/bin/bash
# Phase 2 検証用: PreToolUse フック発火タイミング計測スクリプト
# このスクリプトを ~/.claude/settings.json の PreToolUse フックとして登録する。
#
# 発火した時刻とツール情報を ~/llmn-hook-log.txt に書き込む。
# 承認ダイアログが表示された時刻と比較することで、フックの発火タイミングを確認できる。

TIMESTAMP=$(date "+%H:%M:%S.%3N")
INPUT=$(cat /dev/stdin)

LOG_FILE="$HOME/llmn-hook-log.txt"

# ツール名を stdin JSON から抽出（python3 を優先、なければ sed フォールバック）
if command -v python3 &>/dev/null; then
    TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name','?'))" 2>/dev/null)
    COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command','')[:80])" 2>/dev/null)
else
    TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
    COMMAND=""
fi

echo "[$TIMESTAMP] PreToolUse fired: tool=$TOOL_NAME command=$COMMAND" >> "$LOG_FILE"

# 注意: 標準出力に何も出力しない（出力すると Claude Code がエラーと判断する場合がある）
# 承認判定は Claude Code に委ねる（フックは通知のみ行う）
exit 0
