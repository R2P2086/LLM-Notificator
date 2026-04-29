export type PopupPosition =
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "top-right"
  | "top-left"
  | "right-center"
  | "left-center";

export type PopupAnimation = "static" | "fade" | "slide" | "pop";

// "primary" = 縦軸方向（上/下）。コーナー位置では縦軸を使う。
// "secondary" = 横軸方向（左/右）。コーナー位置のみ選択可能。
export type PopupDirection = "primary" | "secondary";

export const CORNER_POSITIONS = new Set<PopupPosition>([
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
]);

// "both"   = ポップアップ + 発話
// "visual" = ポップアップのみ（発話なし）
// "audio"  = 発話のみ（ポップアップなし）
export type NotificationMode = "both" | "visual" | "audio";
