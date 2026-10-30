"use client";
import { useEffect, useRef } from "react";
type TelegramUI = {
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(fn: () => void): void;
    offClick(fn: () => void): void;
  };
  onEvent?: (name: string, fn: () => void) => void;
  offEvent?: (name: string, fn: () => void) => void;
  viewportStableHeight?: number;
  contentSafeAreaInset?: { top: number; bottom: number };
  safeAreaInset?: { top: number; bottom: number };
};
export function useTelegramNavigation(
  tab: string,
  modal: boolean,
  back: () => void,
  sdkReady: boolean,
) {
  const handler = useRef(back);
  handler.current = back;
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp as TelegramUI | undefined;
    const viewport = window.visualViewport;
    const sync = () => {
      const height =
        viewport?.height || tg?.viewportStableHeight || window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${height}px`);
      document.documentElement.style.setProperty(
        "--tg-top",
        `${tg?.contentSafeAreaInset?.top || 0}px`,
      );
      document.documentElement.style.setProperty(
        "--tg-bottom",
        `${Math.max(tg?.contentSafeAreaInset?.bottom || 0, tg?.safeAreaInset?.bottom || 0)}px`,
      );
      document.documentElement.dataset.keyboard =
        window.innerHeight - height > 140 ? "open" : "closed";
    };
    sync();
    viewport?.addEventListener("resize", sync);
    window.addEventListener("resize", sync);
    tg?.onEvent?.("safeAreaChanged", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      window.removeEventListener("resize", sync);
      tg?.offEvent?.("safeAreaChanged", sync);
    };
  }, [sdkReady]);
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp as TelegramUI | undefined;
    const fn = () => handler.current();
    if (modal || tab !== "activities") tg?.BackButton?.show();
    else tg?.BackButton?.hide();
    tg?.BackButton?.onClick(fn);
    return () => tg?.BackButton?.offClick(fn);
  }, [tab, modal, sdkReady]);
}
