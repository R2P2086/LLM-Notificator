// Modified from the original cc-mascot project by kazakago.
// Original: https://github.com/kazakago/cc-mascot (Apache License 2.0)
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, execSync, ChildProcess } from "child_process";
import { createLogMonitor } from "./logMonitor";
import { createCodexLogMonitor } from "./codexLogMonitor";
import { createClaudeSettingsMonitor } from "./services/claudeSettingsMonitor";
import { sendWebhookNotification, type WebhookService } from "./services/webhookNotifier";
import { initAutoUpdater, checkForUpdatesManually } from "./autoUpdater";
import fs from "fs";
import net from "net";
import Store from "electron-store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === "development" || process.argv.includes("--dev");

// シングルインスタンスロック（commandLine設定より前にチェックして不要な初期化を避ける）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("[App] Another instance is already running. Quitting.");
  process.exit(0);
}

// リモートデバッグポートを設定（開発モードのみ、アプリ起動前に実行する必要がある）
if (isDev) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
  console.log("🔍 Remote debugging enabled on port 9222");
}

const store = new Store();

let mainWindow: BrowserWindow | null = null;
let licenseWindow: BrowserWindow | null = null;
let logMonitor: { close: () => void } | null = null;
let codexLogMonitor: { resetActiveFile: () => void; close: () => void } | null = null;
let settingsMonitor: { isToolAllowed: (name: string) => boolean; close: () => void } | null = null;
let activeSessionId: string | null = null;
let activeCodexFilePath: string | null = null;
let voicevoxProcess: ChildProcess | null = null;
let voiceroidBridgeProcess: ChildProcess | null = null;
let micMonitorProcess: ChildProcess | null = null;
let micActive = false;
let tray: Tray | null = null;
let notificationMode: string = (store.get("notificationMode") as string | undefined) ?? "both";

const VOICEVOX_PORT = 8564;

// Start or restart log monitor with current settings
function startLogMonitor(): void {
  // Close existing monitor if any
  if (logMonitor) {
    logMonitor.close();
    logMonitor = null;
  }

  // Reset session filter so auto-detection starts fresh
  activeSessionId = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("active-session-changed", null);
  }

  // Initialize log monitor with IPC broadcast function
  const broadcast = (message: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("speak", message);
    }
  };

  const onAutoDetectSession = (sessionId: string) => {
    activeSessionId = sessionId;
    console.log(`[ActiveSession] Auto-detected session: ${sessionId}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("active-session-changed", sessionId);
    }
  };

  const includeSubAgents = (store.get("includeSubAgents") as boolean | undefined) ?? false;
  const watchPath = (store.get("watchPath") as string | undefined) || undefined;
  console.log(`[LogMonitor] Starting with includeSubAgents=${includeSubAgents}, watchPath=${watchPath ?? "default"}`);
  logMonitor = createLogMonitor(broadcast, includeSubAgents, () => activeSessionId, watchPath, settingsMonitor?.isToolAllowed, onAutoDetectSession);
}

function startCodexLogMonitor(): void {
  if (codexLogMonitor) {
    codexLogMonitor.close();
    codexLogMonitor = null;
  }

  activeCodexFilePath = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("codex-active-file-changed", null);
  }

  const broadcast = (message: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("speak", message);
    }
  };

  const onActiveFileChanged = (filePath: string | null) => {
    activeCodexFilePath = filePath;
    console.log(`[CodexMonitor] Active file: ${filePath ?? "none"}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("codex-active-file-changed", filePath);
    }
  };

  const codexWatchPath = (store.get("codexWatchPath") as string | undefined) || undefined;
  console.log(`[CodexMonitor] Starting with codexWatchPath=${codexWatchPath ?? "default"}`);
  codexLogMonitor = createCodexLogMonitor(broadcast, codexWatchPath, onActiveFileChanged);
}

// Get mic-monitor binary path
function getMicMonitorPath(): string | undefined {
  if (process.platform !== "darwin" && process.platform !== "win32") return undefined;

  const binaryName = process.platform === "win32" ? "mic-monitor.exe" : "mic-monitor";
  const devPath = path.join(__dirname, "../resources", binaryName);
  if (app.isPackaged) {
    const prodPath = path.join(process.resourcesPath, binaryName);
    return fs.existsSync(prodPath) ? prodPath : undefined;
  }
  return fs.existsSync(devPath) ? devPath : undefined;
}

