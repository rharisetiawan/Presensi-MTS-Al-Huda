// ============================================================
// KONFIGURASI SISTEM PRESENSI MTS AL HUDA PUTRI MALANG
// Version: 2.1.0
// ============================================================
// ⚠️ PERHATIAN v2.0:
//   - PIN TIDAK lagi disimpan di sini (sudah dipindah ke Google Sheets)
//   - Hanya isi API_URL setelah deploy Google Apps Script
// ============================================================

const APP_CONFIG = {
  // ── WAJIB DIISI setelah deploy Google Apps Script ──
  // Dapatkan URL dari: Apps Script → Deploy → Manage Deployments
  API_URL: 'https://script.google.com/macros/s/AKfycbwbyAmb5ckFlydwJs34DcfbI21gvv9vzdtI5SFFd5n6CMkKeDnvJIPk81EzzERuvnZ98w/exec',


  // ── Informasi Sekolah ──
  SCHOOL_NAME:    'MTS Al Huda Putri Malang',
  SCHOOL_ABBREV:  'MTS Al Huda',
  SCHOOL_TAGLINE: 'Berakhlak · Berprestasi · Berkarakter',

  // ── Aset Sekolah ──
  LOGO_URL:    '../assets/icons/logo-mts.png',
  FAVICON_URL: '../assets/icons/favicon.ico',

  // ── Tahun Ajaran ──
  TAHUN_AJARAN: '2026/2027',
  SEMESTER:     '1 (Ganjil)',

  // ── Daftar Kelas ──
  KELAS_LIST: ['VII', 'VIII', 'IX'],

  // ── Scanner Settings ──
  SCAN_COOLDOWN_MS: 2500,   // jeda antar scan (ms)
  SOUND_ENABLED:    true,

  // ── Tampilan ──
  DARK_MODE_DEFAULT: true,  // true = dark mode, false = light mode

  // ── Credit ──
  FOOTER_CREDIT: 'Made with ❤️ by <a href="https://weverx.com" target="_blank" rel="noopener">weverx.com</a>',

  // ── Versi Aplikasi ──
  VERSION: '2.1.0'

  // PIN_TU / PIN_KEPSEK / PIN_WALI → ada di Google Sheets sheet KONFIGURASI
  // JANGAN taruh PIN di sini!
};

