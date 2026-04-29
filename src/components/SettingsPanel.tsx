// Modified from the original cc-mascot project by kazakago.
// Original: https://github.com/kazakago/cc-mascot (Apache License 2.0)
import { useState, useEffect, useRef, useCallback } from "react";
import type { EngineType } from "../global";
import { getSpeakers } from "../services/voicevox";
import { saveImageFile, loadImageFile, deleteImageFile } from "../utils/imageStorage";
import { NOTIFICATION_PHRASES } from "../constants/notificationPhrases";
import type { PopupPosition, PopupAnimation, PopupDirection, NotificationMode } from "../types/popup";
import { CORNER_POSITIONS } from "../types/popup";

const VOICEVOX_BASE_URL = "http://localhost:8564";

type Tab = "character" | "audio" | "monitor" | "misc";
type ColorMode = "light" | "dark";

type WebhookService = "none" | "slack" | "discord" | "teams";

const WEBHOOK_SERVICE_OPTIONS: Array<{ value: WebhookService; label: string }> = [
  { value: "none", label: "無効" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "teams", label: "Microsoft Teams（未検証）" },
];

const TABS: { id: Tab; label: string }[] = [
  { id: "character", label: "キャラクター" },
  { id: "audio", label: "音声" },
  { id: "monitor", label: "監視" },
  { id: "misc", label: "その他" },
];

const PHRASE_EMOTIONS: Array<{ key: string; label: string }> = [
  { key: "happy", label: "完了" },
  { key: "relaxed", label: "確認" },
  { key: "surprised", label: "コマンド" },
];

const POPUP_POSITION_OPTIONS: Array<{ value: PopupPosition; label: string }> = [
  { value: "bottom-right", label: "右下" },
  { value: "bottom-left", label: "左下" },
  { value: "bottom-center", label: "下中央" },
  { value: "top-right", label: "右上" },
  { value: "top-left", label: "左上" },
  { value: "top-center", label: "上中央" },
  { value: "right-center", label: "右中央" },
  { value: "left-center", label: "左中央" },
];

const POPUP_ANIMATION_OPTIONS: Array<{ value: PopupAnimation; label: string; description: string }> = [
  { value: "slide", label: "スライド", description: "画面端から滑り込む" },
  { value: "pop", label: "ポップ", description: "スケールバウンスで登場" },
  { value: "fade", label: "フェード", description: "フェードイン/アウト" },
  { value: "static", label: "なし", description: "瞬時に表示（自前アニメ画像向け）" },
];

interface SpeakerOption {
  id: number;
  name: string;
  speakerName: string;
}

interface SettingsPanelProps {
  speakerId: number;
  onSpeakerIdChange: (id: number) => void;
  volumeScale: number;
  onVolumeScaleChange: (volume: number) => void;
  containerSize: number;
  onContainerSizeChange: (size: number) => void;
  onImageChange: () => void;
  onTestSpeech: () => void;
  muteOnMicActive: boolean;
  onMuteOnMicActiveChange: (value: boolean) => void;
  popupPosition: PopupPosition;
  onPopupPositionChange: (value: PopupPosition) => void;
  popupAnimation: PopupAnimation;
  onPopupAnimationChange: (value: PopupAnimation) => void;
  popupDirection: PopupDirection;
  onPopupDirectionChange: (value: PopupDirection) => void;
  notificationMode: NotificationMode;
  onNotificationModeChange: (value: NotificationMode) => void;
  webhookService: string;
  onWebhookServiceChange: (value: string) => void;
  onResetAllSettings: () => void;
  onClose: () => void;
}