// Start mic-monitor helper process
function startMicMonitor(): void {
  if (micMonitorProcess) return;

  const monitorPath = getMicMonitorPath();
  if (!monitorPath) {
    console.log("[MicMonitor] Binary not found, feature disabled");
    return;
  }

  try {
    console.log(`[MicMonitor] Starting: ${monitorPath}`);
    micMonitorProcess = spawn(monitorPath);

    let buffer = "";
    micMonitorProcess.stdout?.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { micActive: boolean };
          micActive = parsed.micActive;
          console.log(`[MicMonitor] Mic active: ${micActive}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("mic-active-changed", micActive);
          }
        } catch {
          console.warn("[MicMonitor] Failed to parse:", line);
        }
      }
    });

    micMonitorProcess.stderr?.on("data", (data) => {
      console.error(`[MicMonitor] ${data.toString().trim()}`);
    });

    micMonitorProcess.on("error", (error) => {
      console.error("[MicMonitor] Failed to start:", error);
      micMonitorProcess = null;
    });

    micMonitorProcess.on("exit", (code) => {
      console.log(`[MicMonitor] Exited with code ${code}`);
      micMonitorProcess = null;
    });
  } catch (error) {
    console.error("[MicMonitor] Error starting:", error);
    micMonitorProcess = null;
  }
}

// Stop mic-monitor helper process
function stopMicMonitor(): void {
  if (micMonitorProcess) {
    console.log("[MicMonitor] Stopping...");
    micMonitorProcess.kill("SIGTERM");
    micMonitorProcess = null;
    micActive = false;
  }
}

// Get icon path for Windows and Linux (Mac uses .icns from package.json)
const getIconPath = () => {
  if (process.platform === "darwin") {
    return undefined; // Mac uses .icns from bundle
  }
  const ext = process.platform === "win32" ? ".ico" : ".png";
  return path.join(__dirname, `../resources/icons/icon${ext}`);
};

// HTML escape helper for XSS prevention
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// Get tray icon path based on platform
const getTrayIconPath = (): string => {
  const iconsDir = app.isPackaged
    ? path.join(process.resourcesPath, "icons")
    : path.join(__dirname, "../resources/icons");

  if (process.platform === "darwin") {
    // trayTemplate.png はElectronがテンプレート画像として処理し白く表示されるため
    // カラーアイコン（tray.png）を使用する
    return path.join(iconsDir, "tray.png");
  }
  // Windows: .ico、Linux: .png
  const ext = process.platform === "win32" ? "icon.ico" : "tray.png";
  return path.join(iconsDir, ext);
};

// Update tray context menu (called when notification mode changes)
const updateTrayMenu = () => {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: "通知モード", enabled: false },
    {
      label: "両方（ポップアップ + 発話）",
      type: "radio",
      checked: notificationMode === "both",
      click: () => {
        notificationMode = "both";
        store.set("notificationMode", "both");
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("notification-mode-changed", "both");
        updateTrayMenu();
      },
    },
    {
      label: "ポップアップのみ",
      type: "radio",
      checked: notificationMode === "visual",
      click: () => {
        notificationMode = "visual";
        store.set("notificationMode", "visual");
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("notification-mode-changed", "visual");
        updateTrayMenu();
      },
    },
    {
      label: "発話のみ",
      type: "radio",
      checked: notificationMode === "audio",
      click: () => {
        notificationMode = "audio";
        store.set("notificationMode", "audio");
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("notification-mode-changed", "audio");
        updateTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "設定を開く",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("toggle-settings-panel");
        }
      },
    },
    { type: "separator" },
    {
      label: "バージョン情報",
      click: async () => {
        const { response } = await dialog.showMessageBox(mainWindow!, {
          type: "info",
          title: "LLM Notificator",
          message: `LLM Notificator v${app.getVersion()}`,
          detail: [
            `Electron: v${process.versions.electron}`,
            `Chrome: v${process.versions.chrome}`,
            `Node.js: v${process.versions.node}`,
          ].join("\n"),
          buttons: ["閉じる", "アップデートを確認", "Webサイト", "ライセンス情報"],
        });
        if (response === 1) {
          checkForUpdatesManually();
        } else if (response === 2) {
          shell.openExternal("https://github.com/R2P2086/LLM-Notificator");
        } else if (response === 3) {
          createLicenseWindow();
        }
      },
    },
    {
      label: "終了",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);
};

// Create system tray icon with context menu
const createTray = () => {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  tray = new Tray(icon);
  tray.setToolTip("LLM Notificator");
  updateTrayMenu();
};

// Engine type and path constants
type EngineType = "aivis" | "voicevox" | "custom" | "voiceroid2";
type VoicevoxEngineType = "aivis" | "voicevox";

// Platform-specific engine paths (aivis / voicevox only; voiceroid2 uses the bundled bridge)
const MAC_ENGINE_PATHS: Record<VoicevoxEngineType, string> = {
  aivis: "/Applications/AivisSpeech.app/Contents/Resources/AivisSpeech-Engine/run",
  voicevox: "/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run",
};

const WINDOWS_ENGINE_PATHS: Record<VoicevoxEngineType, string> = {
  aivis: "C:\\Program Files\\AivisSpeech\\AivisSpeech-Engine\\run.exe",
  voicevox: "C:\\Program Files\\VOICEVOX\\vv-engine\\run.exe",
};

const LINUX_ENGINE_PATHS: Record<VoicevoxEngineType, string> = {
  aivis: "/opt/AivisSpeech/AivisSpeech-Engine/run",
  voicevox: "/opt/VOICEVOX/vv-engine/run",
};

// Get voiceroid-bridge.exe path (bundled binary, Windows-only)
function getVoiceroidBridgePath(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const binaryName = "voiceroid-bridge.exe";
  const devPath = path.join(__dirname, "../resources", binaryName);
  if (app.isPackaged) {
    const prodPath = path.join(process.resourcesPath, binaryName);
    return fs.existsSync(prodPath) ? prodPath : undefined;
  }
  return fs.existsSync(devPath) ? devPath : undefined;
}

// Get the actual engine path based on engine type and platform
function getEnginePath(): string | undefined {
  const engineType = (store.get("engineType") as EngineType | undefined) || "aivis"; // Default to AivisSpeech
  console.log(`[getEnginePath] Engine type: ${engineType}, platform: ${process.platform}`);
  if (engineType === "custom") {
    const customPath = store.get("voicevoxEnginePath") as string | undefined;
    console.log(`[getEnginePath] Custom path: ${customPath}`);
    return customPath;
  }
  if (engineType === "voiceroid2") {
    return getVoiceroidBridgePath();
  }

  // Select path based on platform
  let enginePaths: Record<VoicevoxEngineType, string>;
  if (process.platform === "win32") {
    enginePaths = WINDOWS_ENGINE_PATHS;
  } else if (process.platform === "darwin") {
    enginePaths = MAC_ENGINE_PATHS;
  } else {
    enginePaths = LINUX_ENGINE_PATHS;
  }

  const path = enginePaths[engineType as VoicevoxEngineType];
  console.log(`[getEnginePath] Predefined path for ${engineType}: ${path}`);
  return path;
}

// Check if port is in use
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

// Start voiceroid-bridge.exe (Windows-only, serves on VOICEVOX_PORT)
async function startVoiceroidBridge(isRestart = false): Promise<boolean> {
  const bridgePath = getVoiceroidBridgePath();
  if (!bridgePath) {
    console.log("[VoiceroidBridge] Binary not found, feature unavailable");
    return false;
  }

  const portInUse = await isPortInUse(VOICEVOX_PORT);
  if (portInUse) {
    if (isRestart) {
      console.log(`[VoiceroidBridge] Port ${VOICEVOX_PORT} still in use, waiting for release...`);
      const released = await waitForPortRelease(VOICEVOX_PORT);
      if (!released) {
        console.error(`[VoiceroidBridge] Port ${VOICEVOX_PORT} was not released in time`);
        return false;
      }
    } else {
      console.log(`[VoiceroidBridge] Port ${VOICEVOX_PORT} already in use, skipping`);
      return false;
    }
  }

  try {
    console.log(`[VoiceroidBridge] Starting: ${bridgePath}`);
    voiceroidBridgeProcess = spawn(bridgePath, ["--port", String(VOICEVOX_PORT)]);

    voiceroidBridgeProcess.stderr?.on("data", (data) => {
      console.log(`[VoiceroidBridge] ${data.toString().trim()}`);
    });
    voiceroidBridgeProcess.stdout?.on("data", (data) => {
      console.log(`[VoiceroidBridge] ${data.toString().trim()}`);
    });
    voiceroidBridgeProcess.on("error", (error) => {
      console.error("[VoiceroidBridge] Failed to start:", error);
      voiceroidBridgeProcess = null;
    });
    voiceroidBridgeProcess.on("exit", (code) => {
      console.log(`[VoiceroidBridge] Exited with code ${code}`);
      voiceroidBridgeProcess = null;
    });

    console.log(`[VoiceroidBridge] Started on port ${VOICEVOX_PORT}`);
    return true;
  } catch (error) {
    console.error("[VoiceroidBridge] Error starting:", error);
    voiceroidBridgeProcess = null;
    return false;
  }
}

// Stop voiceroid-bridge.exe
function stopVoiceroidBridge(): void {
  if (voiceroidBridgeProcess) {
    console.log("[VoiceroidBridge] Stopping...");
    if (process.platform === "win32" && voiceroidBridgeProcess.pid) {
      killProcessTree(voiceroidBridgeProcess.pid);
    } else {
      voiceroidBridgeProcess.kill("SIGTERM");
    }
    voiceroidBridgeProcess = null;
  }
}

// Start VOICEVOX Engine
// isRestart=true の場合、ポート解放をリトライで待つ（エンジン切替時用）
async function startVoicevoxEngine(isRestart = false): Promise<boolean> {
  // voiceroid2 uses the bundled bridge instead of a VOICEVOX-style engine
  const engineType = (store.get("engineType") as EngineType | undefined) || "aivis";
  if (engineType === "voiceroid2") {
    return startVoiceroidBridge(isRestart);
  }

  const voicevoxPath = getEnginePath();

  if (!voicevoxPath) {
    console.log("[Engine] Engine path not set, skipping auto-start");
    return false;
  }

  // Check if engine binary exists
  if (!fs.existsSync(voicevoxPath)) {
    console.log(`[Engine] Engine not found at: ${voicevoxPath}`);
    return false;
  }

  // Check if port is already in use
  const portInUse = await isPortInUse(VOICEVOX_PORT);
  if (portInUse) {
    if (isRestart) {
      // リスタート時はポート解放をリトライで待つ
      console.log(`[VOICEVOX] Port ${VOICEVOX_PORT} still in use, waiting for release...`);
      const released = await waitForPortRelease(VOICEVOX_PORT);
      if (!released) {
        console.error(`[VOICEVOX] Port ${VOICEVOX_PORT} was not released in time, cannot start engine`);
        return false;
      }
    } else {
      console.log(`[VOICEVOX] Port ${VOICEVOX_PORT} is already in use, skipping auto-start`);
      return false;
    }
  }

  try {
    console.log(`[VOICEVOX] Starting engine at: ${voicevoxPath}`);
    voicevoxProcess = spawn(voicevoxPath, ["--port", String(VOICEVOX_PORT), "--cors_policy_mode", "all"]);

    voicevoxProcess.stdout?.on("data", (data) => {
      console.log(`[VOICEVOX] ${data.toString().trim()}`);
    });

    voicevoxProcess.stderr?.on("data", (data) => {
      console.error(`[VOICEVOX] ${data.toString().trim()}`);
    });

    voicevoxProcess.on("error", (error) => {
      console.error("[VOICEVOX] Failed to start:", error);
      voicevoxProcess = null;
    });

    voicevoxProcess.on("exit", (code) => {
      console.log(`[VOICEVOX] Process exited with code ${code}`);
      voicevoxProcess = null;
    });

    console.log(`[VOICEVOX] Engine started on port ${VOICEVOX_PORT}`);
    return true;
  } catch (error) {
    console.error("[VOICEVOX] Error starting engine:", error);
    voicevoxProcess = null;
    return false;
  }
}

// Wait for port to be released
async function waitForPortRelease(port: number, maxAttempts: number = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const inUse = await isPortInUse(port);
    if (!inUse) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Kill process tree on Windows (taskkill /T terminates child processes)
function killProcessTree(pid: number): void {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  } catch {
    // Process may have already exited
  }
}

// Stop VOICEVOX Engine
async function stopVoicevoxEngine(): Promise<void> {
  // Also stop bridge if it's running (voiceroid2 mode)
  stopVoiceroidBridge();

  if (voicevoxProcess) {
    console.log("[Engine] Stopping engine...");
    const proc = voicevoxProcess;
    voicevoxProcess = null;

    if (process.platform === "win32" && proc.pid) {
      killProcessTree(proc.pid);
      // macOSと同様にプロセス終了を待つ
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log("[Engine] Windows process did not exit in time after taskkill");
          resolve();
        }, 5000);
        proc.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } else {
      // Try graceful shutdown first
      proc.kill("SIGTERM");

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log("[Engine] Force killing engine...");
          proc.kill("SIGKILL");
          resolve();
        }, 5000);

        proc.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    // Wait for port to be released
    console.log("[Engine] Waiting for port to be released...");
    const released = await waitForPortRelease(VOICEVOX_PORT);
    if (!released) {
      console.warn("[Engine] Port was not released in time");
    }
  }
}

const createWindow = () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: workX, y: workY, width: workW, height: workH } = primaryDisplay.bounds;

  mainWindow = new BrowserWindow({
    width: workW,
    height: workH,
    x: workX,
    y: workY,
    icon: getIconPath(),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // 初期状態ではマウスイベントを受け取る（ドラッグ可能にするため）
  // forward: trueを指定してマウス移動イベントを常に受信
  mainWindow.setIgnoreMouseEvents(false, { forward: true });
  mainWindow.setAlwaysOnTop(true, "pop-up-menu");

  // Force position to cover menu bar area on macOS
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBounds({ x: workX, y: workY, width: workW, height: workH });

      // macOS: ウィンドウが表示された後にDockを非表示にする
      // ※起動時にapp.dock.hide()を呼ぶとフルスクリーンSpaceで起動してしまうため
      if (process.platform === "darwin" && app.dock) {
        setTimeout(() => {
          app.dock?.hide();
          console.log("[Main] Dock icon hidden after window shown");
        }, 500);
      }
    }
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Track which display the window is currently on
  let currentDisplayId = primaryDisplay.id;

  // Fit window to the display it's currently on
  const fitWindowToCurrentDisplay = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const centerX = bounds.x + Math.round(bounds.width / 2);
    const centerY = bounds.y + Math.round(bounds.height / 2);
    const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
    currentDisplayId = display.id;
    const { x, y, width, height } = display.bounds;
    mainWindow.setBounds({ x, y, width, height });
  };

  // Resize window when it moves to a different display
  mainWindow.on("moved", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const centerX = bounds.x + Math.round(bounds.width / 2);
    const centerY = bounds.y + Math.round(bounds.height / 2);
    const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
    if (display.id !== currentDisplayId) {
      fitWindowToCurrentDisplay();
    }
  });

  // Resize window when display metrics change (resolution, scaling, etc.)
  screen.on("display-metrics-changed", () => {
    fitWindowToCurrentDisplay();
  });

  // Handle display added/removed
  screen.on("display-added", () => {
    fitWindowToCurrentDisplay();
  });
  screen.on("display-removed", () => {
    fitWindowToCurrentDisplay();
  });

  // Wait for the window to be ready before starting log monitor
  mainWindow.webContents.on("did-finish-load", () => {
    startLogMonitor();
  });

  // Disable always-on-top when DevTools is opened to allow switching to other apps
  mainWindow.webContents.on("devtools-opened", () => {
    console.log("[Main] DevTools opened, disabling always-on-top and resizing to avoid menu bar");
    mainWindow?.setAlwaysOnTop(false);
    mainWindow?.webContents.send("devtools-state-changed", true);
    // Resize window to avoid menu bar area on current display
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      const centerX = bounds.x + Math.round(bounds.width / 2);
      const centerY = bounds.y + Math.round(bounds.height / 2);
      const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
      const { x, y, width, height } = display.workArea;
      mainWindow.setBounds({ x, y, width, height });
      console.log(`[Main] Window resized to workArea: ${width}x${height} at (${x}, ${y})`);
    }
  });

  mainWindow.webContents.on("devtools-closed", () => {
    console.log("[Main] DevTools closed, enabling always-on-top and resizing to full screen");
    mainWindow?.setAlwaysOnTop(true, "pop-up-menu");
    mainWindow?.webContents.send("devtools-state-changed", false);
    // Resize window to cover full display bounds
    fitWindowToCurrentDisplay();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      console.log(`[Main] Window resized to bounds: ${bounds.width}x${bounds.height} at (${bounds.x}, ${bounds.y})`);
    }
  });
};

// Create license window
const createLicenseWindow = () => {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.focus();
    return;
  }

  // Read licenses.json
  const licensesPath = process.env.VITE_DEV_SERVER_URL
    ? path.join(__dirname, "../public/licenses.json")
    : path.join(__dirname, "../dist/licenses.json");

  let licensesData: Record<
    string,
    {
      licenses?: string;
      licenseText?: string;
      repository?: string;
      publisher?: string;
    }
  > = {};

  try {
    const fileContent = fs.readFileSync(licensesPath, "utf-8");
    licensesData = JSON.parse(fileContent);
  } catch (error) {
    console.error("[License] Failed to load licenses.json:", error);
    dialog.showErrorBox(
      "ライセンス情報の読み込みエラー",
      "ライセンス情報ファイルが見つかりませんでした。\nビルドを実行してください。",
    );
    return;
  }

  // Generate HTML content
  const licensesHtml = Object.entries(licensesData)
    .map(([name, info]) => {
      const licenseType = info.licenses || "Unknown";
      const licenseText = info.licenseText || "License text not available";
      const repository = info.repository || "";
      const publisher = info.publisher || "";

      return `
        <details>
          <summary>
            <strong>${escapeHtml(name)}</strong> - ${escapeHtml(licenseType)}
            ${publisher ? `<span class="publisher">(${escapeHtml(publisher)})</span>` : ""}
          </summary>
          <div class="license-content">
            ${repository ? `<p class="repository">Repository: <a href="${escapeHtml(repository)}" target="_blank">${escapeHtml(repository)}</a></p>` : ""}
            <pre>${escapeHtml(licenseText)}</pre>
          </div>
        </details>
      `;
    })
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OSSライセンス情報</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 20px;
          background-color: #f5f5f5;
        }
        h1 {
          font-size: 24px;
          margin: 0 0 20px 0;
          color: #333;
        }
        details {
          background: white;
          border-radius: 4px;
          margin-bottom: 8px;
          padding: 12px;
          border: 1px solid #e0e0e0;
        }
        summary {
          cursor: pointer;
          font-size: 14px;
          outline: none;
          user-select: none;
          color: #333;
        }
        summary:hover {
          color: #0066cc;
        }
        .publisher {
          color: #666;
          font-size: 13px;
        }
        .license-content {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #e0e0e0;
        }
        .repository {
          font-size: 13px;
          color: #666;
          margin: 0 0 12px 0;
        }
        .repository a {
          color: #0066cc;
          text-decoration: none;
        }
        .repository a:hover {
          text-decoration: underline;
        }
        pre {
          background-color: #f9f9f9;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          padding: 12px;
          font-size: 12px;
          line-height: 1.5;
          overflow-x: auto;
          white-space: pre-wrap;
          word-wrap: break-word;
          margin: 0;
        }
      </style>
    </head>
    <body>
      <h1>OSSライセンス情報</h1>
      ${licensesHtml}
    </body>
    </html>
  `;

  licenseWindow = new BrowserWindow({
    width: 700,
    height: 600,
    icon: getIconPath(),
    alwaysOnTop: true,
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  licenseWindow.setAlwaysOnTop(true, "pop-up-menu", 1);

  // Load HTML from data URI
  licenseWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // Open links in external browser
  licenseWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  licenseWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("data:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  licenseWindow.on("closed", () => {
    licenseWindow = null;
  });
};

// IPC handlers
ipcMain.handle("get-voicevox-path", () => {
  return store.get("voicevoxEnginePath") as string | undefined;
});

ipcMain.handle("set-voicevox-path", async (_event, path: string) => {
  store.set("voicevoxEnginePath", path);
  // Restart engine if it's running
  await stopVoicevoxEngine();
  const started = await startVoicevoxEngine(true);
  return started;
});

ipcMain.handle("get-engine-type", () => {
  return (store.get("engineType") as EngineType | undefined) || "aivis";
});

ipcMain.handle("set-engine-settings", async (_event, engineType: EngineType, customPath?: string) => {
  console.log(`[IPC] set-engine-settings called: engineType=${engineType}, customPath=${customPath}`);
  store.set("engineType", engineType);
  if (engineType === "custom" && customPath) {
    store.set("voicevoxEnginePath", customPath);
  }
  console.log(`[IPC] Stored engineType: ${store.get("engineType")}`);
  // Restart engine
  await stopVoicevoxEngine();
  const started = await startVoicevoxEngine(true);
  return started;
});

ipcMain.handle("reset-engine-settings", async () => {
  console.log("[IPC] reset-engine-settings called");
  store.delete("engineType");
  store.delete("voicevoxEnginePath");
  // Stop engine and restart with default settings (AivisSpeech)
  await stopVoicevoxEngine();
  const started = await startVoicevoxEngine(true);
  return started;
});

// Get current character size from Electron Store
ipcMain.handle("get-character-size", () => {
  return (store.get("characterSize") as number) || 200;
});

// Debounce timer for disk persistence during rapid slider events
let characterSizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Set character size with validation
ipcMain.handle("set-character-size", (_event, size: number) => {
  const clampedSize = Math.max(80, Math.min(400, Math.round(size)));

  // Debounce disk persistence to avoid blocking main process during rapid slider events
  if (characterSizeDebounceTimer) clearTimeout(characterSizeDebounceTimer);
  characterSizeDebounceTimer = setTimeout(() => {
    store.set("characterSize", clampedSize);
  }, 300);

  return clampedSize;
});

// Reset character size to default
ipcMain.handle("reset-character-size", () => {
  const defaultSize = 200;
  store.delete("characterSize");
  return defaultSize;
});


// Active session filter
ipcMain.handle("get-active-session", () => {
  return activeSessionId;
});

ipcMain.handle("clear-active-session", () => {
  activeSessionId = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("active-session-changed", null);
  }
  return true;
});

// Reset all settings
ipcMain.handle("reset-all-settings", async () => {
  store.delete("engineType");
  store.delete("voicevoxEnginePath");
  store.delete("characterSize");
  store.delete("muteOnMicActive");
  store.delete("includeSubAgents");
  store.delete("speakerId");
  store.delete("volumeScale");
  store.delete("autoUpdateCheck");
  store.delete("watchPath");
  store.delete("codexWatchPath");
  store.delete("notificationPhrases");
  store.delete("popupPosition");
  store.delete("popupAnimation");
  store.delete("popupDirection");
  store.delete("notificationMode");
  store.delete("webhookService");
  store.delete("webhookUrl");
  stopMicMonitor();

  await stopVoicevoxEngine();
  const started = await startVoicevoxEngine(true);

  // Restart log monitors with default settings
  startLogMonitor();
  startCodexLogMonitor();

  return started;
});

// Open DevTools for main window
ipcMain.handle("open-devtools", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.openDevTools();
  }
});

