import { useRef, useCallback, useState, useEffect } from "react";
import type { Emotion } from "../types/emotion";
import { NOTIFICATION_EMOTIONS, getRandomPhrase, type CustomPhrases } from "../constants/notificationPhrases";

const CONSECUTIVE_WINDOW_MS = 30_000;
const AUTO_DISMISS_MS = 8_000;
const POPUP_SHOW_DELAY_MS = 300;

export type PopupState = "hidden" | "entering" | "visible" | "exiting";

interface PendingNotification {
  emotion: Emotion;
  phrase: string;
  shouldSpeak: boolean;
}

interface UseNotificationPopupOptions {
  onTrigger: (phrase: string, emotion: Emotion) => void;
  onWebhookNotify?: (phrase: string, emotion: Emotion) => void;
  webhookEnabled?: boolean;
  showPopup: boolean;
  playSpeech: boolean;
  customPhrases?: CustomPhrases | null;
}

export function useNotificationPopup({ onTrigger, onWebhookNotify, webhookEnabled = false, showPopup, playSpeech, customPhrases }: UseNotificationPopupOptions) {
  const [popupState, setPopupState] = useState<PopupState>("hidden");
  const cooldownMap = useRef<Map<Emotion, number>>(new Map());
  const pendingRef = useRef<PendingNotification | null>(null);
  const isActiveRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerPopupRef = useRef<((emotion: Emotion, phrase: string, shouldSpeak: boolean) => void) | null>(null);
  const showPopupRef = useRef(showPopup);
  const playSpeechRef = useRef(playSpeech);
  useEffect(() => { showPopupRef.current = showPopup; }, [showPopup]);
  useEffect(() => { playSpeechRef.current = playSpeech; }, [playSpeech]);

  const dismiss = useCallback(() => {
    if (popupDelayTimerRef.current) { clearTimeout(popupDelayTimerRef.current); popupDelayTimerRef.current = null; }
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setPopupState("exiting");
    dismissTimerRef.current = setTimeout(() => {
      setPopupState("hidden");
      isActiveRef.current = false;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) {
        triggerPopupRef.current?.(next.emotion, next.phrase, next.shouldSpeak);
      }
    }, 600);
  }, []);

  const triggerPopup = useCallback(
    (emotion: Emotion, phrase: string, shouldSpeak: boolean) => {
      isActiveRef.current = true;
      cooldownMap.current.set(emotion, Date.now());
      if (playSpeechRef.current && shouldSpeak) {
        onTrigger(phrase, emotion);
      }
      onWebhookNotify?.(phrase, emotion);
      if (showPopupRef.current) {
        popupDelayTimerRef.current = setTimeout(() => {
          popupDelayTimerRef.current = null;
          setPopupState("entering");
          setTimeout(() => setPopupState("visible"), 600);
        }, POPUP_SHOW_DELAY_MS);
      }
      autoDismissTimerRef.current = setTimeout(() => {
        autoDismissTimerRef.current = null;
        dismiss();
      }, AUTO_DISMISS_MS);
    },
    [onTrigger, onWebhookNotify, dismiss],
  );

  useEffect(() => { triggerPopupRef.current = triggerPopup; }, [triggerPopup]);

  const enqueue = useCallback(
    (emotion: Emotion) => {
      if (!showPopup && !playSpeech && !webhookEnabled) return;
      if (!NOTIFICATION_EMOTIONS.has(emotion)) return;

      const lastFired = cooldownMap.current.get(emotion) ?? 0;
      const isConsecutive = Date.now() - lastFired < CONSECUTIVE_WINDOW_MS;
      const shouldSpeak = emotion === "happy" || !isConsecutive;
      if (isConsecutive && !shouldSpeak) {
        console.log(`[Popup] Consecutive fire for ${emotion}, popup only (no speech)`);
      }

      const phrase = getRandomPhrase(emotion, customPhrases ?? undefined);
      if (!phrase) return;

      if (isActiveRef.current) {
        pendingRef.current = { emotion, phrase, shouldSpeak };
        console.log(`[Popup] Active, queuing ${emotion}`);
        return;
      }

      triggerPopup(emotion, phrase, shouldSpeak);
    },
    [showPopup, playSpeech, webhookEnabled, triggerPopup, customPhrases],
  );

  return { popupState, enqueue, dismiss };
}
