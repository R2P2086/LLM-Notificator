// Modified from the original cc-mascot project by kazakago.
// Original: https://github.com/kazakago/cc-mascot (Apache License 2.0)
import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function readAllowedTools(settingsPath: string): string[] {
  try {
    const content = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(content);
    // Support both formats:
    //   { "permissions": { "allow": [...] } }  (Claude Code current format)
    //   { "allowedTools": [...] }               (legacy format)
    const fromPermissions = settings.permissions?.allow;
    const fromLegacy = settings.allowedTools;
    return Array.isArray(fromPermissions) ? fromPermissions : Array.isArray(fromLegacy) ? fromLegacy : [];
  } catch {
    return [];
  }
}

function readDeniedPatterns(settingsPath: string): string[] {
  try {
    const content = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(content);
    const fromPermissions = settings.permissions?.ask;
    return Array.isArray(fromPermissions) ? fromPermissions : [];
  } catch {
    return [];
  }
}

function buildSources(claudeConfigDir: string, projectRoot?: string): string[] {
  const sources = [
    path.join(claudeConfigDir, "settings.json"),
    path.join(claudeConfigDir, "settings.local.json"),
  ];
  if (projectRoot) {
    sources.push(path.join(projectRoot, ".claude", "settings.json"));
    sources.push(path.join(projectRoot, ".claude", "settings.local.json"));
  }
  return sources;
}

function buildAllowedSet(claudeConfigDir: string, projectRoot?: string): Set<string> {
  return new Set(buildSources(claudeConfigDir, projectRoot).flatMap(readAllowedTools));
}

function buildDeniedSet(claudeConfigDir: string, projectRoot?: string): Set<string> {
  return new Set(buildSources(claudeConfigDir, projectRoot).flatMap(readDeniedPatterns));
}

function matchesGlob(str: string, pattern: string): boolean {
  const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${regexStr}$`).test(str);
}

function isDeniedByAsk(deniedPatterns: Set<string>, toolName: string, command?: string): boolean {
  for (const entry of deniedPatterns) {
    const parenIdx = entry.indexOf("(");
    if (parenIdx === -1) {
      if (entry === toolName) return true;
    } else {
      const entryTool = entry.substring(0, parenIdx);
      if (entryTool !== toolName) continue;
      const pattern = entry.substring(parenIdx + 1, entry.length - 1);
      if (command === undefined || matchesGlob(command, pattern)) return true;
    }
  }
  return false;
}

/**
 * Watch ~/.claude/settings*.json (and optionally the project's .claude/settings*.json)
 * for allowedTools / permissions.allow changes.
 *
 * Entries can be "Bash", "Bash(git status)", "Read", etc.
 * "Bash" or "Bash(...)" both match isToolAllowed("Bash").
 *
 * @param projectRoot - Optional project root directory (e.g. the repo root).
 *   Its .claude/settings.json is included so project-level permissions are respected.
 */
export function createClaudeSettingsMonitor(projectRoot?: string) {
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  let allowedTools = buildAllowedSet(claudeConfigDir, projectRoot);
  let deniedTools = buildDeniedSet(claudeConfigDir, projectRoot);
  console.log(`[SettingsMonitor] Loaded allowedTools (${allowedTools.size} entries), deniedTools (${deniedTools.size} entries)`);

  const watchPaths = [
    path.join(claudeConfigDir, "settings.json"),
    path.join(claudeConfigDir, "settings.local.json"),
  ];
  if (projectRoot) {
    watchPaths.push(path.join(projectRoot, ".claude", "settings.json"));
    watchPaths.push(path.join(projectRoot, ".claude", "settings.local.json"));
  }

  const watcher = chokidar.watch(watchPaths, { ignoreInitial: true, ignorePermissionErrors: true });
  watcher.on("change", () => {
    allowedTools = buildAllowedSet(claudeConfigDir, projectRoot);
    deniedTools = buildDeniedSet(claudeConfigDir, projectRoot);
    console.log(`[SettingsMonitor] Reloaded allowedTools (${allowedTools.size} entries), deniedTools (${deniedTools.size} entries)`);
  });

  return {
    isToolAllowed: (toolName: string, command?: string): boolean => {
      // ask list takes precedence: if the command matches a denied pattern, not auto-approved
      if (isDeniedByAsk(deniedTools, toolName, command)) return false;

      // For file-path tools (Read, Edit): use project-root-aware check.
      // In-project files are allowed; out-of-project files are denied unless
      // explicitly listed with a path pattern in the allow list.
      if (projectRoot && command !== undefined && (toolName === "Read" || toolName === "Edit")) {
        const normalizedPath = path.normalize(command).toLowerCase();
        const normalizedRoot = path.normalize(projectRoot).toLowerCase();
        if (normalizedPath.startsWith(normalizedRoot + path.sep) || normalizedPath === normalizedRoot) {
          return true; // in-project
        }
        // out-of-project: only explicit path patterns apply (bare "Read"/"Edit" is ignored)
        for (const entry of allowedTools) {
          if (entry.startsWith(toolName + "(")) {
            const pattern = entry.substring(toolName.length + 1, entry.length - 1);
            if (matchesGlob(command, pattern)) return true;
          }
        }
        return false;
      }

      for (const entry of allowedTools) {
        if (entry === toolName) return true;
        if (entry.startsWith(toolName + "(")) return true;
      }
      return false;
    },
    close: () => watcher.close(),
  };
}