// Get current mic active state (for initial state query from renderer)
ipcMain.handle("get-mic-active", () => {
  return micActive;
});

// Mic monitor settings
ipcMain.handle("get-mute-on-mic-active", () => {
  const value = store.get("muteOnMicActive");
  return value === undefined ? false : (value as boolean);
});

ipcMain.handle("set-mute-on-mic-active", (_event, value: boolean) => {
  store.set("muteOnMicActive", value);
  if (value) {
    startMicMonitor();
  } else {
    stopMicMonitor();
    // Notify renderer that mic is no longer active
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mic-active-changed", false);
    }
  }
  return true;
});

ipcMain.handle("get-default-engine-path", (_event, engineType: VoicevoxEngineType) => {
  const enginePaths = process.platform === "win32" ? WINDOWS_ENGINE_PATHS
    : process.platform === "darwin" ? MAC_ENGINE_PATHS
    : LINUX_ENGINE_PATHS;
  return enginePaths[engineType] ?? "";
});

ipcMain.handle("get-mic-monitor-available", () => {
  return getMicMonitorPath() !== undefined;
});

ipcMain.handle("get-voiceroid-bridge-available", () => {
  return getVoiceroidBridgePath() !== undefined;
});

ipcMain.handle("get-include-sub-agents", () => {
  const value = store.get("includeSubAgents");
  return value === undefined ? false : (value as boolean);
});

