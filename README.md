# Absensi Pengajian

Aplikasi absensi pengajian berbasis web. Jamaah cukup membuka satu link yang sama untuk semua sesi, memilih nama, dan mengetuk tempat hadir (Tatap Muka Masjid atau SDC via Moomla). Setelah itu muncul ringkasan materi dan ayat atau hadis. Pengurus punya halaman rekap, input susulan, pengelolaan sesi, materi, masukan, dan daftar jamaah.

```
HP jamaah / pengurus ──► GitHub Pages (index.html, app.js)
                              │  fetch
                              ▼
                      Google Apps Script (backend/Code.gs)
                              │
                              ▼
                      Google Sheet (data tersimpan di Drive Anda)
```

Tidak ada server berbayar dan tidak ada database tersembunyi. Semua data ada di Google Sheet milik Anda, bisa dibuka, diedit, dan diunduh sebagai Excel kapan saja.

## Isi folder

| Berkas | Fungsi |
|---|---|
| `index.html`, `style.css`, `app.js` | Tampilan (yang dibuka jamaah dan pengurus) |
| `config.js` | Tempat menempel alamat backend (satu-satunya berkas yang diubah) |
| `backend/Code.gs`, `backend/appsscript.json` | Kode backend untuk ditempel di Google Apps Script |
| `dev/` | Alat uji coba lokal, tidak dipakai saat produksi |

## Pemasangan (sekitar 20 menit)

### 1. Buat Google Sheet dan pasang backend

