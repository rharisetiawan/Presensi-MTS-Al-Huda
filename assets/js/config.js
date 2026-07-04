// ============================================================
// KONFIGURASI SISTEM PRESENSI MTS AL HUDA PUTRI MALANG
// Edit file ini setelah deploy Google Apps Script
// ============================================================

const APP_CONFIG = {
  // ── WAJIB DIISI setelah deploy Google Apps Script ──
  // Dapatkan URL dari: Apps Script → Deploy → Manage Deployments
  API_URL: 'https://script.google.com/macros/s/AKfycbz20Df5FlXziAbfVbTPmiNx4d-LSju7gYNV_93KWhhRWSNYHy6Pe00B-eum9pc0erT4Dg/exec',

  // ── Informasi Sekolah ──
  SCHOOL_NAME:     'MTS Al Huda Putri Malang',
  SCHOOL_ABBREV:   'MTS Al Huda',
  SCHOOL_TAGLINE:  'Berakhlak · Berprestasi · Berkarakter',
  SCHOOL_LOGO:     '../assets/logo.png',   // opsional

  // ── Tahun Ajaran ──
  TAHUN_AJARAN: '2026/2027',
  SEMESTER:     '1 (Ganjil)',

  // ── Jam Sekolah (sinkron dengan Konfigurasi di Spreadsheet) ──
  JAM_MASUK_SISWA:   '06:40',
  TOLERANSI_SISWA:    10,      // menit
  JAM_MASUK_GURU:    '06:30',
  TOLERANSI_GURU:     15,      // menit
  JAM_PULANG_GURU:   '15:30',

  // ── Kelas yang ada ──
  KELAS_LIST: ['VII', 'VIII', 'IX'],

  // ── PIN Admin (TU) — ganti dengan PIN yang kuat ──
  ADMIN_PIN: '123456',

  // ── Scanner settings ──
  SCAN_COOLDOWN_MS: 2500,   // jeda antar scan (ms)
  SOUND_ENABLED:    true,

  // ── Versi Aplikasi ──
  VERSION: '1.0.0'
};