ipcMain.handle("set-include-sub-agents", (_event, value: boolean) => {
  store.set("includeSubAgents", value);
  console.log(`[IPC] includeSubAgents set to ${value}, restarting log monitor`);
  startLogMonitor();
  return true;
});

ipcMain.handle("get-watch-path", () => {
  return (store.get("watchPath") as string | undefined) ?? "";
});

ipcMain.handle("set-watch-path", (_event, watchPath: string) => {
  if (watchPath.trim()) {
    store.set("watchPath", watchPath.trim());
  } else {
    store.delete("watchPath");
  }
  console.log(`[IPC] watchPath set to "${watchPath.trim() || "default"}", restarting log monitor`);
  startLogMonitor();
  return true;
});

ipcMain.handle("get-codex-active-file", () => {
  return activeCodexFilePath;
});

ipcMain.handle("clear-codex-active-file", () => {
  codexLogMonitor?.resetActiveFile();
  return true;
});

ipcMain.handle("get-codex-watch-path", () => {
  return (store.get("codexWatchPath") as string | undefined) ?? "";
});

ipcMain.handle("set-codex-watch-path", (_event, codexWatchPath: string) => {
  if (codexWatchPath.trim()) {
    store.set("codexWatchPath", codexWatchPath.trim());
  } else {
    store.delete("codexWatchPath");
  }
  console.log(`[IPC] codexWatchPath set to "${codexWatchPath.trim() || "default"}", restarting Codex monitor`);
  startCodexLogMonitor();
  return true;
});

