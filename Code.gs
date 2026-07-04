// ============================================================
// SISTEM PRESENSI MTS AL HUDA PUTRI MALANG
// Google Apps Script Backend API
// Version: 1.0.0
// ============================================================

// ── KONFIGURASI SHEET ────────────────────────────────────────
const SHEET_SISWA         = 'DATA_SISWA';
const SHEET_GURU          = 'DATA_GURU';
const SHEET_ABSEN_SISWA   = 'ABSEN_SISWA';
const SHEET_ABSEN_GURU    = 'ABSEN_GURU';
const SHEET_KONFIGURASI   = 'KONFIGURASI';
const SHEET_DEVICE_TOKENS = 'DEVICE_TOKENS';
const TIMEZONE            = 'Asia/Jakarta';

// ── MAIN HANDLER POST ─────────────────────────────────────────
function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;

    // Semua aksi scan wajib punya device token valid
    if (action === 'scan' && !validateToken(data.token)) {
      return jsonResponse({ success: false, code: 'INVALID_TOKEN', message: 'Device tidak terdaftar atau tidak aktif.' });
    }

    switch (action) {
      case 'scan':             return prosesAbsen(data);
      case 'register_device':  return registerDevice(data);
      case 'update_attendance':return updateAttendance(data);
      case 'add_student':      return addStudent(data);
      case 'add_teacher':      return addTeacher(data);
      case 'delete_student':   return deleteStudent(data);
      case 'delete_teacher':   return deleteTeacher(data);
      case 'import_students':  return importStudents(data);
      case 'import_teachers':  return importTeachers(data);
      case 'deactivate_device':return deactivateDevice(data);
      case 'update_config':    return updateConfig(data);
      default: return jsonResponse({ success: false, message: 'Action tidak dikenal: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, message: 'Server error: ' + err.toString() });
  }
}

// ── MAIN HANDLER GET ──────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action;

    switch (action) {
      case 'get_attendance':    return getAttendance(e.parameter);
      case 'get_students':      return getStudents();
      case 'get_teachers':      return getTeachers();
      case 'get_stats':         return getStats(e.parameter);
      case 'get_report':        return getReport(e.parameter);
      case 'get_config':        return getConfigResponse();
      case 'get_devices':       return getDevices();
      case 'validate_device':   return validateDeviceResponse(e.parameter.token);
      case 'get_absen_range':   return getAbsenRange(e.parameter);
      default: return jsonResponse({ success: false, message: 'Action tidak dikenal: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, message: 'Server error: ' + err.toString() });
  }
}

// ── CORS HELPER ───────────────────────────────────────────────
function jsonResponse(data) {
  const output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ── SPREADSHEET HELPER ────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + name);
  return sheet;
}

function nowJakarta() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm:ss');
}

function todayJakarta() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function nowMinutes() {
  const d = new Date();
  // Convert to Jakarta time
  const jakartaTime = Utilities.formatDate(d, TIMEZONE, 'HH:mm');
  const [h, m] = jakartaTime.split(':').map(Number);
  return h * 60 + m;
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.toString().split(':').map(Number);
  return h * 60 + m;
}

// ── DEVICE TOKEN MANAGEMENT ───────────────────────────────────
function validateToken(token) {
  if (!token) return false;
  const sheet = getSheet(SHEET_DEVICE_TOKENS);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(token) && data[i][4] === 'AKTIF') {
      return true;
    }
  }
  return false;
}

function validateDeviceResponse(token) {
  return jsonResponse({ success: true, valid: validateToken(token) });
}

function registerDevice(data) {
  const sheet = getSheet(SHEET_DEVICE_TOKENS);
  const token = generateToken();
  sheet.appendRow([
    token,
    data.name     || 'HP Scanner',
    data.location || 'Pintu Masuk Sekolah',
    todayJakarta(),
    'AKTIF'
  ]);
  return jsonResponse({ success: true, token: token, message: 'Device berhasil didaftarkan.' });
}

function generateToken() {
  const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result   = 'MTS-';
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) result += '-';
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result; // format: MTS-XXXX-XXXX-XXXX
}

