"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="empty">
      <h2>Что-то пошло не так</h2>
      <p>Попробуй открыть экран ещё раз.</p>
      <button className="btn" onClick={reset}>
        Повторить
      </button>
    </div>
  );
}