// Notification phrases
ipcMain.handle("get-notification-phrases", () => {
  return (store.get("notificationPhrases") as Record<string, string[]> | undefined) ?? null;
});

ipcMain.handle("set-notification-phrases", (_event, phrases: Record<string, string[]>) => {
  store.set("notificationPhrases", phrases);
  return true;
});

// Speaker settings
ipcMain.handle("get-speaker-id", () => {
  return (store.get("speakerId") as number | undefined) ?? 888753760;
});

ipcMain.handle("set-speaker-id", (_event, id: number) => {
  store.set("speakerId", id);
  return true;
});

// Volume settings
ipcMain.handle("get-volume-scale", () => {
  return (store.get("volumeScale") as number | undefined) ?? 1.0;
});

ipcMain.handle("set-volume-scale", (_event, volume: number) => {
  store.set("volumeScale", Math.max(0, Math.min(2, volume)));
  return true;
});

ipcMain.handle("get-auto-update-check", () => {
  const value = store.get("autoUpdateCheck");
  return value === undefined ? true : (value as boolean);
});

ipcMain.handle("set-auto-update-check", (_event, value: boolean) => {
  store.set("autoUpdateCheck", value);
  return true;
});

// Popup appearance settings
ipcMain.handle("get-popup-position", () => {
  return (store.get("popupPosition") as string | undefined) ?? "bottom-right";
});

