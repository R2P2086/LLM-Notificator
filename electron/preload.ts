// Modified from the original cc-mascot project by kazakago.
// Original: https://github.com/kazakago/cc-mascot (Apache License 2.0)
import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
export type EngineType = "aivis" | "voicevox" | "custom";

contextBridge.exposeInMainWorld("electron", {
  onSpeak: (callback: (message: string) => void) => {
    const listener = (_event: unknown, message: string) => {
      callback(message);
    };
    ipcRenderer.on("speak", listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("speak", listener);
    };
  },
  getVoicevoxPath: (): Promise<string | undefined> => {
    return ipcRenderer.invoke("get-voicevox-path");
  },
  setVoicevoxPath: (path: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-voicevox-path", path);
  },
  getEngineType: (): Promise<EngineType | undefined> => {
    return ipcRenderer.invoke("get-engine-type");
  },
  setEngineSettings: (engineType: EngineType, customPath?: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-engine-settings", engineType, customPath);
  },
  resetEngineSettings: (): Promise<boolean> => {
    return ipcRenderer.invoke("reset-engine-settings");
  },
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send("set-ignore-mouse-events", ignore);
  },
  getCharacterSize: (): Promise<number> => {
    return ipcRenderer.invoke("get-character-size");
  },
  setCharacterSize: (size: number): Promise<number> => {
    return ipcRenderer.invoke("set-character-size", size);
  },
  resetCharacterSize: (): Promise<number> => {
    return ipcRenderer.invoke("reset-character-size");
  },
  resetAllSettings: (): Promise<boolean> => {
    return ipcRenderer.invoke("reset-all-settings");
  },
  getMicActive: (): Promise<boolean> => {
    return ipcRenderer.invoke("get-mic-active");
  },
  getMuteOnMicActive: (): Promise<boolean> => {
    return ipcRenderer.invoke("get-mute-on-mic-active");
  },
  setMuteOnMicActive: (value: boolean): Promise<boolean> => {
    return ipcRenderer.invoke("set-mute-on-mic-active", value);
  },
  getDefaultEnginePath: (engineType: "aivis" | "voicevox"): Promise<string> => {
    return ipcRenderer.invoke("get-default-engine-path", engineType);
  },
  getMicMonitorAvailable: (): Promise<boolean> => {
    return ipcRenderer.invoke("get-mic-monitor-available");
  },
  getVoiceroidBridgeAvailable: (): Promise<boolean> => {
    return ipcRenderer.invoke("get-voiceroid-bridge-available");
  },
  getIncludeSubAgents: (): Promise<boolean> => {
    return ipcRenderer.invoke("get-include-sub-agents");
  },
  setIncludeSubAgents: (value: boolean): Promise<boolean> => {
    return ipcRenderer.invoke("set-include-sub-agents", value);
  },
  getSpeakerId: (): Promise<number> => {
    return ipcRenderer.invoke("get-speaker-id");
  },
  setSpeakerId: (id: number): Promise<boolean> => {
    return ipcRenderer.invoke("set-speaker-id", id);
  },
  getVolumeScale: (): Promise<number> => {
    return ipcRenderer.invoke("get-volume-scale");
  },
  setVolumeScale: (volume: number): Promise<boolean> => {
    return ipcRenderer.invoke("set-volume-scale", volume);
  },
  onMicActiveChanged: (callback: (active: boolean) => void) => {
    const listener = (_event: unknown, active: boolean) => {
      callback(active);
    };
    ipcRenderer.on("mic-active-changed", listener);
    return () => {
      ipcRenderer.removeListener("mic-active-changed", listener);
    };
  },
  onDevToolsStateChanged: (callback: (isOpen: boolean) => void) => {
    const listener = (_event: unknown, isOpen: boolean) => {
      callback(isOpen);
    };
    ipcRenderer.on("devtools-state-changed", listener);
    return () => {
      ipcRenderer.removeListener("devtools-state-changed", listener);
    };
  },
  openDevTools: (): Promise<void> => {
    return ipcRenderer.invoke("open-devtools");
  },
  onNotificationModeChanged: (callback: (mode: string) => void) => {
    const listener = (_event: unknown, mode: string) => {
      callback(mode);
    };
    ipcRenderer.on("notification-mode-changed", listener);
    return () => {
      ipcRenderer.removeListener("notification-mode-changed", listener);
    };
  },
  onToggleSettingsPanel: (callback: () => void) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on("toggle-settings-panel", listener);
    return () => {
      ipcRenderer.removeListener("toggle-settings-panel", listener);
    };
  },
  getAutoUpdateCheck: (): Promise<boolean> => {
    return ipcRenderer.invoke("get-auto-update-check");
  },
  setAutoUpdateCheck: (value: boolean): Promise<boolean> => {
    return ipcRenderer.invoke("set-auto-update-check", value);
  },
  getActiveSession: (): Promise<string | null> => {
    return ipcRenderer.invoke("get-active-session");
  },
  clearActiveSession: (): Promise<boolean> => {
    return ipcRenderer.invoke("clear-active-session");
  },
  onActiveSessionChanged: (callback: (sessionId: string | null) => void) => {
    const listener = (_event: unknown, sessionId: string | null) => {
      callback(sessionId);
    };
    ipcRenderer.on("active-session-changed", listener);
    return () => {
      ipcRenderer.removeListener("active-session-changed", listener);
    };
  },
  getWatchPath: (): Promise<string> => {
    return ipcRenderer.invoke("get-watch-path");
  },
  setWatchPath: (watchPath: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-watch-path", watchPath);
  },
  getCodexActiveFile: (): Promise<string | null> => {
    return ipcRenderer.invoke("get-codex-active-file");
  },
  clearCodexActiveFile: (): Promise<boolean> => {
    return ipcRenderer.invoke("clear-codex-active-file");
  },
  onCodexActiveFileChanged: (callback: (filePath: string | null) => void) => {
    const listener = (_event: unknown, filePath: string | null) => {
      callback(filePath);
    };
    ipcRenderer.on("codex-active-file-changed", listener);
    return () => {
      ipcRenderer.removeListener("codex-active-file-changed", listener);
    };
  },
  getCodexWatchPath: (): Promise<string> => {
    return ipcRenderer.invoke("get-codex-watch-path");
  },
  setCodexWatchPath: (watchPath: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-codex-watch-path", watchPath);
  },
  getNotificationPhrases: (): Promise<Record<string, string[]> | null> => {
    return ipcRenderer.invoke("get-notification-phrases");
  },
  setNotificationPhrases: (phrases: Record<string, string[]>): Promise<boolean> => {
    return ipcRenderer.invoke("set-notification-phrases", phrases);
  },
  getPopupPosition: (): Promise<string> => {
    return ipcRenderer.invoke("get-popup-position");
  },
  setPopupPosition: (value: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-popup-position", value);
  },
  getPopupAnimation: (): Promise<string> => {
    return ipcRenderer.invoke("get-popup-animation");
  },
  setPopupAnimation: (value: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-popup-animation", value);
  },
  getPopupDirection: (): Promise<string> => {
    return ipcRenderer.invoke("get-popup-direction");
  },
  setPopupDirection: (value: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-popup-direction", value);
  },
  getNotificationMode: (): Promise<string> => {
    return ipcRenderer.invoke("get-notification-mode");
  },
  setNotificationMode: (value: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-notification-mode", value);
  },
  getWebhookService: (): Promise<string> => {
    return ipcRenderer.invoke("get-webhook-service");
  },
  setWebhookService: (value: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-webhook-service", value);
  },
  getWebhookUrl: (): Promise<string> => {
    return ipcRenderer.invoke("get-webhook-url");
  },
  setWebhookUrl: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke("set-webhook-url", url);
  },
  sendWebhookNotification: (phrase: string, emotion: string): Promise<void> => {
    return ipcRenderer.invoke("send-webhook-notification", phrase, emotion);
  },
});
