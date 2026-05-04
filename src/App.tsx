// Modified from the original cc-mascot project by kazakago.
// Original: https://github.com/kazakago/cc-mascot (Apache License 2.0)
import { useRef, useCallback, useState, useEffect } from "react";
import SettingsPanel from "./components/SettingsPanel";
import CharacterPopup, { computePopupRect } from "./components/CharacterPopup";
import { useSpeech } from "./hooks/useSpeech";
import { useNotificationPopup } from "./hooks/useNotificationPopup";
import { loadImageFile, createImageBlobURL, deleteImageFile } from "./utils/imageStorage";
import type { Emotion } from "./types/emotion";
import type { CustomPhrases } from "./constants/notificationPhrases";
import type { PopupPosition, PopupAnimation, PopupDirection, NotificationMode } from "./types/popup";

const DEFAULT_IMAGE_URL = "./notification-default.png";
const VOICEVOX_BASE_URL = "http://localhost:8564";

function App() {
  const [speakerId, setSpeakerId] = useState(888753760);
  const [volumeScale, setVolumeScale] = useState(1.0);
  const [imageUrl, setImageUrl] = useState<string>(DEFAULT_IMAGE_URL);
  const [containerSize, setContainerSize] = useState(200);
  const [isInitialized, setIsInitialized] = useState(false);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customPhrases, setCustomPhrases] = useState<CustomPhrases | null>(null);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>("bottom-right");
  const [popupAnimation, setPopupAnimation] = useState<PopupAnimation>("slide");
  const [popupDirection, setPopupDirection] = useState<PopupDirection>("primary");
  const [notificationMode, setNotificationMode] = useState<NotificationMode>("both");
  const [webhookService, setWebhookService] = useState<string>("none");

  const showSettingsRef = useRef(false);
  const containerSizeRef = useRef(containerSize);
  const screenSizeRef = useRef({ width: window.innerWidth || 1920, height: window.innerHeight || 1080 });
  const popupPositionRef = useRef(popupPosition);
  const popupStateActiveRef = useRef(false);

  useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);
  useEffect(() => { containerSizeRef.current = containerSize; }, [containerSize]);
  useEffect(() => { popupPositionRef.current = popupPosition; }, [popupPosition]);

  // Initialize character size from Electron Store
  useEffect(() => {
    const init = async () => {
      const electron = window.electron;
      if (!electron?.getCharacterSize) {
        setIsInitialized(true);
        return;
      }
      const savedSize = await electron.getCharacterSize();
      const size = savedSize || 200;
      setContainerSize(size);
      containerSizeRef.current = size;
      setIsInitialized(true);
    };
    init();
  }, []);

  // Load popup appearance settings
  useEffect(() => {
    window.electron?.getPopupPosition?.().then((v) => { if (v) { setPopupPosition(v as PopupPosition); popupPositionRef.current = v as PopupPosition; } });
    window.electron?.getPopupAnimation?.().then((v) => { if (v) setPopupAnimation(v as PopupAnimation); });
    window.electron?.getPopupDirection?.().then((v) => { if (v) setPopupDirection(v as PopupDirection); });
    window.electron?.getNotificationMode?.().then((v) => { if (v) setNotificationMode(v as NotificationMode); });
    window.electron?.getWebhookService?.().then((v) => { if (v) setWebhookService(v); });
  }, []);

  // Load custom image from IndexedDB
  useEffect(() => {
    loadImageFile()
      .then((file) => { if (file) setImageUrl(createImageBlobURL(file)); })
      .catch((err) => console.error("[App] Failed to load image:", err));
  }, []);

  // Load speaker and volume settings
  useEffect(() => {
    window.electron?.getSpeakerId?.().then(setSpeakerId);
    window.electron?.getVolumeScale?.().then(setVolumeScale);
  }, []);

  // Load custom phrases
  useEffect(() => {
    window.electron?.getNotificationPhrases?.().then(setCustomPhrases);
  }, []);

  // Tray events
  useEffect(() => {
    const cleanup = window.electron?.onNotificationModeChanged?.((mode) => setNotificationMode(mode as NotificationMode));
    return () => cleanup?.();
  }, []);
  useEffect(() => {
    const cleanup = window.electron?.onToggleSettingsPanel?.(() => setShowSettings((prev) => !prev));
    return () => cleanup?.();
  }, []);
  useEffect(() => {
    if (showSettings) window.electron?.setIgnoreMouseEvents(false);
  }, [showSettings]);

  const dismissRef = useRef<(() => void) | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSpeechStart = useCallback((_analyser: AnalyserNode, _emotion: Emotion) => {}, []);

  const handleSpeechEnd = useCallback(() => {
    dismissRef.current?.();
  }, []);

  const { speakText } = useSpeech({
    onStart: handleSpeechStart,
    onEnd: handleSpeechEnd,
    speakerId,
    baseUrl: VOICEVOX_BASE_URL,
    volumeScale,
  });

  const webhookEnabled = webhookService !== "none";
  const showPopup = !webhookEnabled && notificationMode !== "audio";
  const playSpeech = !webhookEnabled && notificationMode !== "visual";

  const handleWebhookNotify = useCallback((phrase: string, emotion: Emotion) => {
    window.electron?.sendWebhookNotification?.(phrase, emotion);
  }, []);

  const { popupState, enqueue, dismiss } = useNotificationPopup({
    onTrigger: (phrase, emotion) => speakText(phrase, emotion),
    onWebhookNotify: handleWebhookNotify,
    webhookEnabled,
    showPopup,
    playSpeech,
    customPhrases,
  });

  useEffect(() => { dismissRef.current = dismiss; }, [dismiss]);

  // Track whether popup is active for hit detection
  useEffect(() => {
    popupStateActiveRef.current = popupState !== "hidden";
  }, [popupState]);

  // Listen for speak messages from Electron
  useEffect(() => {
    if (!window.electron?.onSpeak) return;
    const cleanup = window.electron.onSpeak((message: string) => {
      try {
        const data = JSON.parse(message) as { type: string; text: string; emotion?: Emotion };
        if (data.type === "speak") {
          enqueue((data.emotion as Emotion) || "neutral");
        }
      } catch (err) {
        console.error("Failed to parse speak message:", err);
      }
    });
    return cleanup;
  }, [enqueue]);

  // Click-through: pass-through everywhere except popup area and settings panel
  useEffect(() => {
    const electron = window.electron;
    if (!electron?.setIgnoreMouseEvents) return;

    let lastInsideState: boolean | null = null;

    const isInsidePopup = (clientX: number, clientY: number) => {
      if (!showPopup) return false;
      if (!popupStateActiveRef.current) return false;
      const rect = computePopupRect(popupPositionRef.current, containerSizeRef.current, screenSizeRef.current);
      return clientX >= rect.x && clientX <= rect.x + rect.w && clientY >= rect.y && clientY <= rect.y + rect.h;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const isInside = isInsidePopup(e.clientX, e.clientY) || showSettingsRef.current;
      if (isInside !== lastInsideState) {
        lastInsideState = isInside;
        electron.setIgnoreMouseEvents(devToolsOpen ? false : !isInside);
      }
    };

    electron.setIgnoreMouseEvents(false);
    window.addEventListener("mousemove", handleMouseMove);

    const cleanupDevTools = electron.onDevToolsStateChanged?.((isOpen: boolean) => {
      setDevToolsOpen(isOpen);
      if (isOpen) electron.setIgnoreMouseEvents(false);
      else if (lastInsideState !== null) electron.setIgnoreMouseEvents(!lastInsideState);
    });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cleanupDevTools?.();
    };
  }, [devToolsOpen]);

  // Settings handlers
  const handleImageChange = useCallback(() => {
    loadImageFile()
      .then((file) => {
        if (file) setImageUrl(createImageBlobURL(file));
        else setImageUrl(DEFAULT_IMAGE_URL);
      })
      .catch((err) => console.error("[App] Failed to reload image:", err));
  }, []);

  const handleTestSpeech = useCallback(() => {
    speakText("こんにちは。お役に立てることはありますか？", "happy");
  }, [speakText]);

  const handleContainerSizeChange = useCallback((newSize: number) => {
    containerSizeRef.current = newSize;
    setContainerSize(newSize);
  }, []);

  const handlePopupPositionChange = useCallback(async (value: PopupPosition) => {
    setPopupPosition(value);
    popupPositionRef.current = value;
    await window.electron?.setPopupPosition?.(value);
  }, []);

  const handlePopupAnimationChange = useCallback(async (value: PopupAnimation) => {
    setPopupAnimation(value);
    await window.electron?.setPopupAnimation?.(value);
  }, []);

  const handlePopupDirectionChange = useCallback(async (value: PopupDirection) => {
    setPopupDirection(value);
    await window.electron?.setPopupDirection?.(value);
  }, []);

  const handleNotificationModeChange = useCallback(async (value: NotificationMode) => {
    setNotificationMode(value);
    await window.electron?.setNotificationMode?.(value);
  }, []);

  const handleWebhookServiceChange = useCallback(async (value: string) => {
    setWebhookService(value);
    await window.electron?.setWebhookService?.(value);
  }, []);

  const handleResetAllSettings = useCallback(async () => {
    try { await deleteImageFile(); } catch { /* ignore */ }
    await window.electron?.resetAllSettings?.();
    setImageUrl(DEFAULT_IMAGE_URL);
    setSpeakerId(888753760);
    setVolumeScale(1.0);
    setContainerSize(200);
    containerSizeRef.current = 200;
    setPopupPosition("bottom-right");
    setPopupAnimation("slide");
    setPopupDirection("primary");
    setNotificationMode("both");
    setWebhookService("none");
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden relative">
      {isInitialized && showPopup && (
        <CharacterPopup
          imageUrl={imageUrl}
          popupState={popupState}
          position={popupPosition}
          animation={popupAnimation}
          direction={popupDirection}
          size={containerSize}
        />
      )}

      {showSettings && (
        <SettingsPanel
          speakerId={speakerId}
          onSpeakerIdChange={setSpeakerId}
          volumeScale={volumeScale}
          onVolumeScaleChange={setVolumeScale}
          containerSize={containerSize}
          onContainerSizeChange={handleContainerSizeChange}
          onImageChange={handleImageChange}
          onTestSpeech={handleTestSpeech}
          popupPosition={popupPosition}
          onPopupPositionChange={handlePopupPositionChange}
          popupAnimation={popupAnimation}
          onPopupAnimationChange={handlePopupAnimationChange}
          popupDirection={popupDirection}
          onPopupDirectionChange={handlePopupDirectionChange}
          notificationMode={notificationMode}
          onNotificationModeChange={handleNotificationModeChange}
          webhookService={webhookService}
          onWebhookServiceChange={handleWebhookServiceChange}
          onResetAllSettings={handleResetAllSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