ipcMain.handle("set-popup-position", (_event, value: string) => {
  store.set("popupPosition", value);
  return true;
});

ipcMain.handle("get-popup-animation", () => {
  return (store.get("popupAnimation") as string | undefined) ?? "slide";
});

ipcMain.handle("set-popup-animation", (_event, value: string) => {
  store.set("popupAnimation", value);
  return true;
});

ipcMain.handle("get-popup-direction", () => {
  return (store.get("popupDirection") as string | undefined) ?? "primary";
});

ipcMain.handle("set-popup-direction", (_event, value: string) => {
  store.set("popupDirection", value);
  return true;
});

ipcMain.handle("get-notification-mode", () => {
  return (store.get("notificationMode") as string | undefined) ?? "both";
});
ipcMain.handle("set-notification-mode", (_event, value: string) => {
  store.set("notificationMode", value);
  notificationMode = value;
  updateTrayMenu();
  return true;
});

// Webhook notification settings
ipcMain.handle("get-webhook-service", () => {
  return (store.get("webhookService") as string | undefined) ?? "none";
});

ipcMain.handle("set-webhook-service", (_event, value: string) => {
  store.set("webhookService", value);
  return true;
});

ipcMain.handle("get-webhook-url", () => {
  return (store.get("webhookUrl") as string | undefined) ?? "";
});

