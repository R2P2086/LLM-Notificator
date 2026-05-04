export {};

export type EngineType = "aivis" | "voicevox" | "custom" | "voiceroid2";

declare global {
  interface Window {
    electron?: {
      onSpeak: (callback: (message: string) => void) => () => void;
      getVoicevoxPath: () => Promise<string | undefined>;
      setVoicevoxPath: (path: string) => Promise<boolean>;
      getEngineType: () => Promise<EngineType | undefined>;
      setEngineSettings: (engineType: EngineType, customPath?: string) => Promise<boolean>;
      resetEngineSettings: () => Promise<boolean>;
      setIgnoreMouseEvents: (ignore: boolean) => void;
      getCharacterSize: () => Promise<number>;
      setCharacterSize: (size: number) => Promise<number>;
      resetCharacterSize: () => Promise<number>;
      resetAllSettings: () => Promise<boolean>;
      getDefaultEnginePath: (engineType: "aivis" | "voicevox") => Promise<string>;
      getVoiceroidBridgeAvailable: () => Promise<boolean>;
      getIncludeSubAgents: () => Promise<boolean>;
      setIncludeSubAgents: (value: boolean) => Promise<boolean>;
      getSpeakerId: () => Promise<number>;
      setSpeakerId: (id: number) => Promise<boolean>;
      getVolumeScale: () => Promise<number>;
      setVolumeScale: (volume: number) => Promise<boolean>;
      onDevToolsStateChanged: (callback: (isOpen: boolean) => void) => () => void;
      openDevTools: () => Promise<void>;
      onToggleSettingsPanel: (callback: () => void) => () => void;
      onNotificationModeChanged: (callback: (mode: string) => void) => () => void;
      getAutoUpdateCheck: () => Promise<boolean>;
      setAutoUpdateCheck: (value: boolean) => Promise<boolean>;
      getActiveSession: () => Promise<string | null>;
      clearActiveSession: () => Promise<boolean>;
      onActiveSessionChanged: (callback: (sessionId: string | null) => void) => () => void;
      getWatchPath: () => Promise<string>;
      setWatchPath: (watchPath: string) => Promise<boolean>;
      getCodexActiveFile: () => Promise<string | null>;
      clearCodexActiveFile: () => Promise<boolean>;
      onCodexActiveFileChanged: (callback: (filePath: string | null) => void) => () => void;
      getCodexWatchPath: () => Promise<string>;
      setCodexWatchPath: (watchPath: string) => Promise<boolean>;
      getNotificationPhrases: () => Promise<Record<string, string[]> | null>;
      setNotificationPhrases: (phrases: Record<string, string[]>) => Promise<boolean>;
      getPopupPosition: () => Promise<string>;
      setPopupPosition: (value: string) => Promise<boolean>;
      getPopupAnimation: () => Promise<string>;
      setPopupAnimation: (value: string) => Promise<boolean>;
      getPopupDirection: () => Promise<string>;
      setPopupDirection: (value: string) => Promise<boolean>;
      getNotificationMode: () => Promise<string>;
      setNotificationMode: (value: string) => Promise<boolean>;
      getWebhookService: () => Promise<string>;
      setWebhookService: (value: string) => Promise<boolean>;
      getWebhookUrl: () => Promise<string>;
      setWebhookUrl: (url: string) => Promise<boolean>;
      sendWebhookNotification: (phrase: string, emotion: string) => Promise<void>;
    };
  }
}
