// ============================================================
// KONFIGURASI SISTEM PRESENSI MTS AL HUDA PUTRI MALANG
// Version: 2.0.0
// ============================================================
// ⚠️ PERHATIAN v2.0:
//   - PIN TIDAK lagi disimpan di sini (sudah dipindah ke Google Sheets)
//   - Hanya isi API_URL setelah deploy Google Apps Script
// ============================================================

const APP_CONFIG = {
  // ── WAJIB DIISI setelah deploy Google Apps Script ──
  // Dapatkan URL dari: Apps Script → Deploy → Manage Deployments
  API_URL: 'https://script.google.com/macros/s/AKfycbz20Df5FlXziAbfVbTPmiNx4d-LSju7gYNV_93KWhhRWSNYHy6Pe00B-eum9pc0erT4Dg/exec',

  // ── Informasi Sekolah ──
  SCHOOL_NAME:    'MTS Al Huda Putri Malang',
  SCHOOL_ABBREV:  'MTS Al Huda',
  SCHOOL_TAGLINE: 'Berakhlak · Berprestasi · Berkarakter',

  // ── Tahun Ajaran ──
  TAHUN_AJARAN: '2026/2027',
  SEMESTER:     '1 (Ganjil)',

  // ── Daftar Kelas ──
  KELAS_LIST: ['VII', 'VIII', 'IX'],

  // ── Scanner Settings ──
  SCAN_COOLDOWN_MS: 2500,   // jeda antar scan (ms)
  SOUND_ENABLED:    true,

  // ── Versi Aplikasi ──
  VERSION: '2.0.0'

  // PIN_TU / PIN_KEPSEK / PIN_WALI → ada di Google Sheets sheet KONFIGURASI
  // JANGAN taruh PIN di sini!
};
