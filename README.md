# Infinite Wiki

Feed Computer Science berbahasa Indonesia. Semua pengunjung membaca katalog dan urutan artikel yang sama. Artikel yang sudah tersimpan selalu diambil dari D1; Gemini hanya menambah katalog ketika pembaca mencapai ujungnya, dengan prefetch maksimal satu artikel.

Antarmuka tetap memakai satu artikel per layar, IBM Plex Sans/Serif, navigasi scroll dan tombol, serta jalur asal topik. Refresh kembali ke awal katalog tanpa membuat artikel ulang.

## Arsitektur cache bersama

- **D1 (`DB`)** menyimpan topik kanonis, alias, artikel, urutan feed, antrean cabang FIFO, status generasi, dan outbox pengindeksan. Cache tidak memiliki TTL.
- **Durable Object (`CATALOG`)** bernama `computer-science:v1` mengoordinasikan penambahan katalog. Request pada ujung yang sama bergabung ke satu pekerjaan. Pembacaan artikel langsung ke D1 dan tidak melewati DO.
- **Vectorize V2 (`SEMANTIC_INDEX`)** menyimpan embedding konsep dan isi dalam namespace `concepts-v1` dan `articles-v1`. Indeks menggunakan 768 dimensi dan cosine.
- **Gemini** tetap memakai `gemini-3.5-flash-lite` untuk cabang, artikel, dan keputusan kemiripan; embedding memakai `gemini-embedding-001` dengan `SEMANTIC_SIMILARITY` dan normalisasi vektor.

Artikel akar dibuat lebih dahulu. Saat perlu menambah artikel, server mengambil kandidat berikutnya; jika antrean kosong, induk berikutnya diperluas dengan empat cabang. ID dan jalur topik disimpan secara global, dengan konteks prompt dibatasi 16 judul tanpa membatasi kedalaman katalog.

Judul dan alias dinormalisasi. Constraint database mencegah nama, hash isi, posisi feed, serta publikasi pekerjaan ganda. Sebelum dan sesudah penulisan, sepuluh kandidat semantik terdekat diperiksa Gemini untuk membedakan sinonim/parafrasa dari konsep yang hanya berkaitan. Sinonim menjadi alias dan tidak muncul sebagai artikel kedua. Keputusan tidak pasti menghentikan penerbitan. Pemeriksaan semantik bersifat probabilistik; kemiripan tidak dapat dijamin terdeteksi sempurna.

Setiap tahap pekerjaan disimpan dalam SQLite DO. Alarm melanjutkan pekerjaan setelah restart. Artikel, posisi feed, dan outbox di-commit dalam satu transaksi D1; pengindeksan menggunakan ID vektor deterministik. Generasi berikutnya menunggu mutation Vectorize terkonfirmasi diproses. Indeks harus hanya ditulis oleh koordinator katalog ini.

Kegagalan provider mempertahankan draft dan artikel sebelumnya, dengan retry manual. Rate limit mempunyai cooldown global. Dua ekspansi tanpa kandidat atau tiga kandidat duplikat menghentikan pekerjaan agar tidak terus memakai kuota. Jika D1 gagal, aplikasi tidak beralih ke generasi tanpa cache.

