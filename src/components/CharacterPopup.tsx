import type { PopupPosition, PopupAnimation, PopupDirection } from "../types/popup";
import { CORNER_POSITIONS } from "../types/popup";
import type { PopupState } from "../hooks/useNotificationPopup";

const POPUP_MARGIN = 20;
const SPRING = "600ms cubic-bezier(0.34, 1.56, 0.64, 1)";

interface Props {
  imageUrl: string;
  popupState: PopupState;
  position: PopupPosition;
  animation: PopupAnimation;
  direction: PopupDirection;
  size: number;
}

function getPositionStyle(position: PopupPosition): React.CSSProperties {
  const m = POPUP_MARGIN;
  switch (position) {
    case "bottom-center": return { bottom: m, left: 0, right: 0, display: "flex", justifyContent: "center" };
    case "bottom-right":  return { bottom: m, right: m };
    case "bottom-left":   return { bottom: m, left: m };
    case "top-center":    return { top: m, left: 0, right: 0, display: "flex", justifyContent: "center" };
    case "top-right":     return { top: m, right: m };
    case "top-left":      return { top: m, left: m };
    case "right-center":  return { right: m, top: 0, bottom: 0, display: "flex", alignItems: "center" };
    case "left-center":   return { left: m, top: 0, bottom: 0, display: "flex", alignItems: "center" };
  }
  // Unreachable but satisfies TS exhaustiveness
  return { bottom: m, right: m };
}

function getSlideOffset(position: PopupPosition, direction: PopupDirection): string {
  const offset = `calc(100% + ${POPUP_MARGIN * 2}px)`;
  const isCorner = CORNER_POSITIONS.has(position);
  const usePrimary = !isCorner || direction === "primary";

  switch (position) {
    case "bottom-center": return `translateY(${offset})`;
    case "top-center":    return `translateY(-${offset})`;
    case "right-center":  return `translateX(${offset})`;
    case "left-center":   return `translateX(-${offset})`;
    case "bottom-right":  return usePrimary ? `translateY(${offset})` : `translateX(${offset})`;
    case "bottom-left":   return usePrimary ? `translateY(${offset})` : `translateX(-${offset})`;
    case "top-right":     return usePrimary ? `translateY(-${offset})` : `translateX(${offset})`;
    case "top-left":      return usePrimary ? `translateY(-${offset})` : `translateX(-${offset})`;
  }
  return `translateY(${offset})`;
}

function getPopTransformOrigin(position: PopupPosition, direction: PopupDirection): string {
  const isCorner = CORNER_POSITIONS.has(position);
  const usePrimary = !isCorner || direction === "primary";

  switch (position) {
    case "bottom-center": return "center bottom";
    case "top-center":    return "center top";
    case "right-center":  return "right center";
    case "left-center":   return "left center";
    case "bottom-right":  return usePrimary ? "center bottom" : "right center";
    case "bottom-left":   return usePrimary ? "center bottom" : "left center";
    case "top-right":     return usePrimary ? "center top" : "right center";
    case "top-left":      return usePrimary ? "center top" : "left center";
  }
  return "center center";
}

function getAnimationStyle(
  animation: PopupAnimation,
  position: PopupPosition,
  direction: PopupDirection,
  state: PopupState,
): React.CSSProperties {
  const isHiddenPos = state === "hidden" || state === "exiting";
  const isMoving = state !== "hidden";

  switch (animation) {
    case "static":
      return { visibility: state === "hidden" ? "hidden" : "visible" };

    case "fade":
      return {
        opacity: isHiddenPos ? 0 : 1,
        transition: isMoving ? "opacity 400ms ease" : "none",
      };

    case "slide":
      return {
        transform: isHiddenPos ? getSlideOffset(position, direction) : "translate(0,0)",
        transition: isMoving ? `transform ${SPRING}` : "none",
      };

    case "pop":
      return {
        transform: isHiddenPos ? "scale(0)" : "scale(1)",
        opacity: isHiddenPos ? 0 : 1,
        transformOrigin: getPopTransformOrigin(position, direction),
        transition: isMoving
          ? `transform ${SPRING}, opacity 300ms ease`
          : "none",
      };
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function computePopupRect(
  position: PopupPosition,
  size: number,
  screen: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const m = POPUP_MARGIN;
  switch (position) {
    case "bottom-center": return { x: screen.width / 2 - size / 2, y: screen.height - size - m, w: size, h: size };
    case "bottom-right":  return { x: screen.width - size - m, y: screen.height - size - m, w: size, h: size };
    case "bottom-left":   return { x: m, y: screen.height - size - m, w: size, h: size };
    case "top-center":    return { x: screen.width / 2 - size / 2, y: m, w: size, h: size };
    case "top-right":     return { x: screen.width - size - m, y: m, w: size, h: size };
    case "top-left":      return { x: m, y: m, w: size, h: size };
    case "right-center":  return { x: screen.width - size - m, y: screen.height / 2 - size / 2, w: size, h: size };
    case "left-center":   return { x: m, y: screen.height / 2 - size / 2, w: size, h: size };
  }
}

export default function CharacterPopup({ imageUrl, popupState, position, animation, direction, size }: Props) {
  const wrapperStyle: React.CSSProperties = {
    position: "absolute",
    ...getPositionStyle(position),
    pointerEvents: popupState === "hidden" ? "none" : "auto",
    visibility: popupState === "hidden" ? "hidden" : "visible",
  };

  const innerStyle: React.CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    ...getAnimationStyle(animation, position, direction, popupState),
  };

  return (
    <div style={wrapperStyle}>
      <div style={innerStyle}>
        <img
          src={imageUrl}
          alt="notification character"
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          draggable={false}
        />
      </div>
    </div>
  );
}