1. Buka [sheets.new](https://sheets.new) memakai akun Google yang akan menjadi pemilik data. Beri nama, misalnya **Absensi Pengajian**.
2. Menu **Ekstensi > Apps Script**.
3. Hapus isi `Code.gs` bawaan, lalu tempel seluruh isi berkas `backend/Code.gs` dari folder ini. Simpan.
4. Klik ikon roda gigi (**Setelan project**), centang **Tampilkan file manifes "appsscript.json" di editor**. Kembali ke editor, buka `appsscript.json`, ganti isinya dengan isi berkas `backend/appsscript.json`. Simpan.

### 2. Siapkan lembar dan PIN

1. Muat ulang halaman Google Sheet. Muncul menu baru **Absensi Pengajian**.
2. Pilih **1. Siapkan lembar**. Pertama kali, Google meminta izin. Klik **Lanjutkan**, pilih akun Anda, lalu **Lanjutan > Buka (tidak aman) > Izinkan**. Peringatan "belum diverifikasi" muncul karena ini skrip milik Anda sendiri, bukan aplikasi publik.
3. Buka lembar **Pengurus**. Ganti nama "Administrator" dengan nama Anda bila perlu. Nama dan peran yang tertulis di sini muncul di layar masuk.
4. Pilih **2. Atur PIN pengurus**, ketik nama persis seperti di lembar Pengurus, lalu PIN 4 sampai 8 angka. Ulangi untuk tiap orang. PIN disimpan sebagai sidik digital, bukan teks.

Peran yang tersedia (ketik persis di kolom Peran):

| Peran | Bisa melakukan |
|---|---|
| `Administrator`, `Ketua Kelompok` | Semua: rekap, input manual, sesi, materi, masukan, jamaah, hapus, cadangan |
| `Muballigh` | Rekap, input manual, materi, masukan |
| `Pemateri` | Hanya materi, dan hanya untuk sesi yang kolom Pemateri-nya sama dengan namanya |

### 3. Terbitkan sebagai web app

1. Di Apps Script: **Terapkan > Penerapan baru > Aplikasi web**.
2. **Jalankan sebagai: Saya**. **Yang memiliki akses: Siapa saja**. Klik **Terapkan**.
3. Salin **URL aplikasi web** (berakhiran `/exec`).
4. Buka `config.js` di folder ini dan tempel URL itu di `API_URL`.

### 4. Pasang tampilan di GitHub Pages

1. Di GitHub, buat repositori baru (misalnya `absensi-pengajian`) dan unggah seluruh isi folder ini. Cara cepat tanpa Git: **Add file > Upload files**, seret semua berkas dan folder.
2. **Settings > Pages**. Di **Build and deployment**, pilih **Deploy from a branch**, branch **main**, folder **/ (root)**, lalu **Save**.
3. Setelah satu atau dua menit, alamatnya muncul, bentuknya `https://NAMA-ANDA.github.io/absensi-pengajian/`. Itulah link tetap yang dibagikan ke grup WhatsApp. Halaman pengurus ada di tautan kecil di bagian bawah, atau tambahkan `#pengurus` di akhir alamat.

Di paket GitHub gratis, GitHub Pages umumnya mengharuskan repositori publik. Itu aman di sini karena repositori hanya berisi kode, tanpa data jamaah dan tanpa PIN.

### 5. Isi daftar jamaah dan coba

1. Masuk sebagai pengurus, buka tab **Jamaah**, tempel daftar nama (satu per baris). Atau tempel langsung di kolom A lembar **Jamaah** pada Sheet.
2. Buka tab **Sesi**, buat satu sesi yang mulainya hari ini, lalu coba absen dari HP.
3. Pilih **3. Pasang cadangan otomatis tiap bulan** di menu Google Sheet.

## Cara kerjanya sehari-hari

- **Jamaah:** buka link, pilih pengajian, pilih nama, ketuk Tatap Muka Masjid atau SDC. Sesi terbuka sampai 3 hari sejak mulai (pengurus bisa mengubah 1 sampai 7 hari per sesi). Lewat itu, jamaah lapor ke pengurus.
- **Pengurus:** buat sesi di tab Sesi, atau tambah baris langsung di lembar **Sesi** (Judul, Pemateri, Tempat, Mulai, HariBuka; ID terisi otomatis).
- **Ayat dan hadis:** tiap sesi baru otomatis diberi satu kutipan. Ayat Al-Qur'an diambil acak dari alquran.cloud. Hadis diambil dari lembar **Pustaka**, yaitu daftar yang Anda dan muballigh pilih sendiri, supaya hadis yang tampil terjaga keabsahannya. Tambah hadis di lembar Pustaka (Jenis, Rujukan, Arab, Terjemah, Sumber, Derajat). Pemateri bisa mengganti kutipan lewat tab **Materi**.
- **Rekap dan Excel:** tab Rekap bisa difilter 7 hari, 30 hari, 3 bulan, 6 bulan, 1 tahun, semua, atau rentang tanggal, lalu diunduh sebagai `.xlsx`. Data lama tidak hilang.
- **Cadangan:** salinan seluruh Sheet disimpan di folder **Cadangan Absensi Pengajian** di Drive (otomatis tiap bulan, atau tombol di tab Rekap). 24 salinan terakhir disimpan.

## Mengubah kode backend

Setiap kali `Code.gs` diubah, terbitkan versi baru: **Terapkan > Kelola penerapan > ikon pensil > Versi: Versi baru > Terapkan**. URL tetap sama. Data daftar sesi dan nama di-cache 90 detik, jadi perubahan langsung di Sheet terlihat jamaah dalam sekitar satu setengah menit.

## Keamanan dan privasi

- Siapa pun yang punya link bisa melihat **daftar nama jamaah aktif** (supaya bisa memilih nama) dan **nama serta peran pengurus** (untuk layar masuk). Masukan, rekap, dan PIN tidak pernah dikirim tanpa login pengurus. Bila nama lengkap dirasa sensitif, gunakan nama panggilan di daftar.
- Bagikan akses Google Sheet **hanya ke administrator**. Orang yang bisa mengedit Sheet bisa melihat semua data, termasuk masukan.
- PIN pengurus salah 5 kali mengunci nama itu selama 10 menit. Login berlaku 6 jam.
- Satu HP dibatasi 5 absen per 10 menit, dan ada kolom jebakan untuk bot. Pengurus dengan hak hapus bisa menghapus catatan hadir atau masukan yang tidak pantas.
- Cadangan penting: akun Google pemilik Sheet adalah satu titik tunggal. Tambahkan satu pengurus tepercaya sebagai editor atau pemilik bersama.

## Batas yang perlu diketahui

Google Apps Script membatasi 30 eksekusi bersamaan per pengguna dan 6 menit per eksekusi. Aplikasi mengantre penulisan dan mengulang otomatis bila server sibuk, jadi ratusan jamaah yang absen berdekatan tetap aman, hanya mungkin terasa 1 sampai 3 detik. Sheet menampung sampai 20 juta sel, jauh melebihi kebutuhan puluhan tahun. Batas ini ditetapkan Google dan dapat berubah.

## Uji coba lokal (tanpa Google)

Memerlukan Node.js.

```
node dev/test.js      # uji logika backend memakai tiruan Google Sheets
node dev/server.js    # coba aplikasi di http://localhost:8080 dengan data contoh
```

PIN contoh di server lokal: Administrator `111111`, Aep Supiana `222222`, Alifar Ihsan Azhari `333333`. Data hilang saat server dimatikan.