function getDevices() {
  const sheet   = getSheet(SHEET_DEVICE_TOKENS);
  const data    = sheet.getDataRange().getValues();
  const devices = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      devices.push({
        token:      data[i][0],
        name:       data[i][1],
        location:   data[i][2],
        registered: data[i][3],
        status:     data[i][4]
      });
    }
  }
  return jsonResponse({ success: true, data: devices });
}

function deactivateDevice(data) {
  const sheet   = getSheet(SHEET_DEVICE_TOKENS);
  const rows    = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.token)) {
      sheet.getRange(i + 1, 5).setValue('NONAKTIF');
      return jsonResponse({ success: true, message: 'Device berhasil dinonaktifkan.' });
    }
  }
  return jsonResponse({ success: false, message: 'Token tidak ditemukan.' });
}

// ── KONFIGURASI ───────────────────────────────────────────────
function getKonfigurasi() {
  const sheet  = getSheet(SHEET_KONFIGURASI);
  const data   = sheet.getDataRange().getValues();
  const config = {};
  data.forEach(row => {
    if (!row[0]) return;
    let val = row[1];
    // Jika nilai adalah Date object (terjadi saat Google Sheets menyimpan waktu),
    // konversi ke format HH:mm
    if (val instanceof Date) {
      const hh = String(val.getHours()).padStart(2, '0');
      const mm = String(val.getMinutes()).padStart(2, '0');
      val = hh + ':' + mm;
    }
    config[row[0]] = val;
  });
  return config;
}

function getConfigResponse() {
  return jsonResponse({ success: true, data: getKonfigurasi() });
}

function updateConfig(data) {
  const sheet = getSheet(SHEET_KONFIGURASI);
  const rows  = sheet.getDataRange().getValues();
  const updates = data.updates || {};

  for (let i = 0; i < rows.length; i++) {
    if (updates.hasOwnProperty(rows[i][0])) {
      sheet.getRange(i + 1, 2).setValue(updates[rows[i][0]]);
    }
  }
  return jsonResponse({ success: true, message: 'Konfigurasi berhasil diperbarui.' });
}

// ── PROSES ABSEN (INTI SISTEM) ────────────────────────────────
function prosesAbsen(data) {
  const qrCode = (data.qrCode || '').trim();
  const config = getKonfigurasi();
  const tanggal = todayJakarta();
  const jamMenitSekarang = nowMinutes();
  const jamStr = nowJakarta();

  if (qrCode.startsWith('MTS-S-')) {
    return _absenSiswa(qrCode, tanggal, jamMenitSekarang, jamStr, config, data);
  } else if (qrCode.startsWith('MTS-G-') || qrCode.startsWith('MTS-TU-')) {
    return _absenGuru(qrCode, tanggal, jamMenitSekarang, jamStr, config, data);
  } else {
    return jsonResponse({ success: false, code: 'UNKNOWN_QR', message: 'Format QR Code tidak dikenal.' });
  }
}

function _absenSiswa(qrCode, tanggal, jamMenit, jamStr, config, reqData) {
  const nis = qrCode.replace('MTS-S-', '');

  // Cari data siswa
  const sheetSiswa = getSheet(SHEET_SISWA);
  const rows       = sheetSiswa.getDataRange().getValues();
  let siswa        = null;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(nis) && rows[i][6] !== 'NONAKTIF') {
      siswa = { nis: rows[i][0], nama: rows[i][1], kelas: rows[i][2], jenisKelamin: rows[i][3] };
      break;
    }
  }

  if (!siswa) {
    return jsonResponse({ success: false, code: 'NOT_FOUND', message: 'NIS ' + nis + ' tidak ditemukan atau tidak aktif.' });
  }

  // Cek duplikat absen hari ini
  const sheetAbsen = getSheet(SHEET_ABSEN_SISWA);
  const absenRows  = sheetAbsen.getDataRange().getValues();
  for (let i = 1; i < absenRows.length; i++) {
    if (String(absenRows[i][2]) === String(nis) && absenRows[i][1] === tanggal) {
      return jsonResponse({
        success: false,
        code: 'DUPLICATE',
        message: siswa.nama + ' sudah tercatat hadir pukul ' + absenRows[i][5],
        siswa: siswa
      });
    }
  }

  // Tentukan status
  const jamMasuk  = timeToMinutes(config['JAM_MASUK_SISWA'] || '06:40');
  const toleransi = parseInt(config['TOLERANSI_SISWA'] || '10');
  const status    = jamMenit <= (jamMasuk + toleransi) ? 'HADIR' : 'TERLAMBAT';

  // Simpan absen
  const id = 'S' + new Date().getTime();
  sheetAbsen.appendRow([
    id, tanggal, siswa.nis, siswa.nama, siswa.kelas,
    jamStr, status, '', reqData.scannedBy || 'Sistem'
  ]);

  return jsonResponse({ success: true, type: 'siswa', siswa, status, jam: jamStr, tanggal });
}

