"use client";

import { useEffect, useState } from "react";
import type { FeedSnapshot } from "@/lib/feed";

export function FeedStatus({ error, first, retry }: { error: FeedSnapshot["error"]; first: boolean; retry: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const retryAt = error?.retryAt ?? 0;
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryAt) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [retryAt]);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  if (error)
    return (
      <div className="feed-error" role="alert">
        <p className="status-context">{first ? "Computer science" : "Lanjutkan penjelajahan"}</p>
        <h1>Bacaan belum tersedia.</h1>
        <p>{error.message}</p>
        <button className="primary-button" disabled={remaining > 0} onClick={retry}>
          {remaining > 0 ? `Coba lagi dalam ${remaining} detik` : "Coba lagi"}
        </button>
      </div>
    );
  return (
    <div className="feed-loading" role="status" aria-live="polite">
      <p className="status-context">{first ? "Computer science" : "Penjelajahan berlanjut"}</p>
      <p className="loading-message">{first ? "Menyiapkan bacaan pertama…" : "Menyiapkan bacaan berikutnya…"}</p>
      <div className="skeleton" aria-hidden="true">
        <div className="skeleton-title" />
        <div className="skeleton-description" />
        <div className="skeleton-paragraph">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="skeleton-paragraph">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}
