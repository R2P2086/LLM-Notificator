import * as chokidar from "chokidar";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseCodexLog } from "./parsers/codexParser";
import {
  RESCAN_INTERVAL_MS,
  BroadcastFn,
  initializeFilePosition,
  skipFileChanges,
  processFileChanges,
} from "./logMonitorUtils";

/**
 * Codex セッションログ (~/.codex/sessions/**\/*.jsonl) を監視して通知を発火する。
 * 最初に変更を検知したファイルをアクティブセッションとして固定し、他はスキップする。
 * 30秒ごとに最新ファイルをリスキャンして新セッションに自動切り替えする。
 */
export function createCodexLogMonitor(
  broadcast: BroadcastFn,
  watchPath?: string,
  onActiveFileChanged?: (filePath: string | null) => void,
) {
  const defaultPath = path.join(os.homedir(), ".codex", "sessions");
  const resolvedWatchPath = watchPath || defaultPath;

  const positions = new Map<string, number>();
  const lastProcessed = new Map<string, number>();
  let activeFilePath: string | null = null;

  const setActiveFile = (filePath: string) => {
    if (filePath === activeFilePath) return;
    activeFilePath = filePath;
    onActiveFileChanged?.(filePath);
  };

  // 30秒ごとに最新セッションファイルを探して切り替える
  const rescanTimer = setInterval(() => {
    const newest = findNewestJsonl(resolvedWatchPath);
    if (newest && newest !== activeFilePath) {
      console.log(`[CodexMonitor] New session detected: ${newest}`);
      if (!positions.has(newest)) initializeFilePosition(positions, newest);
      setActiveFile(newest);
    }
  }, RESCAN_INTERVAL_MS);

  const watcher = chokidar.watch(resolvedWatchPath, {
    ignored: (_p: string, stats?: fs.Stats) => stats?.isFile() === true && !_p.endsWith(".jsonl"),
    depth: 3, // sessions/YYYY/MM/DD/*.jsonl
    usePolling: true,
    interval: 1000,
  });

  watcher.on("add", (filePath: string) => {
    initializeFilePosition(positions, filePath);
  });

  watcher.on("change", (filePath: string) => {
    if (!activeFilePath) {
      console.log(`[CodexMonitor] Active session: ${filePath}`);
      setActiveFile(filePath);
    }
    if (filePath !== activeFilePath) {
      skipFileChanges(positions, filePath);
      return;
    }
    processFileChanges(filePath, positions, lastProcessed, parseCodexLog, broadcast, "CodexMonitor");
  });

  watcher.on("error", (error: unknown) => {
    console.error("[CodexMonitor] Watcher error:", error);
  });

  watcher.on("ready", () => {
    console.log(`[CodexMonitor] Monitoring ${positions.size} files in ${resolvedWatchPath}`);
  });

  return {
    resetActiveFile: () => {
      activeFilePath = null;
      onActiveFileChanged?.(null);
    },
    close: () => {
      clearInterval(rescanTimer);
      watcher.close();
      positions.clear();
      lastProcessed.clear();
    },
  };
}

/** sessions/ 以下で mtime が最新の JSONL ファイルパスを返す */
function findNewestJsonl(dir: string): string | null {
  try {
    let newest: { path: string; mtime: number } | null = null;
    const walk = (d: string, depth: number) => {
      if (depth > 3) return;
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const mtime = fs.statSync(full).mtimeMs;
          if (!newest || mtime > newest.mtime) newest = { path: full, mtime };
        }
      }
    };
    walk(dir, 0);
    return newest?.path ?? null;
  } catch {
    return null;
  }
}
