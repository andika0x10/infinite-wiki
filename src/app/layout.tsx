import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import "./globals.css";

const plexSerif = IBM_Plex_Serif({ variable: "--font-plex-serif", subsets: ["latin"], display: "swap", weight: ["400", "500"], style: ["normal", "italic"] });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], display: "swap", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Infinite Wiki — Computer Science",
  description: "Jelajahi Computer Science, satu bacaan setiap kali. Cabang pengetahuan dan artikel berbahasa Indonesia dibuat dengan Gemini saat Anda membaca.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${plexSerif.variable} ${plexSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
