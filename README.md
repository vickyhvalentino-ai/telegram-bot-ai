# vickyyvall Telegram AI — Real Feature Rebuild

## Fitur runtime
- AI Chat dengan provider dari konfigurasi bot.
- Web Search dengan adapter `WEB_SEARCH_URL` atau fallback DuckDuckGo HTML.
- Image Search dengan adapter `IMAGE_SEARCH_URL` atau fallback Bing Images.
- Image delivery: URL gambar diunduh server menjadi `Buffer`, lalu dikirim ke Telegram sebagai foto nyata.
- Social Search publik untuk TikTok, Instagram, YouTube, X, dan Facebook.
- Profil sosial mencoba halaman profil langsung terlebih dahulu, lalu web-search sebagai fallback.
- Metadata profil publik: nama, bio, foto, dan statistik yang benar-benar terbaca; data yang tidak tersedia tidak ditebak.
- Video Search dengan filter platform dan tombol URL sumber.
- Math Lab dengan kalkulasi lokal terbatas.
- Quiz dengan bank soal runtime dan skor.
- Tebak Angka 1–100.
- Tic Tac Toe vs bot dengan pemilihan langkah berbasis minimax.
- Dice Battle.
- Math Challenge + hint AI.
- Statistik pemain dan leaderboard yang disimpan di `database.json`.
- Media Lab untuk foto/dokumen ke AI jika provider mendukung.
- Premium Hub dengan inline buttons yang punya handler nyata.

## Tidak ada dummy
`vickyyvall.js` tidak lagi berisi blok `CATALOG`/`ASSET` berulang untuk memperbesar ukuran file. `prompt.js` juga dibersihkan dari appendix pengulang yang hanya mengejar ukuran.

## Setup
```bash
npm install
TELEGRAM_BOT_TOKEN=ISI_TOKEN npm start
```

Atau isi environment variable melalui hosting.

## Search adapter produksi
Fallback HTML berguna untuk eksperimen, tetapi provider API khusus lebih stabil untuk produksi:
- `WEB_SEARCH_URL` harus menerima `?q=` dan mengembalikan JSON `results`, `items`, atau `organic_results`.
- `IMAGE_SEARCH_URL` harus menerima `?q=` dan mengembalikan array atau JSON `results`/`images`/`items` berisi URL gambar.

## Catatan penting
Social platform dapat memblokir request otomatis. Bot tidak mengarang follower/like ketika halaman publik tidak memberikan datanya.

FFmpeg/yt-dlp tidak dipalsukan sebagai fitur downloader. Jika binary dan pipeline benar-benar dipasang, fitur tersebut dapat ditambahkan sebagai modul media terpisah.
