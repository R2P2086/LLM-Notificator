import type { Emotion } from "../types/emotion";

export const NOTIFICATION_PHRASES: Partial<Record<Emotion, string[]>> = {
  happy: ["終わったよ！", "できたよ", "完了したよ"],
  relaxed: ["確認してね", "ちょっと見てほしいな", "どうする？"],
  surprised: ["コマンド実行！", "いくよ！", "やってみる！"],
};

export const NOTIFICATION_EMOTIONS: ReadonlySet<Emotion> = new Set(["happy", "relaxed", "surprised"]);

export type CustomPhrases = Partial<Record<string, string[]>>;

export function getRandomPhrase(emotion: Emotion, custom?: CustomPhrases): string | null {
  const customList = custom?.[emotion];
  const phrases = customList && customList.length > 0 ? customList : NOTIFICATION_PHRASES[emotion];
  if (!phrases || phrases.length === 0) return null;
  return phrases[Math.floor(Math.random() * phrases.length)];
}
