// Modified from the original cc-mascot project by kazakago.
// Original: https://github.com/kazakago/cc-mascot (Apache License 2.0)
import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseClaudeCodeLog, SpeakMessage } from "./parsers/claudeCodeParser";
import {
  RESCAN_INTERVAL_MS,
  BroadcastFn,
  initializeFilePosition,
  skipFileChanges,
  processFileChanges,
} from "./logMonitorUtils";

const isWslPath = (p: string) => p.startsWith("\\\\wsl$") || p.startsWith("\\\\wsl.localhost");

/**
 * Create a log monitor that watches Claude Code session logs
 * @param broadcast - Callback function to send messages to the renderer process
 * @param includeSubAgents - Whether to monitor sub-agent logs
 * @param getActiveSessionId - Getter that returns the active session ID for filtering
 * @param watchPath - Optional override for the watch directory
 * @param isToolAllowed - Callback for auto-approve tool detection
 * @param onAutoDetectSession - Called when a new active session is detected
 */
export function createLogMonitor(
  broadcast: BroadcastFn,
  includeSubAgents = false,
  getActiveSessionId?: () => string | null,
  watchPath?: string,
  isToolAllowed?: (name: string, command?: string) => boolean,
  onAutoDetectSession?: (sessionId: string) => void,
) {
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const resolvedWatchPath = watchPath || path.join(claudeConfigDir, "projects");
  const usePolling = isWslPath(resolvedWatchPath);

  const positions = new Map<string, number>();
  const lastProcessed = new Map<string, number>();

  const makeParser = (filePath: string) => (line: string): SpeakMessage[] =>
    parseClaudeCodeLog(line, includeSubAgents, filePath, isToolAllowed);

  // 30秒ごとに最新セッションファイルを探して切り替える
  const rescanTimer = setInterval(() => {
    const newest = findNewestClaudeSession(resolvedWatchPath);
    if (!newest) return;
    const current = getActiveSessionId?.() ?? null;
    if (newest.sessionId !== current && onAutoDetectSession) {
      console.log(`[LogMonitor] New session detected: ${newest.sessionId}`);
      if (!positions.has(newest.filePath)) initializeFilePosition(positions, newest.filePath);
      onAutoDetectSession(newest.sessionId);
    }
  }, RESCAN_INTERVAL_MS);

  const watcher = chokidar.watch(resolvedWatchPath, {
    ignored: (p, stats) => stats?.isFile() === true && !p.endsWith(".jsonl"),
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    depth: includeSubAgents ? 3 : 1,
    usePolling,
    interval: usePolling ? 1000 : undefined,
  });

  watcher.on("add", (filePath: string) => {
    initializeFilePosition(positions, filePath);
  });

  watcher.on("change", (filePath: string) => {
    const activeSessionId = getActiveSessionId?.() ?? null;

    if (!activeSessionId && onAutoDetectSession) {
      onAutoDetectSession(path.basename(filePath, ".jsonl"));
    }

    if (activeSessionId && !shouldProcessFile(filePath, activeSessionId)) {
      skipFileChanges(positions, filePath);
      return;
    }
    console.log(`[LogMonitor] File changes detected: ${filePath}`);
    processFileChanges(filePath, positions, lastProcessed, makeParser(filePath), broadcast, "LogMonitor");
  });

  watcher.on("error", (error: unknown) => {
    console.error("[LogMonitor] Watcher error:", error);
  });

  watcher.on("ready", () => {
    console.log(`[LogMonitor] Monitoring ${positions.size} files`);
  });

  return {
    close: () => {
      clearInterval(rescanTimer);
      watcher.close();
      positions.clear();
      lastProcessed.clear();
    },
  };
}

/** 監視パス配下の最新セッション JSONL ファイルを返す（サブエージェントは除外） */
function findNewestClaudeSession(watchPath: string): { filePath: string; sessionId: string } | null {
  try {
    let newest: { filePath: string; sessionId: string; mtime: number } | null = null;
    for (const projectEntry of fs.readdirSync(watchPath, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) continue;
      const projectPath = path.join(watchPath, projectEntry.name);
      for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const filePath = path.join(projectPath, entry.name);
        const mtime = fs.statSync(filePath).mtimeMs;
        if (!newest || mtime > newest.mtime) {
          newest = { filePath, sessionId: path.basename(entry.name, ".jsonl"), mtime };
        }
      }
    }
    return newest;
  } catch {
    return null;
  }
}

function shouldProcessFile(filePath: string, activeSessionId: string): boolean {
  const basename = path.basename(filePath, ".jsonl");
  if (basename === activeSessionId) return true;
  const parentDir = path.basename(path.dirname(filePath));
  if (parentDir === activeSessionId) return true;
  return false;
}
