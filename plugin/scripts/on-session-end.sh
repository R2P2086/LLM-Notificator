#!/bin/bash
# Modified from the original cc-mascot project by kazakago.
# Original: https://github.com/kazakago/cc-mascot (Apache License 2.0)
# SessionEnd hook: Clear active-session file if it matches the ending session (best-effort).
# stdin receives JSON: {"session_id": "...", "reason": "...", ...}

case "$(uname)" in
  Darwin)
    ACTIVE_SESSION_FILE="$HOME/Library/Application Support/LLM Notificator/active-session"
    ;;
  *)
    ACTIVE_SESSION_FILE="$APPDATA/LLM Notificator/active-session"
    ;;
esac

SESSION_ID=$(cat /dev/stdin | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -n "$SESSION_ID" ] && [ -f "$ACTIVE_SESSION_FILE" ]; then
  CURRENT=$(cat "$ACTIVE_SESSION_FILE" 2>/dev/null | tr -d '[:space:]')
  if [ "$CURRENT" = "$SESSION_ID" ]; then
    rm -f "$ACTIVE_SESSION_FILE"
  fi
fi

exit 0