export default function SettingsPanel({
  speakerId,
  onSpeakerIdChange,
  volumeScale,
  onVolumeScaleChange,
  containerSize,
  onContainerSizeChange,
  onImageChange,
  onTestSpeech,
  muteOnMicActive,
  onMuteOnMicActiveChange,
  popupPosition,
  onPopupPositionChange,
  popupAnimation,
  onPopupAnimationChange,
  popupDirection,
  onPopupDirectionChange,
  notificationMode,
  onNotificationModeChange,
  webhookService,
  onWebhookServiceChange,
  onResetAllSettings,
  onClose,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("character");
  const [colorMode, setColorMode] = useState<ColorMode>(() => (localStorage.getItem("colorMode") as ColorMode) ?? "light");
  const [imageFileName, setImageFileName] = useState<string | undefined>(undefined);
  const [engineType, setEngineType] = useState<EngineType>("aivis");
  const [defaultEnginePath, setDefaultEnginePath] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [error, setError] = useState("");
  const [speakers, setSpeakers] = useState<SpeakerOption[]>([]);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [isPlayingTest, setIsPlayingTest] = useState(false);
  const [testAudioError, setTestAudioError] = useState("");
  const [micMonitorAvailable, setMicMonitorAvailable] = useState(false);
  const [includeSubAgents, setIncludeSubAgents] = useState(false);
  const [autoUpdateCheck, setAutoUpdateCheck] = useState(true);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [watchPath, setWatchPath] = useState("");
  const [codexWatchPath, setCodexWatchPath] = useState("");
  const [activeCodexFile, setActiveCodexFile] = useState<string | null>(null);
  const [customPhrases, setCustomPhrases] = useState<Record<string, string[]>>({});
  const [newPhraseInputs, setNewPhraseInputs] = useState<Record<string, string>>({});
  const [webhookUrl, setWebhookUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDark = colorMode === "dark";

  const handleColorModeChange = (mode: ColorMode) => {
    setColorMode(mode);
    localStorage.setItem("colorMode", mode);
  };

  const fetchSpeakers = useCallback(async (maxRetries = 10) => {
    setLoadingSpeakers(true);
    setError("");
    for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
      try {
        const speakerList = await getSpeakers(VOICEVOX_BASE_URL);
        const options: SpeakerOption[] = [];
        for (const speaker of speakerList) {
          for (const style of speaker.styles) {
            options.push({ id: style.id, name: style.name, speakerName: speaker.name });
          }
        }
        setSpeakers(options);
        setLoadingSpeakers(false);
        return options;
      } catch {
        if (retryCount < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          setError("Failed to fetch speakers. Is the engine running?");
          setSpeakers([]);
          setLoadingSpeakers(false);
          return [];
        }
      }
    }
    return [];
  }, []);

  useEffect(() => {
    const loadInitialValues = async () => {
      if (window.electron?.getEngineType && window.electron?.getVoicevoxPath) {
        const [savedEngineType, savedCustomPath] = await Promise.all([
          window.electron.getEngineType(),
          window.electron.getVoicevoxPath(),
        ]);
        const effectiveEngineType = savedEngineType || "aivis";
        setEngineType(effectiveEngineType);
        setCustomPath(savedCustomPath || "");
        if (effectiveEngineType !== "custom" && window.electron?.getDefaultEnginePath) {
          const path = await window.electron.getDefaultEnginePath(effectiveEngineType);
          setDefaultEnginePath(path);
        }
      }
      if (window.electron?.getMicMonitorAvailable) setMicMonitorAvailable(await window.electron.getMicMonitorAvailable());
      if (window.electron?.getIncludeSubAgents) setIncludeSubAgents(await window.electron.getIncludeSubAgents());
      if (window.electron?.getAutoUpdateCheck) setAutoUpdateCheck(await window.electron.getAutoUpdateCheck());
      if (window.electron?.getActiveSession) setActiveSession(await window.electron.getActiveSession());
      if (window.electron?.getWatchPath) setWatchPath(await window.electron.getWatchPath());
      if (window.electron?.getCodexWatchPath) setCodexWatchPath(await window.electron.getCodexWatchPath());
      if (window.electron?.getCodexActiveFile) setActiveCodexFile(await window.electron.getCodexActiveFile());
      if (window.electron?.getNotificationPhrases) {
        const saved = await window.electron.getNotificationPhrases();
        if (saved) setCustomPhrases(saved);
      }
      if (window.electron?.getWebhookUrl) setWebhookUrl(await window.electron.getWebhookUrl());
      try {
        const imageFile = await loadImageFile();
        if (imageFile) setImageFileName(imageFile.name);
      } catch (err) {
        console.error("[SettingsPanel] Failed to load image file:", err);
      }
    };
    loadInitialValues();
  }, []);

  useEffect(() => {
    const cleanup = window.electron?.onActiveSessionChanged?.((sessionId) => setActiveSession(sessionId));
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const cleanup = window.electron?.onCodexActiveFileChanged?.((filePath) => setActiveCodexFile(filePath));
    return () => cleanup?.();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchSpeakers(); }, []);

  const restartEngine = async (engineTypeOverride?: EngineType, pathOverride?: string) => {
    setLoadingSpeakers(true);
    setSpeakers([]);
    setError("");
    const effectiveEngineType = engineTypeOverride !== undefined ? engineTypeOverride : engineType;
    const effectivePath = pathOverride !== undefined ? pathOverride : effectiveEngineType === "custom" ? customPath.trim() : undefined;
    if (window.electron?.setEngineSettings) {
      try {
        const started = await window.electron.setEngineSettings(effectiveEngineType, effectivePath);
        if (!started) {
          setError("エンジンの起動に失敗しました。エンジンがインストールされているか確認してください。");
          setLoadingSpeakers(false);
          return;
        }
        const newSpeakers = await fetchSpeakers();
        if (newSpeakers.length > 0 && !newSpeakers.some((s) => s.id === speakerId)) {
          const firstId = newSpeakers[0].id;
          onSpeakerIdChange(firstId);
          window.electron?.setSpeakerId?.(firstId);
        }
      } catch {
        setError("Failed to restart engine");
        setLoadingSpeakers(false);
      }
    }
  };

  const handleEngineTypeChange = async (newEngineType: EngineType) => {
    setEngineType(newEngineType);
    if (newEngineType !== "custom" && window.electron?.getDefaultEnginePath) {
      const path = await window.electron.getDefaultEnginePath(newEngineType);
      setDefaultEnginePath(path);
    }
    if (newEngineType === "custom" && !customPath.trim()) { setSpeakers([]); setLoadingSpeakers(false); return; }
    await restartEngine(newEngineType);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith(".png") && !ext.endsWith(".jpg") && !ext.endsWith(".jpeg") && !ext.endsWith(".gif") && !ext.endsWith(".svg") && !ext.endsWith(".webp")) {
      setError("PNG / JPG / GIF / SVG / WebP ファイルを選択してください");
      return;
    }
    setImageFileName(file.name);
    saveImageFile(file)
      .then(() => onImageChange())
      .catch(() => setError("Failed to save image file"));
    setError("");
  };

  const handleSpeakerChange = (newSpeakerId: number) => {
    onSpeakerIdChange(newSpeakerId);
    window.electron?.setSpeakerId?.(newSpeakerId);
  };

  const handleVolumeChangeComplete = () => { window.electron?.setVolumeScale?.(volumeScale); };

  const handleCharacterSizeChange = (newSize: number) => {
    onContainerSizeChange(newSize);
    window.electron?.setCharacterSize?.(newSize).catch(() => setError("Failed to change size"));
  };

  const handleTestSpeech = () => {
    if (isPlayingTest || speakers.length === 0) return;
    setIsPlayingTest(true);
    setTestAudioError("");
    onTestSpeech();
    setTimeout(() => setIsPlayingTest(false), 3000);
  };

  const saveCustomPhrases = async (updated: Record<string, string[]>) => {
    setCustomPhrases(updated);
    await window.electron?.setNotificationPhrases?.(updated);
  };

  const handleReset = async () => {
    if (confirm("Are you sure you want to reset all settings to defaults? This will close the settings panel.")) {
      await window.electron?.setWatchPath?.("");
      setWatchPath("");
      await window.electron?.setCodexWatchPath?.("");
      setCodexWatchPath("");
      onResetAllSettings();
      onClose();
    }
  };

  const isCorner = CORNER_POSITIONS.has(popupPosition);
  const needsDirection = isCorner && (popupAnimation === "slide" || popupAnimation === "pop");

  // Shared class fragments — light: stone (warm), dark: zinc (neutral)
  const inputCls = "px-3 py-2 border border-stone-200 dark:border-zinc-600 rounded-xl text-sm text-stone-800 dark:text-zinc-100 bg-white dark:bg-zinc-800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  const sectionCls = "rounded-2xl bg-stone-100/70 dark:bg-zinc-800/60 p-5 shadow-sm";
  const sectionHeadingCls = "m-0 text-base font-semibold text-stone-700 dark:text-zinc-200";
  const labelCls = "text-sm font-medium text-stone-600 dark:text-zinc-300";
  const mutedCls = "text-stone-400 dark:text-zinc-500";
  const whiteBtnCls = "px-4 py-2 rounded-xl text-sm font-medium border border-stone-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-700 hover:border-stone-300 dark:hover:border-zinc-500 hover:shadow-sm transition-all";
  const radioRowCls = "flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-zinc-700/60 transition-colors";
  const radioTextCls = "text-sm text-stone-800 dark:text-zinc-100 font-medium";
  const radioDescCls = "text-xs text-stone-400 dark:text-zinc-500";
  const applyBtnCls = "px-5 py-2 rounded-full text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors w-fit";
  const selectedBtnCls = "border-orange-500 bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300";
  const unselectedBtnCls = "border-stone-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-stone-700 dark:text-zinc-200 hover:border-stone-300 dark:hover:border-zinc-500";

  return (
    <div
      className={`fixed z-50 w-[560px] h-[480px] flex flex-col bg-stone-50 dark:bg-zinc-900 rounded-2xl shadow-2xl border border-stone-200 dark:border-zinc-700${isDark ? " dark" : ""}`}
      style={{ top: "calc(50% - 240px)", left: "calc(50% - 280px)" }}
      data-settings-panel
    >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-700 flex-shrink-0"
        >
          <h1 className="text-lg font-bold text-stone-800 dark:text-zinc-100 m-0">設定 - LLM Notificator</h1>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4L12 12M12 4L4 12" /></svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-stone-200 dark:border-zinc-700 flex-shrink-0 px-2">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === tab.id ? "border-orange-500 text-orange-600" : "border-transparent text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:border-stone-300 dark:hover:border-zinc-500"}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="overflow-y-auto flex-1 p-6 space-y-5">

          {/* ── キャラクター tab ── */}
          {activeTab === "character" && (
            <>
              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>通知画像</h2>
                <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.svg,.webp" onChange={handleFileChange} className="hidden" />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className={whiteBtnCls}>
                    画像ファイルを選択
                  </button>
                  {imageFileName && (
                    <button type="button" onClick={async () => {
                      await deleteImageFile();
                      setImageFileName(undefined);
                      onImageChange();
                    }} className={`text-sm underline ${mutedCls} hover:text-stone-600 dark:hover:text-zinc-300`}>
                      デフォルトに戻す
                    </button>
                  )}
                </div>
                <p className={`text-sm m-0 italic ${mutedCls}`}>{imageFileName || "デフォルト画像を使用中"}</p>
                <p className={`text-xs m-0 ${mutedCls}`}>PNG / JPG / GIF / SVG / WebP。GIFはアニメーションに対応。</p>
                {error && <p className="text-sm text-red-500 m-0">{error}</p>}
              </section>

              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>サイズ</h2>
                <label htmlFor="character-size" className={labelCls}>表示サイズ: {containerSize}px</label>
                <input type="range" id="character-size" min="80" max="400" step="10" value={containerSize}
                  onChange={(e) => handleCharacterSizeChange(Number(e.target.value))} className="w-full cursor-pointer" />
                <div className={`flex justify-between text-sm ${mutedCls}`}><span>80px (小)</span><span>400px (大)</span></div>
              </section>

              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>表示位置とアニメーション</h2>

                <div className="space-y-2">
                  <label className={labelCls}>表示位置</label>
                  <div className="grid grid-cols-3 gap-2">
                    {POPUP_POSITION_OPTIONS.map(({ value, label }) => (
                      <button key={value} type="button" onClick={() => onPopupPositionChange(value)}
                        className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${popupPosition === value ? selectedBtnCls : unselectedBtnCls}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={labelCls}>アニメーション</label>
                  <div className="space-y-1">
                    {POPUP_ANIMATION_OPTIONS.map(({ value, label, description }) => (
                      <label key={value} className={radioRowCls}>
                        <input type="radio" name="popupAnimation" value={value} checked={popupAnimation === value}
                          onChange={() => onPopupAnimationChange(value)} className="w-4 h-4 m-0 accent-orange-500" />
                        <span className={radioTextCls}>{label}</span>
                        <span className={radioDescCls}>{description}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {needsDirection && (
                  <div className="space-y-2">
                    <label className={labelCls}>スライド方向（コーナー位置）</label>
                    <div className="flex gap-2">
                      {(["primary", "secondary"] as PopupDirection[]).map((d) => {
                        const label = popupPosition.startsWith("bottom") || popupPosition.startsWith("top")
                          ? d === "primary" ? "縦（上/下）" : "横（左/右）"
                          : d === "primary" ? "横（左/右）" : "縦（上/下）";
                        return (
                          <button key={d} type="button" onClick={() => onPopupDirectionChange(d)}
                            className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition-all ${popupDirection === d ? selectedBtnCls : unselectedBtnCls}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className={labelCls}>通知モード</label>
                  <div className="space-y-1">
                    {([
                      { value: "both",   label: "両方",           desc: "ポップアップ + 発話" },
                      { value: "visual", label: "ポップアップのみ", desc: "発話なし" },
                      { value: "audio",  label: "発話のみ",        desc: "ポップアップなし" },
                    ] as { value: NotificationMode; label: string; desc: string }[]).map(({ value, label, desc }) => (
                      <label key={value} className={radioRowCls}>
                        <input type="radio" name="notificationMode" value={value} checked={notificationMode === value}
                          onChange={() => onNotificationModeChange(value)} className="w-4 h-4 m-0 accent-orange-500" />
                        <span className={radioTextCls}>{label}</span>
                        <span className={radioDescCls}>{desc}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}

          {/* ── 音声 tab ── */}
          {activeTab === "audio" && (
            <>
              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>エンジン</h2>
                <div className="flex flex-col gap-2">
                  {(["aivis", "voicevox", "custom"] as EngineType[]).map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer text-sm text-stone-800 dark:text-zinc-100">
                      <input type="radio" name="engineType" value={type} checked={engineType === type}
                        onChange={() => handleEngineTypeChange(type)} className="w-4 h-4 m-0 cursor-pointer accent-orange-500" />
                      <span>{type === "aivis" ? "AivisSpeech" : type === "voicevox" ? "VOICEVOX" : "カスタム"}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <input type="text" value={engineType === "custom" ? customPath : defaultEnginePath}
                    onChange={(e) => setCustomPath(e.target.value)} disabled={engineType !== "custom"}
                    placeholder={engineType === "custom" ? "カスタムエンジンパスを入力" : ""}
                    className={`flex-1 ${inputCls} font-mono disabled:bg-stone-100 dark:disabled:bg-zinc-700 disabled:text-stone-400 disabled:cursor-not-allowed`} />
                  {engineType === "custom" && (
                    <button type="button" onClick={() => restartEngine("custom", customPath.trim())}
                      className="btn-gradient px-5 py-2 rounded-full text-sm font-medium whitespace-nowrap" disabled={loadingSpeakers}>
                      確定
                    </button>
                  )}
                </div>
                {error && <p className="text-sm text-danger m-0">{error}</p>}
              </section>

              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>音声スタイル・音量</h2>
                {loadingSpeakers ? (
                  <select disabled className="px-3 py-2 border border-stone-200 dark:border-zinc-600 rounded-xl text-sm bg-stone-100 dark:bg-zinc-700 text-stone-400 w-full"><option>読み込み中...</option></select>
                ) : speakers.length > 0 ? (
                  <select value={speakerId} onChange={(e) => handleSpeakerChange(Number(e.target.value))}
                    className={`w-full ${inputCls}`}>
                    {speakers.map((s) => <option key={s.id} value={s.id}>{s.speakerName} - {s.name}</option>)}
                  </select>
                ) : (
                  <p className={`text-sm m-0 ${mutedCls}`}>エンジンが実行されていますか?</p>
                )}
                <label htmlFor="volume-scale" className={labelCls}>音量: {volumeScale.toFixed(2)}</label>
                <input type="range" id="volume-scale" min="0" max="2" step="0.01" value={volumeScale}
                  onChange={(e) => onVolumeScaleChange(parseFloat(e.target.value))}
                  onMouseUp={handleVolumeChangeComplete} onTouchEnd={handleVolumeChangeComplete}
                  className="w-full cursor-pointer" />
                <button type="button" onClick={handleTestSpeech} disabled={isPlayingTest || speakers.length === 0}
                  className="btn-gradient px-5 py-2 rounded-full text-sm font-medium w-fit">
                  {isPlayingTest ? "再生中..." : "テスト音声を再生"}
                </button>
                {testAudioError && <p className="text-sm text-danger m-0">{testAudioError}</p>}
              </section>

              <section className={`${sectionCls} space-y-5`}>
                <h2 className={sectionHeadingCls}>発話フレーズ</h2>
                {PHRASE_EMOTIONS.map(({ key, label }) => {
                  const isCustom = customPhrases[key] !== undefined;
                  const defaultPhrases = NOTIFICATION_PHRASES[key as keyof typeof NOTIFICATION_PHRASES] ?? [];
                  const phrases = isCustom ? customPhrases[key] : defaultPhrases;
                  const inputVal = newPhraseInputs[key] ?? "";
                  const addPhrase = () => {
                    if (!inputVal.trim()) return;
                    const base = isCustom ? customPhrases[key] : [...defaultPhrases];
                    saveCustomPhrases({ ...customPhrases, [key]: [...base, inputVal.trim()] });
                    setNewPhraseInputs((prev) => ({ ...prev, [key]: "" }));
                  };
                  return (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-stone-700 dark:text-zinc-200">{label}</span>
                        {isCustom ? (
                          <button type="button" onClick={() => { const u = { ...customPhrases }; delete u[key]; saveCustomPhrases(u); }} className={`text-xs underline ${mutedCls} hover:text-stone-600 dark:hover:text-zinc-300`}>デフォルトに戻す</button>
                        ) : <span className={`text-xs ${mutedCls}`}>デフォルト</span>}
                      </div>
                      <div className="space-y-1">
                        {phrases.map((phrase, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className={`flex-1 text-sm px-2 py-1 rounded-lg ${isCustom ? "bg-white dark:bg-zinc-700 border border-stone-200 dark:border-zinc-600 text-stone-800 dark:text-zinc-100" : "bg-stone-100 dark:bg-zinc-700 text-stone-500 dark:text-zinc-400"}`}>{phrase}</span>
                            {isCustom && (
                              <button type="button" onClick={() => saveCustomPhrases({ ...customPhrases, [key]: customPhrases[key].filter((_, i) => i !== idx) })}
                                className="w-6 h-6 flex items-center justify-center rounded-full text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors text-sm leading-none">×</button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input type="text" value={inputVal} onChange={(e) => setNewPhraseInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") addPhrase(); }} placeholder="フレーズを追加..."
                          className={`flex-1 ${inputCls} py-1.5 focus:border-orange-400 focus:ring-orange-400/20`} />
                        <button type="button" onClick={addPhrase} className="px-3 py-1.5 rounded-xl text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors">追加</button>
                      </div>
                    </div>
                  );
                })}
              </section>
            </>
          )}

          {/* ── 監視 tab ── */}
          {activeTab === "monitor" && (
            <>
              {/* Claude Code カード */}
              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>Claude Code</h2>
                {activeSession ? (
                  <div className="rounded-xl bg-orange-50 dark:bg-orange-900/20 p-3 border border-orange-200 dark:border-orange-700/50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-orange-800 dark:text-orange-300 m-0">特定セッションのみ発話中</p>
                        <p className="text-xs text-orange-600 dark:text-orange-400 m-0 mt-0.5 font-mono truncate">{activeSession}</p>
                      </div>
                      <button type="button" onClick={async () => { await window.electron?.clearActiveSession?.(); setActiveSession(null); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-100 dark:bg-orange-800/50 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-700/50 transition-colors whitespace-nowrap">解除</button>
                    </div>
                  </div>
                ) : (
                  <p className={`text-xs m-0 ${mutedCls}`}>自動検出中</p>
                )}
                <div className="space-y-2">
                  <label htmlFor="watch-path" className={labelCls}>監視フォルダ</label>
                  <input type="text" id="watch-path" value={watchPath} onChange={(e) => setWatchPath(e.target.value)}
                    placeholder="空欄: デフォルト (~/.claude/projects)"
                    className={`w-full ${inputCls} font-mono`} />
                  <button type="button" onClick={async () => { await window.electron?.setWatchPath?.(watchPath); }}
                    className={applyBtnCls}>適用</button>
                  <p className={`text-xs m-0 ${mutedCls}`}>WSL環境: \\wsl$\Ubuntu\home\username\.claude\projects のように入力してください。</p>
                </div>
              </section>

              {/* Codex カード */}
              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>Codex</h2>
                {activeCodexFile ? (
                  <div className="rounded-xl bg-orange-50 dark:bg-orange-900/20 p-3 border border-orange-200 dark:border-orange-700/50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-orange-800 dark:text-orange-300 m-0">監視中のログファイル</p>
                        <p className="text-xs text-orange-600 dark:text-orange-400 m-0 mt-0.5 font-mono truncate" title={activeCodexFile}>
                          {activeCodexFile.split(/[\\/]/).pop()}
                        </p>
                      </div>
                      <button type="button" onClick={async () => { await window.electron?.clearCodexActiveFile?.(); setActiveCodexFile(null); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-100 dark:bg-orange-800/50 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-700/50 transition-colors whitespace-nowrap">リセット</button>
                    </div>
                  </div>
                ) : (
                  <p className={`text-xs m-0 ${mutedCls}`}>自動検出中</p>
                )}
                <div className="space-y-2">
                  <label htmlFor="codex-watch-path" className={labelCls}>監視フォルダ</label>
                  <input type="text" id="codex-watch-path" value={codexWatchPath} onChange={(e) => setCodexWatchPath(e.target.value)}
                    placeholder="空欄: デフォルト (~/.codex/sessions)"
                    className={`w-full ${inputCls} font-mono`} />
                  <button type="button" onClick={async () => { await window.electron?.setCodexWatchPath?.(codexWatchPath); }}
                    className={applyBtnCls}>適用</button>
                </div>
              </section>
            </>
          )}

          {/* ── その他 tab ── */}
          {activeTab === "misc" && (
            <>
              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>カラーモード</h2>
                <div className="flex gap-2">
                  {([
                    { value: "light", label: "ライト" },
                    { value: "dark",  label: "ダーク" },
                  ] as { value: ColorMode; label: string }[]).map(({ value, label }) => (
                    <button key={value} type="button" onClick={() => handleColorModeChange(value)}
                      className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition-all ${colorMode === value ? selectedBtnCls : unselectedBtnCls}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>Webhook通知</h2>
                <p className={`text-xs m-0 ${mutedCls}`}>完了・確認の通知を外部サービスに送信します。いずれかのサービスで有効にしている場合、アプリ側の通知はされません。</p>
                <div className="flex flex-col gap-1">
                  {WEBHOOK_SERVICE_OPTIONS.map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-2 cursor-pointer text-sm text-stone-800 dark:text-zinc-100 p-1">
                      <input type="radio" name="webhookService" value={value} checked={webhookService === value}
                        onChange={() => onWebhookServiceChange(value)}
                        className="w-4 h-4 m-0 cursor-pointer accent-orange-500" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {webhookService !== "none" && (
                  <div className="space-y-2">
                    <label className={labelCls}>Webhook URL</label>
                    <div className="flex gap-2">
                      <input type="text" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://hooks.slack.com/services/..."
                        className={`flex-1 ${inputCls} font-mono`} />
                      <button type="button" onClick={() => window.electron?.setWebhookUrl?.(webhookUrl)}
                        className="px-4 py-2 rounded-full text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors whitespace-nowrap">適用</button>
                    </div>
                  </div>
                )}
              </section>

              <section className={`${sectionCls} space-y-4`}>
                <h2 className={sectionHeadingCls}>高度な設定</h2>
                {micMonitorAvailable && (
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-stone-800 dark:text-zinc-100">
                    <input type="checkbox" checked={muteOnMicActive} onChange={(e) => onMuteOnMicActiveChange(e.target.checked)} className="w-4 h-4 m-0 cursor-pointer accent-orange-500" />
                    <span>マイク使用中はミュートにする</span>
                  </label>
                )}
                <label className="flex items-center gap-2 cursor-pointer text-sm text-stone-800 dark:text-zinc-100">
                  <input type="checkbox" checked={includeSubAgents} onChange={(e) => { setIncludeSubAgents(e.target.checked); window.electron?.setIncludeSubAgents?.(e.target.checked); }} className="w-4 h-4 m-0 cursor-pointer accent-orange-500" />
                  <span>サブエージェントの発言も含める</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-stone-800 dark:text-zinc-100">
                  <input type="checkbox" checked={autoUpdateCheck} onChange={(e) => { setAutoUpdateCheck(e.target.checked); window.electron?.setAutoUpdateCheck?.(e.target.checked); }} className="w-4 h-4 m-0 cursor-pointer accent-orange-500" />
                  <span>起動時にアップデートを確認する</span>
                </label>
              </section>

              <section className={`${sectionCls} space-y-3`}>
                <h2 className={sectionHeadingCls}>リセット</h2>
                <button type="button" onClick={handleReset}
                  className="px-4 py-2 rounded-xl text-sm font-medium border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 hover:border-red-300 transition-all w-fit">すべての設定をリセット</button>
              </section>

              <section className={`${sectionCls} space-y-3`}>
                <h2 className={sectionHeadingCls}>デベロッパー</h2>
                <button type="button" onClick={() => window.electron?.openDevTools?.()} className={`${whiteBtnCls} w-fit`}>DevTools を開く</button>
                <p className={`text-sm m-0 ${mutedCls}`}>ショートカット: {navigator.userAgent.includes("Mac") ? "⌘ Command + ⌥ Option + I" : "Ctrl + Shift + I"}</p>
              </section>
            </>
          )}
        </div>
    </div>
  );
}