function _absenGuru(qrCode, tanggal, jamMenit, jamStr, config, reqData) {
  const nig = qrCode.replace('MTS-G-', '').replace('MTS-TU-', '');

  // Cari data guru
  const sheetGuru = getSheet(SHEET_GURU);
  const rows      = sheetGuru.getDataRange().getValues();
  let guru        = null;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(nig)) {
      guru = { nig: rows[i][0], nama: rows[i][1], jabatan: rows[i][2], mapel: rows[i][3], tipe: rows[i][5] };
      break;
    }
  }

  if (!guru) {
    return jsonResponse({ success: false, code: 'NOT_FOUND', message: 'NIG ' + nig + ' tidak ditemukan.' });
  }

  const sheetAbsen = getSheet(SHEET_ABSEN_GURU);
  const absenRows  = sheetAbsen.getDataRange().getValues();

  // Cek apakah sudah ada record hari ini
  let existingRowIdx = -1;
  let existingData   = null;
  for (let i = 1; i < absenRows.length; i++) {
    if (String(absenRows[i][2]) === String(nig) && absenRows[i][1] === tanggal) {
      existingRowIdx = i + 1; // 1-indexed untuk setRange
      existingData   = absenRows[i];
      break;
    }
  }

  if (existingRowIdx > 0) {
    // Sudah ada record → ini scan PULANG
    if (existingData[6] && existingData[6] !== '') {
      // Sudah scan pulang juga
      return jsonResponse({
        success: false,
        code: 'DUPLICATE',
        message: guru.nama + ' sudah tercatat masuk pukul ' + existingData[4] + ' dan pulang pukul ' + existingData[6],
        guru
      });
    }

    // Update jam pulang
    const jamPulang = timeToMinutes(config['JAM_PULANG_GURU'] || '15:30');
    const statusPulang = jamMenit >= jamPulang ? 'TEPAT_WAKTU' : 'PULANG_AWAL';
    sheetAbsen.getRange(existingRowIdx, 7).setValue(jamStr);
    sheetAbsen.getRange(existingRowIdx, 8).setValue(statusPulang);

    return jsonResponse({ success: true, type: 'guru_pulang', guru, status: statusPulang, jam: jamStr, tanggal });
  }

  // Belum ada record → ini scan MASUK
  const jamMasuk  = timeToMinutes(config['JAM_MASUK_GURU'] || '06:30');
  const toleransi = parseInt(config['TOLERANSI_GURU'] || '15');
  const status    = jamMenit <= (jamMasuk + toleransi) ? 'HADIR' : 'TERLAMBAT';

  const id = 'G' + new Date().getTime();
  sheetAbsen.appendRow([ id, tanggal, guru.nig, guru.nama, jamStr, status, '', '', '' ]);

  return jsonResponse({ success: true, type: 'guru_masuk', guru, status, jam: jamStr, tanggal });
}

// ── GET DATA ──────────────────────────────────────────────────
function getStudents() {
  const sheet    = getSheet(SHEET_SISWA);
  const rows     = sheet.getDataRange().getValues();
  const students = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      students.push({
        nis: rows[i][0], nama: rows[i][1], kelas: rows[i][2],
        jenisKelamin: rows[i][3], namaOrtu: rows[i][4],
        noHpOrtu: rows[i][5], status: rows[i][6] || 'AKTIF'
      });
    }
  }
  return jsonResponse({ success: true, data: students });
}