ipcMain.handle("set-webhook-url", (_event, url: string) => {
  store.set("webhookUrl", url);
  return true;
});

ipcMain.handle("send-webhook-notification", async (_event, phrase: string, emotion: string) => {
  if (emotion !== "happy" && emotion !== "relaxed") return;
  const service = ((store.get("webhookService") as string | undefined) ?? "none") as WebhookService;
  const url = (store.get("webhookUrl") as string | undefined) ?? "";
  await sendWebhookNotification(service, url, phrase);
});

ipcMain.on("set-ignore-mouse-events", (_event, ignore: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Always use forward: true to keep receiving mouse move events even when ignoring clicks
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  createTray();

  // Start Claude settings monitor (allowedTools detection)
  // __dirname is dist-electron/ in prod and electron/ in dev; one level up is the project root
  const projectRoot = path.resolve(__dirname, "..");
  settingsMonitor = createClaudeSettingsMonitor(projectRoot);

  // Check if engine binary exists before attempting to start
  const enginePath = getEnginePath();
  const engineInstalled = enginePath ? fs.existsSync(enginePath) : false;

  await startVoicevoxEngine();

  // Start mic monitor if enabled (default: false)
  if (store.get("muteOnMicActive") === true) {
    startMicMonitor();
  }

  startCodexLogMonitor();
  createWindow();
  const autoUpdateCheck = (store.get("autoUpdateCheck") as boolean | undefined) ?? true;
  initAutoUpdater(mainWindow!, autoUpdateCheck);

  // Show dialog and open settings panel if engine is not found
  if (!engineInstalled && mainWindow && !mainWindow.isDestroyed()) {
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "音声合成エンジンが見つかりません",
      message:
        "選択中の音声合成エンジンが見つかりませんでした。\nエンジンをインストールするか、設定画面でエンジンの設定を確認してください。",
    });
    mainWindow.webContents.send("toggle-settings-panel");
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 常駐アプリなので、ウィンドウが全て閉じてもアプリは終了しない
app.on("window-all-closed", () => {
  // noop: trayから終了する
});

// Clean up on quit
let isQuitting = false;
app.on("before-quit", async (event) => {
  if (isQuitting) return;

  isQuitting = true;
  event.preventDefault();

  if (logMonitor) {
    logMonitor.close();
  }
  if (codexLogMonitor) {
    codexLogMonitor.close();
  }
  if (settingsMonitor) {
    settingsMonitor.close();
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  stopMicMonitor();
  await stopVoicevoxEngine();

  app.quit();
});
