# Infinite Wiki

Feed Computer Science berbahasa Indonesia. Gemini membuat cabang pengetahuan dari Computer science, lalu menghasilkan artikel dari cabang tersebut. Scroll atau swipe untuk melanjutkan, satu artikel per layar. Tidak ada batas katalog atau kedalaman cabang yang ditentukan aplikasi.

Desain putih dengan aksen hitam, IBM Plex Sans untuk antarmuka dan IBM Plex Serif untuk bacaan. Jejak cabang menunjukkan asal tiap artikel; jalur panjang dapat dibuka melalui “Lihat jalur”.

## Pengembangan lokal

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
```

Isi `GEMINI_API_KEY` di `.dev.vars`, kemudian:

```powershell
npm run cf-typegen
npm run dev
```

Buka http://localhost:3000. API key hanya dibaca di server melalui binding Cloudflare; jangan memakai prefix `NEXT_PUBLIC_` atau memasukkan secret ke Git.

## Alur generasi

1. Rencanakan empat cabang dari akar Computer science.
2. Buat artikel pengantar, lalu artikel dari antrean topik berdasarkan urutan penemuan.
3. Saat antrean tersisa dua topik, perluas induk berikutnya dengan empat cabang baru.
4. Muat satu artikel di depan posisi pembaca. Semua request generasi berjalan berurutan.

Judul dinormalisasi dan dideduplikasi sepanjang sesi. Dua ekspansi tanpa cabang baru menampilkan retry manual. Kegagalan generasi tidak menghapus artikel sebelumnya. Respons sukses disimpan di memori; refresh memulai sesi baru. Tidak ada database atau penyimpanan lintas pengunjung. Konteks API memakai akar dan bagian akhir jalur (maksimal 16 judul), tanpa membatasi kedalaman jalur dalam sesi.

## API

Kedua endpoint menerima `topic`: `{ id, title, description, parentId, path }`. `path` dimulai dengan `Computer science` dan berakhir dengan judul topik. Akar menggunakan ID `computer-science` dan `parentId: null`; topik anak membawa ID induknya.

- `POST /api/branches`: `{ topic, exclude?: string[] }` → `{ branches: [{ title, description }] }`, tepat empat cabang. Daftar pengecualian maksimal 50 judul terakhir; klien tetap mendeteksi duplikat dari seluruh sesi.
- `POST /api/articles`: `{ topic }` → `{ explanation: string[], importance: string }`, 2–4 paragraf penjelasan dan satu paragraf relevansi; target 200–300 kata.

Input dibatasi 24 KB, judul 160 karakter, deskripsi 500 karakter; respons diperiksa di server dan klien. Model tetap `gemini-3.5-flash-lite`, structured JSON output dan timeout server 30 detik. Konten dibuat tanpa penelusuran web dan tidak terverifikasi.

Error: `{ error: { code, message, retryAfter? } }`. Kode: `INVALID_TOPIC`, `NOT_CONFIGURED`, `RATE_LIMITED`, `TIMEOUT`, `INVALID_RESPONSE`, `UPSTREAM_ERROR`. Cooldown 429 berlaku lintas endpoint pada sesi yang sama, dengan retry manual. `EMPTY_BRANCHES` adalah kegagalan lokal ketika dua ekspansi tidak menghasilkan topik unik.

`/` adalah feed; `/artikel/[slug]` lama mengarahkan ke `/`. URL lain menampilkan 404. Tidak ada pencarian, kategori tetap, atau pemilihan cabang manual.

## Pemeriksaan

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit test memeriksa generator, kontrak, antrean, deduplikasi, cache, serialisasi request, dan cooldown. Browser test memeriksa desktop/mobile, lebih dari 32 topik, jalur, artikel panjang, loading, error, retry, keyboard, redirect, dan validasi API. API dimock agar tidak memakai kuota Gemini. Screenshot ada di `test-results/`.

## Cloudflare

Proyek mempertahankan Next.js 16, React 19 dan OpenNext Cloudflare. Build memakai Webpack untuk kompatibilitas preview Windows. `npm run preview` menjalankan preview lokal. Deployment memakai alur yang sudah ada (`npm run deploy`); secret produksi `GEMINI_API_KEY` harus disiapkan pada Worker oleh pengelola. Secret lokal tidak otomatis diunggah.

Tidak ada cache bersama atau pembatasan request terdistribusi. Kelanjutan feed bergantung pada ketersediaan dan kuota Gemini.
