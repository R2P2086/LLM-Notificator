#!/bin/bash
# SessionStart hook: Save session ID to CLAUDE_ENV_FILE for use in skills.
# stdin receives JSON: {"session_id": "...", "source": "startup|resume|clear|compact", ...}

SESSION_ID=$(cat /dev/stdin | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -n "$SESSION_ID" ] && [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export LLM_NOTIFICATOR_SESSION_ID=${SESSION_ID}" >> "$CLAUDE_ENV_FILE"
fi

exit 0