function getTeachers() {
  const sheet    = getSheet(SHEET_GURU);
  const rows     = sheet.getDataRange().getValues();
  const teachers = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      teachers.push({
        nig: rows[i][0], nama: rows[i][1], jabatan: rows[i][2],
        mapel: rows[i][3], jenisKelamin: rows[i][4], tipe: rows[i][5] || 'Guru'
      });
    }
  }
  return jsonResponse({ success: true, data: teachers });
}

function getAttendance(params) {
  const tanggal = params.tanggal || todayJakarta();
  const kelas   = params.kelas   || '';

  // Absen siswa
  const sheetS  = getSheet(SHEET_ABSEN_SISWA);
  const rowsS   = sheetS.getDataRange().getValues();
  const absenSiswa = [];
  for (let i = 1; i < rowsS.length; i++) {
    if (rowsS[i][1] === tanggal && (!kelas || rowsS[i][4] === kelas)) {
      absenSiswa.push({
        id: rowsS[i][0], tanggal: rowsS[i][1], nis: rowsS[i][2],
        nama: rowsS[i][3], kelas: rowsS[i][4], jamMasuk: rowsS[i][5],
        status: rowsS[i][6], keterangan: rowsS[i][7]
      });
    }
  }

  // Absen guru
  const sheetG   = getSheet(SHEET_ABSEN_GURU);
  const rowsG    = sheetG.getDataRange().getValues();
  const absenGuru = [];
  for (let i = 1; i < rowsG.length; i++) {
    if (rowsG[i][1] === tanggal) {
      absenGuru.push({
        id: rowsG[i][0], tanggal: rowsG[i][1], nig: rowsG[i][2],
        nama: rowsG[i][3], jamMasuk: rowsG[i][4], statusMasuk: rowsG[i][5],
        jamPulang: rowsG[i][6], statusPulang: rowsG[i][7]
      });
    }
  }

  return jsonResponse({ success: true, tanggal, siswa: absenSiswa, guru: absenGuru });
}

function getStats(params) {
  const tanggal = params.tanggal || todayJakarta();

  const totalSiswa = getSheet(SHEET_SISWA).getLastRow() - 1;
  const totalGuru  = getSheet(SHEET_GURU).getLastRow()  - 1;

  const rowsS = getSheet(SHEET_ABSEN_SISWA).getDataRange().getValues();
  let hadirS = 0, terlambatS = 0;
  for (let i = 1; i < rowsS.length; i++) {
    if (rowsS[i][1] !== tanggal) continue;
    if (rowsS[i][6] === 'HADIR')     hadirS++;
    if (rowsS[i][6] === 'TERLAMBAT') terlambatS++;
  }

  const rowsG = getSheet(SHEET_ABSEN_GURU).getDataRange().getValues();
  let hadirG = 0, terlambatG = 0;
  for (let i = 1; i < rowsG.length; i++) {
    if (rowsG[i][1] !== tanggal) continue;
    if (rowsG[i][5] === 'HADIR')     hadirG++;
    if (rowsG[i][5] === 'TERLAMBAT') terlambatG++;
  }

  return jsonResponse({
    success: true, tanggal,
    siswa: {
      total: totalSiswa, hadir: hadirS, terlambat: terlambatS,
      belumAbsen: Math.max(0, totalSiswa - hadirS - terlambatS),
      persen: totalSiswa > 0 ? Math.round((hadirS + terlambatS) / totalSiswa * 100) : 0
    },
    guru: {
      total: totalGuru, hadir: hadirG, terlambat: terlambatG,
      belumAbsen: Math.max(0, totalGuru - hadirG - terlambatG),
      persen: totalGuru > 0 ? Math.round((hadirG + terlambatG) / totalGuru * 100) : 0
    }
  });
}

