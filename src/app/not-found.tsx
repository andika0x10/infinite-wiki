import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="message-page">
        <span className="error-code">404</span>
        <h1>Halaman tidak ditemukan.</h1>
        <p>Penjelajahan Computer Science berlanjut di beranda.</p>
        <Link className="primary-button" href="/">
          Kembali membaca
        </Link>
      </main>
    </>
  );
}
