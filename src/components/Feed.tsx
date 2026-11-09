"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FeedSession } from "@/lib/feed";
import { GenerationClient } from "@/services/articles";
import { SiteHeader } from "./SiteHeader";
import { TopicPath } from "./TopicPath";
import { FeedStatus } from "./FeedStatus";

export function Feed() {
  const [session] = useState(() => new FeedSession(new GenerationClient()));
  const { entries, error } = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    void session.ensure(active);
  }, [session, active]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  const trackPosition = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const root = container.current;
      if (!root) return;
      // Keep a long article active through its footer, until the next slide reaches the top.
      const line = root.getBoundingClientRect().top + 1;
      const slides = root.querySelectorAll<HTMLElement>("[data-index]");
      // Only measure a few slides, even after a long reading session.
      let start = 0;
      let end = slides.length - 1;
      while (start < end) {
        const middle = Math.floor((start + end) / 2);
        if (slides[middle].getBoundingClientRect().bottom > line) end = middle;
        else start = middle + 1;
      }
      if (slides[start]) setActive(Number(slides[start].dataset.index));
    });
  }, []);

  function navigate(index: number) {
    const root = container.current;
    const slide = root?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!root || !slide) return;
    const top = root.scrollTop + slide.getBoundingClientRect().top - root.getBoundingClientRect().top;
    root.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    slide.focus({ preventScroll: true });
  }

  return (
    <div className="experience">
      <SiteHeader index={active} />
      <main id="main" ref={container} className="feed" onScroll={trackPosition} tabIndex={-1} aria-label="Feed Computer Science">
        {/* Keep each snap target mounted when its loading state becomes an article. */}
        {Array.from({ length: entries.length + 1 }, (_, index) => {
          const entry = entries[index];
          if (!entry)
            return (
              <article
                className="feed-slide status-slide"
                data-index={index}
                data-ready="false"
                key={index}
                tabIndex={-1}
                aria-label={error ? "Bacaan gagal dimuat" : "Memuat bacaan"}
              >
                <div className="slide-inner">
                  <FeedStatus
                    key={`${index}-${error?.retryAt ?? "loading"}`}
                    error={error}
                    first={!entries.length}
                    retry={() => {
                      void session.retry(active);
                    }}
                  />
                  {index > 0 && (
                    <button className="text-link status-back" onClick={() => navigate(index - 1)}>
                      Kembali ke bacaan sebelumnya
                    </button>
                  )}
                </div>
              </article>
            );
          const { topic, content } = entry;
          return (
            <article className="feed-slide" data-index={index} data-ready="true" key={index} tabIndex={-1} aria-labelledby={`title-${topic.id}`}>
              <div className="slide-inner" key={topic.id}>
                <TopicPath topic={topic} />
                <header className="article-heading">
                  <h1 id={`title-${topic.id}`}>{topic.title}</h1>
                  <p>{topic.description}</p>
                </header>
                <div className="article-prose">
                  {content.explanation.map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                  <section className="importance">
                    <h2>Mengapa ini penting</h2>
                    <p>{content.importance}</p>
                  </section>
                </div>
                <footer className="article-footer">
                  <details className="ai-disclosure">
                    <summary>Dibuat dengan AI</summary>
                    <p>Bacaan dibuat oleh Gemini tanpa penelusuran web. Periksa kembali detail teknis sebelum menerapkannya.</p>
                  </details>
                  <nav className="reading-controls" aria-label={`Navigasi bacaan ${index + 1}`}>
                    <button className="previous-button" aria-label="Artikel sebelumnya" disabled={index === 0} onClick={() => navigate(index - 1)}>
                      <Arrow up />
                    </button>
                    <button className="next-button" aria-label="Artikel berikutnya" onClick={() => navigate(index + 1)}>
                      <span>Lanjut membaca</span>
                      <Arrow />
                    </button>
                  </nav>
                </footer>
              </div>
            </article>
          );
        })}
      </main>
    </div>
  );
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg className={up ? "arrow-icon arrow-up" : "arrow-icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M12 4v16m-6-6 6 6 6-6" />
    </svg>
  );
}
