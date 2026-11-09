import Link from "next/link";

export function SiteHeader({ index }: { index?: number }) {
  return (
    <header className="site-header">
      <Link href="/" className="wordmark" aria-label="Infinite Wiki, beranda">
        <svg className="brand-symbol" viewBox="0 0 44 28" fill="none" aria-hidden="true">
          <path d="M22 14C17 5 14 4 10 4a10 10 0 0 0 0 20c4 0 7-1 12-10Zm0 0C27 5 30 4 34 4a10 10 0 0 1 0 20c-4 0-7-1-12-10Z" stroke="currentColor" strokeWidth="3" />
        </svg>
        Infinite Wiki
      </Link>
      {index !== undefined ? (
        <span className="reading-index" aria-label={`Bacaan ${index + 1}`} aria-live="polite">
          {String(index + 1).padStart(2, "0")}
        </span>
      ) : (
        <span className="site-caption">Computer science</span>
      )}
      <a href="#main" className="skip-link">
        Lewati ke konten
      </a>
    </header>
  );
}