function getReport(params) {
  const bulan = params.bulan; // format YYYY-MM
  const kelas = params.kelas || '';
  if (!bulan) return jsonResponse({ success: false, message: 'Parameter bulan diperlukan (format: YYYY-MM)' });

  const rowsSiswa = getSheet(SHEET_SISWA).getDataRange().getValues();
  const rowsAbsen = getSheet(SHEET_ABSEN_SISWA).getDataRange().getValues();

  const report = {};
  for (let i = 1; i < rowsSiswa.length; i++) {
    const nis = String(rowsSiswa[i][0]);
    if (!nis || (!kelas || rowsSiswa[i][2] === kelas)) {
      report[nis] = { nis, nama: rowsSiswa[i][1], kelas: rowsSiswa[i][2], hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0 };
    }
  }

  for (let i = 1; i < rowsAbsen.length; i++) {
    const tgl = String(rowsAbsen[i][1]);
    if (!tgl.startsWith(bulan)) continue;
    const nis    = String(rowsAbsen[i][2]);
    const status = rowsAbsen[i][6];
    if (!report[nis]) continue;
    if      (status === 'HADIR')     report[nis].hadir++;
    else if (status === 'TERLAMBAT') report[nis].terlambat++;
    else if (status === 'IZIN')      report[nis].izin++;
    else if (status === 'SAKIT')     report[nis].sakit++;
    else if (status === 'ALPA')      report[nis].alpa++;
  }

  return jsonResponse({ success: true, bulan, data: Object.values(report) });
}

function getAbsenRange(params) {
  const dari  = params.dari;
  const sampai = params.sampai;
  const tipe  = params.tipe || 'siswa';

  const sheet = getSheet(tipe === 'guru' ? SHEET_ABSEN_GURU : SHEET_ABSEN_SISWA);
  const rows  = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    const tgl = rows[i][1];
    if (dari && tgl < dari)   continue;
    if (sampai && tgl > sampai) continue;
    if (tipe === 'siswa') {
      result.push({ id: rows[i][0], tanggal: rows[i][1], nis: rows[i][2], nama: rows[i][3], kelas: rows[i][4], jamMasuk: rows[i][5], status: rows[i][6], keterangan: rows[i][7] });
    } else {
      result.push({ id: rows[i][0], tanggal: rows[i][1], nig: rows[i][2], nama: rows[i][3], jamMasuk: rows[i][4], statusMasuk: rows[i][5], jamPulang: rows[i][6], statusPulang: rows[i][7] });
    }
  }

  return jsonResponse({ success: true, data: result });
}

// ── UPDATE / DELETE ───────────────────────────────────────────
function updateAttendance(data) {
  const sheetName = data.tipe === 'guru' ? SHEET_ABSEN_GURU : SHEET_ABSEN_SISWA;
  const sheet     = getSheet(sheetName);
  const rows      = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      if (data.status)      sheet.getRange(i + 1, 7).setValue(data.status);
      if (data.keterangan !== undefined) sheet.getRange(i + 1, 8).setValue(data.keterangan);
      return jsonResponse({ success: true, message: 'Data absen berhasil diperbarui.' });
    }
  }
  return jsonResponse({ success: false, message: 'Data tidak ditemukan.' });
}

function addStudent(data) {
  const sheet = getSheet(SHEET_SISWA);
  // Cek NIS duplikat
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      return jsonResponse({ success: false, message: 'NIS ' + data.nis + ' sudah ada.' });
    }
  }
  sheet.appendRow([ data.nis, data.nama, data.kelas, data.jenisKelamin || '', data.namaOrtu || '', data.noHpOrtu || '', 'AKTIF' ]);
  return jsonResponse({ success: true, message: 'Siswa berhasil ditambahkan.' });
}

function deleteStudent(data) {
  const sheet = getSheet(SHEET_SISWA);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true, message: 'Siswa berhasil dihapus.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIS tidak ditemukan.' });
}

function addTeacher(data) {
  const sheet = getSheet(SHEET_GURU);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nig)) {
      return jsonResponse({ success: false, message: 'NIG ' + data.nig + ' sudah ada.' });
    }
  }
  sheet.appendRow([ data.nig, data.nama, data.jabatan || '', data.mapel || '', data.jenisKelamin || '', data.tipe || 'Guru' ]);
  return jsonResponse({ success: true, message: 'Guru/Tendik berhasil ditambahkan.' });
}

function deleteTeacher(data) {
  const sheet = getSheet(SHEET_GURU);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nig)) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true, message: 'Guru/Tendik berhasil dihapus.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIG tidak ditemukan.' });
}

