"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="message-page">
        <h1>Halaman belum dapat ditampilkan.</h1>
        <p>Coba muat kembali halaman ini untuk melanjutkan bacaan.</p>
        <div className="message-actions">
          <button className="primary-button" onClick={reset}>
            Coba lagi
          </button>
          <Link className="text-link" href="/">
            Kembali membaca
          </Link>
        </div>
      </main>
    </>
  );
}