## Pengembangan lokal

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
```

Isi `GEMINI_API_KEY` di `.dev.vars`. Key hanya digunakan di server dan harus mempunyai akses ke model penulisan serta embedding. Jangan memasukkannya ke Git atau variabel `NEXT_PUBLIC_`.

Vectorize tidak memiliki emulator lokal. Buat indeks development terpisah di akun Cloudflare:

```powershell
npx wrangler vectorize create infinite-wiki-semantic-dev-v1 --dimensions=768 --metric=cosine
npm run db:migrate:local
npm run cf-typegen
npm run dev:cloudflare
```

Perintah preview memakai environment `development`, D1/DO lokal yang persisten di `.wrangler`, dan indeks Vectorize development melalui remote binding. Setiap katalog lokal harus mempunyai indeks tersendiri; jika mengganti atau menghapus D1 lokal, buat indeks development baru dan sesuaikan `env.development.vectorize`. Jangan menghubungkan D1 lokal ke indeks produksi.

`npm run dev` tetap tersedia untuk Next.js dengan HMR dan akses binding development. Gunakan `npm run dev:cloudflare` untuk alur lengkap custom Worker, RPC DO, dan alarm dalam runtime Cloudflare. Pengujian otomatis tidak memerlukan akun atau kuota Gemini/Vectorize.

## API

`GET /api/feed?after=0&limit=2` hanya membaca katalog. `after` adalah integer aman nonnegatif; `limit` antara 1 dan 20.

```json
{
  "entries": [
    {
      "sequence": 1,
      "topic": { "id": "computer-science", "title": "Computer science", "description": "...", "parentId": null, "path": ["Computer science"] },
      "content": { "explanation": ["...", "..."], "importance": "..." }
    }
  ],
  "nextCursor": 1,
  "hasMore": false,
  "generation": { "state": "idle" }
}
```

`hasMore` menunjukkan masih ada artikel tersimpan sesudah halaman ini. `generation.state` adalah `idle`, `pending`, atau `failed`; pada kegagalan tersedia `error: { code, message, status, retryAt }`, dengan `retryAt` dalam epoch milidetik.

`POST /api/feed/extend` menerima `{ "after": 1 }`:

- Cursor di belakang ujung katalog: `200 { "status": "cached" }`.
- Cursor tepat di ujung: mulai atau bergabung ke pekerjaan, `202 { "status": "pending" }`.
- Cursor melampaui katalog: `409 INVALID_CURSOR`.

Browser membaca GET sebelum meminta penambahan, lalu melakukan polling dengan jeda 1–5 detik. Polling dibatalkan ketika feed dilepas. Endpoint lama `/api/articles` dan `/api/branches` telah dihapus.

Error HTTP: `{ "error": { "code": "...", "message": "...", "retryAfter": 60 } }`. `retryAfter` opsional dalam detik dan juga dikirim sebagai header `Retry-After`. Kode mencakup `INVALID_CURSOR`, `NOT_CONFIGURED`, `CACHE_UNAVAILABLE`, `DEDUPLICATION_UNAVAILABLE`, `RATE_LIMITED`, `TIMEOUT`, `INVALID_RESPONSE`, `UPSTREAM_ERROR`, dan `EMPTY_BRANCHES`. Body dibatasi 24 KB.

## Pengujian

```powershell
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit test memeriksa provider, embedding, keputusan kemiripan, hash, pembacaan cursor, prefetch, pembatalan polling, dan cooldown. Runtime test menjalankan D1 serta SQLite DO sungguhan dengan provider dan Vectorize pengganti lokal: request serentak, restart, alias, parafrasa, transaksi, outbox, keterlambatan indeks, dan kegagalan provider. Browser test memeriksa desktop/mobile, lebih dari 32 artikel, jalur panjang, navigasi, artikel panjang, loading, retry, dan validasi API.

Untuk memeriksa bundle produksi tanpa deployment:

```powershell
npx opennextjs-cloudflare build
npx wrangler deploy --dry-run --outdir .wrangler/deploy-dry-run
```

## Persiapan produksi

Produksi tersedia di https://infinite-wiki.andikadinata.workers.dev. D1 `infinite-wiki-cache` (APAC), indeks Vectorize `infinite-wiki-semantic-v1`, dan secret Worker `GEMINI_API_KEY` sudah disiapkan pada akun produksi. ID akun dan database tersimpan dalam `wrangler.jsonc`; nilai secret tidak disimpan di repositori.

Untuk deployment berikutnya pada akun ini, jalankan migrasi baru jika ada, lalu `npm run deploy`. Proyek mempertahankan Next.js 16, React 19, OpenNext, dan Wrangler 4.100.0. `custom-worker.ts` meneruskan handler OpenNext dan mengekspor `CatalogCoordinator`.

Langkah berikut hanya diperlukan untuk menyiapkan akun Cloudflare baru; sesuaikan `account_id` dan binding dengan akun tersebut:

1. Buat D1 `infinite-wiki-cache` menggunakan `npx wrangler d1 create infinite-wiki-cache`, lalu masukkan `database_id` hasilnya pada binding `DB` tingkat atas di `wrangler.jsonc`.
2. Buat indeks produksi menggunakan `npx wrangler vectorize create infinite-wiki-semantic-v1 --dimensions=768 --metric=cosine`.
3. Terapkan migrasi dengan `npx wrangler d1 migrations apply DB --remote`.
4. Siapkan secret produksi `GEMINI_API_KEY` pada Worker melalui pengelolaan secret Cloudflare. Secret lokal tidak otomatis diunggah.
5. Jalankan `npm run deploy`. Migrasi SQLite DO `v1-catalog` disertakan dalam konfigurasi. Katalog awal hanya memiliki metadata akar; artikel pertama dibuat saat diminta.

Sesudah deployment, buka dua sesi: ID, judul, isi, dan urutannya harus sama. Membaca artikel tersimpan tidak boleh menghasilkan event penulisan baru. Log terstruktur meliputi `feed_cache_read`, `generation_requested`, `article_published`, `duplicate_rejected`, dan `generation_failed`; Workers Logs dan Traces diaktifkan.

`/` tetap menjadi feed; `/artikel/[slug]` lama mengarahkan ke `/`. Konten dibuat tanpa penelusuran web dan tidak terverifikasi.