function importStudents(data) {
  const students = data.students || [];
  const sheet    = getSheet(SHEET_SISWA);
  const lastRow  = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  if (students.length > 0) {
    const rows = students.map(s => [
      s.nis, s.nama, s.kelas, s.jenisKelamin || '', s.namaOrtu || '', s.noHpOrtu || '', 'AKTIF'
    ]);
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
  return jsonResponse({ success: true, message: students.length + ' siswa berhasil diimport.' });
}

function importTeachers(data) {
  const teachers = data.teachers || [];
  const sheet    = getSheet(SHEET_GURU);
  const lastRow  = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  if (teachers.length > 0) {
    const rows = teachers.map(t => [
      t.nig, t.nama, t.jabatan || '', t.mapel || '', t.jenisKelamin || '', t.tipe || 'Guru'
    ]);
    sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  }
  return jsonResponse({ success: true, message: teachers.length + ' guru/tendik berhasil diimport.' });
}

// ── SETUP AWAL (jalankan 1x setelah buat spreadsheet baru) ────
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const allSheets = [
    SHEET_SISWA, SHEET_GURU, SHEET_ABSEN_SISWA,
    SHEET_ABSEN_GURU, SHEET_KONFIGURASI, SHEET_DEVICE_TOKENS
  ];

  // Buat sheet yang belum ada
  allSheets.forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  // Headers
  ss.getSheetByName(SHEET_SISWA).getRange(1,1,1,7).setValues([[
    'NIS','Nama Lengkap','Kelas','Jenis Kelamin','Nama Orang Tua','No HP Orang Tua','Status'
  ]]);

  ss.getSheetByName(SHEET_GURU).getRange(1,1,1,6).setValues([[
    'NIG','Nama Lengkap','Jabatan','Mata Pelajaran','Jenis Kelamin','Tipe (Guru/TU/Tendik)'
  ]]);

  ss.getSheetByName(SHEET_ABSEN_SISWA).getRange(1,1,1,9).setValues([[
    'ID','Tanggal','NIS','Nama','Kelas','Jam Masuk','Status','Keterangan','Dicatat Oleh'
  ]]);

  ss.getSheetByName(SHEET_ABSEN_GURU).getRange(1,1,1,9).setValues([[
    'ID','Tanggal','NIG','Nama','Jam Masuk','Status Masuk','Jam Pulang','Status Pulang','Keterangan'
  ]]);

  const sheetKfg = ss.getSheetByName(SHEET_KONFIGURASI);
  sheetKfg.getRange(1,1,8,2).setValues([
    ['JAM_MASUK_SISWA','06:40'],
    ['TOLERANSI_SISWA','10'],
    ['JAM_MASUK_GURU','06:30'],
    ['TOLERANSI_GURU','15'],
    ['JAM_PULANG_GURU','15:30'],
    ['TAHUN_AJARAN','2026/2027'],
    ['SEMESTER','1'],
    ['NAMA_SEKOLAH','MTS Al Huda Putri Malang']
  ]);
  // Format kolom jam sebagai Plain Text agar tidak berubah jadi Date object
  sheetKfg.getRange('B1:B5').setNumberFormat('@STRING@');

  ss.getSheetByName(SHEET_DEVICE_TOKENS).getRange(1,1,1,5).setValues([[
    'Token','Nama Device','Lokasi','Tanggal Daftar','Status'
  ]]);

  // Hapus sheet default jika ada
  ['Sheet1','Lembar1','Sheet'].forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) try { ss.deleteSheet(s); } catch(e) {}
  });

  // Format header semua sheet
  allSheets.forEach(name => {
    const s = ss.getSheetByName(name);
    if (s && s.getLastColumn() > 0) {
      s.getRange(1, 1, 1, s.getLastColumn())
        .setBackground('#1a73e8')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
    }
  });

  SpreadsheetApp.getUi().alert(
    '✅ Setup Selesai!\n\n' +
    'Spreadsheet siap digunakan.\n' +
    'Langkah berikutnya:\n' +
    '1. Deploy Apps Script sebagai Web App\n' +
    '2. Salin URL ke file config.js\n' +
    '3. Buka aplikasi dan daftarkan HP scanner\n\n' +
    'Lihat SETUP.md untuk panduan lengkap.'
  );
}
