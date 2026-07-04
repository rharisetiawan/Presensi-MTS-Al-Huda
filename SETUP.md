# 🏫 Panduan Setup — Sistem Presensi MTS Al Huda Putri Malang

> Versi 1.0.0 | Stack: Google Sheets + Apps Script + GitHub Pages

---

## Gambaran Sistem

```
HP Scanner Sekolah (Android)
    └─ Scanner PWA (/scanner/)
           │ POST scan QR
           ▼
    Google Apps Script (Backend API)
           │ baca/tulis
           ▼
    Google Spreadsheet (Database)
           │
    Dashboard TU (/dashboard/) ← lihat rekap, kelola data, export
    Generator QR Card (/qrcard/) ← cetak ID card siswa/guru
```

---

## LANGKAH 1 — Buat Google Spreadsheet

1. Buka [Google Sheets](https://sheets.google.com)
2. Klik **+ Baru** → **Google Spreadsheet kosong**
3. Beri nama: `Presensi MTS Al Huda Putri 2026/2027`
4. Salin **Spreadsheet ID** dari URL:
   - URL: `https://docs.google.com/spreadsheets/d/`**`1AbCdEfG...`**`/edit`
   - Yang ditebal itu adalah Spreadsheet ID (simpan, nanti digunakan)

---

## LANGKAH 2 — Setup Google Apps Script

1. Di Spreadsheet tadi, klik menu **Extensions → Apps Script**
2. Hapus kode default yang ada (`function myFunction() {...}`)
3. Buka file `/backend/Code.gs` di komputer
4. **Salin semua isinya** dan **tempel** di Apps Script editor
5. Klik **💾 Simpan** (Ctrl+S)

### Jalankan Setup Awal
6. Di dropdown function, pilih **`setupSpreadsheet`**
7. Klik tombol **▶ Run**
8. Akan muncul dialog permission → klik **Review Permissions**
9. Pilih akun Google sekolah → klik **Allow**
10. Tunggu sampai muncul pesan: *"✅ Setup Selesai!"*
11. Kembali ke Spreadsheet → semua sheet sudah terbuat otomatis!

---

## LANGKAH 3 — Deploy sebagai Web App

1. Di Apps Script, klik **Deploy → New Deployment**
2. Klik ⚙️ icon di sebelah **Select type** → pilih **Web app**
3. Isi pengaturan:
   - **Description**: `Presensi MTS Al Huda v1`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone` *(penting! agar bisa diakses dari browser)*
4. Klik **Deploy**
5. **Salin Web App URL** yang muncul, contoh:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```
   > ⚠️ **SIMPAN URL INI!** Ini adalah URL API sistem kita.

---

## LANGKAH 4 — Update config.js

1. Buka file `/assets/js/config.js` di text editor
2. Ganti baris `API_URL`:
   ```javascript
   API_URL: 'https://script.google.com/macros/s/GANTI_DENGAN_URL_ANDA/exec',
   ```
   Menjadi URL yang tadi disalin, contoh:
   ```javascript
   API_URL: 'https://script.google.com/macros/s/AKfycby.../exec',
   ```
3. Ganti juga **PIN admin** (default `123456`):
   ```javascript
   ADMIN_PIN: '081234', // ganti dengan PIN yang kuat
   ```
4. **Simpan file**

---

## LANGKAH 5 — Deploy ke GitHub Pages (Hosting Gratis)

### Buat Repository GitHub
1. Buka [github.com](https://github.com) → Sign in
2. Klik **New Repository**
3. Nama repo: `presensi-mts-alhuda` (atau sesuai keinginan)
4. Visibility: **Private** (agar data lebih aman)
5. Klik **Create Repository**

### Upload File Project
6. Di komputer, buka Terminal/Command Prompt
7. Masuk ke folder project:
   ```bash
   cd "/Users/mac/Documents/Presensi MTS AL HUDA"
   ```
8. Upload ke GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Sistem Presensi MTS Al Huda"
   git remote add origin https://github.com/USERNAME/presensi-mts-alhuda.git
   git push -u origin main
   ```

### Aktifkan GitHub Pages
9. Di GitHub repo → **Settings → Pages**
10. Source: **Deploy from a branch**
11. Branch: **main** / **(root)**
12. Klik **Save**
13. Tunggu 2-3 menit → URL akan aktif:
    ```
    https://USERNAME.github.io/presensi-mts-alhuda/
    ```

---

## LANGKAH 6 — Setup Subdomain Sekolah

Di panel domain sekolah, tambahkan CNAME record:

```
Subdomain : presensi
Type      : CNAME
Value     : USERNAME.github.io
TTL       : 3600
```

Lalu di GitHub repo, buat file `CNAME` berisi:
```
presensi.mtsalhudaputrimalang.sch.id
```

Setelah propagasi DNS (1-24 jam), sistem akan bisa diakses di:
```
https://presensi.mtsalhudaputrimalang.sch.id/
```

---

## LANGKAH 7 — Import Data Siswa

### Dari File EMIS Kemenag:
1. Buka **Dashboard Admin** → login dengan PIN
2. Klik **Data Siswa** di menu kiri
3. Klik **Import Excel**
4. Pilih file Excel dari EMIS
5. Sistem akan otomatis mendeteksi kolom NIS, Nama, Kelas, dll
6. Klik **Import & Ganti Data**

### Format kolom yang dikenali sistem:
| Kolom di Excel | Nama yang dikenali |
|---|---|
| NIS | `NIS`, `nis`, `Nomor Induk Siswa` |
| Nama | `Nama`, `NAMA`, `Nama Lengkap` |
| Kelas | `Kelas`, `KELAS` |
| Jenis Kelamin | `Jenis Kelamin`, `JK` |
| Nama Ortu | `Nama Ortu`, `Nama Orang Tua` |
| No HP Ortu | `No HP Ortu`, `HP Ortu` |

---

## LANGKAH 8 — Input Data Guru

1. Dashboard → **Data Guru/Tendik**
2. Klik **+ Tambah Guru** untuk input satu per satu
3. Isi: NIG/NIP, Nama, Jabatan, Mapel (opsional), Jenis Kelamin, Tipe (Guru/TU/Tendik)

---

## LANGKAH 9 — Cetak QR Card Siswa & Guru

1. Buka `presensi.mtsalhudaputrimalang.sch.id/qrcard/`
2. Pilih **Tipe** (Siswa atau Guru)
3. Pilih **Filter Kelas** (opsional)
4. Pilih **Tema Warna** kartu
5. Klik **Generate Kartu**
6. Klik **🖨️ Print Semua**
7. Di dialog print browser:
   - Layout: **Landscape**
   - Margin: **None/Minimal**
   - Background graphics: **ON**
8. Cetak ke kertas tebal (250gsm) atau langsung ke mesin ID card

---

## LANGKAH 10 — Daftarkan HP Scanner

1. Dashboard → **Perangkat Scanner**
2. Klik **+ Daftarkan HP Baru**
3. Beri nama (misal: *HP Scanner Gerbang*) → klik **Generate Token**
4. **Salin token** yang muncul
5. Di HP Android sekolah, buka:
   `presensi.mtsalhudaputrimalang.sch.id/scanner/`
6. Masukkan token di kolom yang tersedia
7. Klik **Daftarkan Perangkat** → HP siap digunakan!

### Tambahkan ke Layar Utama HP (PWA):
- Di Chrome Android → menu **⋮ → Tambahkan ke layar Utama**
- Aplikasi akan muncul seperti app native

---

## Alur Penggunaan Harian

```
Pagi Hari:
1. Guru Piket nyalakan HP scanner
2. Siswa/Guru datang → tunjukkan QR Card
3. Guru Piket scan QR Card
4. Layar langsung menampilkan: Nama + Status (HADIR/TERLAMBAT)
5. Data tersimpan otomatis ke Google Spreadsheet

Di TU:
1. Buka Dashboard Admin
2. Lihat rekap absensi hari ini
3. Input manual untuk yang Izin/Sakit
4. Export laporan Excel jika diperlukan
```

---

## Format QR Code

| Tipe | Format QR | Contoh |
|---|---|---|
| Siswa | `MTS-S-{NIS}` | `MTS-S-12345678` |
| Guru | `MTS-G-{NIG}` | `MTS-G-9876543210` |
| TU/Tendik | `MTS-TU-{NITK}` | `MTS-TU-11223344` |

---

## Troubleshooting

### ❌ "Gagal terhubung ke server"
- Periksa URL di `config.js` sudah benar
- Pastikan Apps Script sudah di-deploy dengan **"Anyone"** access
- Coba buka URL API langsung di browser → harus muncul JSON response

### ❌ "Device tidak terdaftar"
- Token HP scanner mungkin sudah expired atau salah
- Dashboard → Perangkat Scanner → Daftarkan ulang HP
- Pastikan token yang dimasukkan di HP benar

### ❌ "NIS tidak ditemukan"
- Data siswa belum diimport ke sistem
- Atau NIS di QR Card berbeda dengan NIS di database
- Regenerate QR Card setelah import data

### ❌ Laporan tidak muncul
- Pastikan format bulan: `YYYY-MM` (contoh: `2026-07`)
- Periksa data absensi apakah ada di sheet `ABSEN_SISWA`

---

## Pembaruan Sistem (Update)

Jika ada pembaruan kode:
1. Download file terbaru
2. Update `config.js` (jangan sampai tertimpa!)
3. Push ke GitHub → otomatis live

---

## Kontak & Support

Sistem ini dibangun khusus untuk **MTS Al Huda Putri Malang**.
Untuk pertanyaan teknis, hubungi pengembang.

---

*Dibuat dengan ❤️ untuk MTS Al Huda Putri Malang — Sistem Presensi Digital v1.0.0*
