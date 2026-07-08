// ============================================================
// SISTEM PRESENSI MTS AL HUDA PUTRI MALANG
// Google Apps Script Backend API — Version 2.0.0
// ============================================================
// CHANGELOG v2.0:
//  - Autentikasi server-side (PIN tidak lagi di config.js)
//  - Session token menggunakan PropertiesService
//  - Multi-level user: TU / KEPSEK / WALI
//  - Audit Log untuk setiap perubahan data
//  - Perbaikan bug input manual siswa & guru
//  - Rekap laporan guru bulanan
//  - Manajemen hari libur / kalender akademik
//  - Format rekap wali kelas (tabel tanggal × nama)
//  - Edit data siswa & guru
//  - Arsip siswa (LULUS / PINDAH / DO)
//  - Cek hari libur saat scan
//  - Backup count sebelum import
// ============================================================

// ── NAMA SHEET ────────────────────────────────────────────────
const SHEET_SISWA         = 'DATA_SISWA';
const SHEET_GURU          = 'DATA_GURU';
const SHEET_ABSEN_SISWA   = 'ABSEN_SISWA';
const SHEET_ABSEN_GURU    = 'ABSEN_GURU';
const SHEET_KONFIGURASI   = 'KONFIGURASI';
const SHEET_DEVICE_TOKENS = 'DEVICE_TOKENS';
const SHEET_HARI_LIBUR    = 'HARI_LIBUR';
const SHEET_AUDIT_LOG     = 'AUDIT_LOG';
const TIMEZONE            = 'Asia/Jakarta';

// ── MAIN HANDLER POST ─────────────────────────────────────────
function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;

    // Action publik tidak butuh session
    const PUBLIC_ACTIONS = ['login', 'validate_session', 'scan']; // [BUG-06] register_device wajib login

    if (!PUBLIC_ACTIONS.includes(action)) {
      const role = _validateSession(data.sessionToken);
      if (!role) {
        return jsonResponse({ success: false, code: 'UNAUTHORIZED', message: 'Sesi tidak valid atau sudah habis. Silakan login kembali.' });
      }
      data._role = role;
    }

    // Scan wajib device token valid
    if (action === 'scan' && !validateToken(data.token)) {
      return jsonResponse({ success: false, code: 'INVALID_TOKEN', message: 'Device tidak terdaftar atau tidak aktif.' });
    }

    switch (action) {
      case 'login':               return doLogin(data);
      case 'validate_session':    return doValidateSession(data);
      case 'logout':              return doLogout(data);
      case 'scan':                return prosesAbsen(data);
      case 'register_device':     return registerDevice(data);
      case 'add_attendance':      return addAttendance(data);
      case 'add_attendance_guru': return addAttendanceGuru(data);
      case 'update_attendance':   return updateAttendance(data);
      case 'add_student':         return addStudent(data);
      case 'edit_student':        return editStudent(data);
      case 'archive_student':     return archiveStudent(data);
      case 'add_teacher':         return addTeacher(data);
      case 'edit_teacher':        return editTeacher(data);
      case 'delete_student':      return deleteStudent(data);
      case 'delete_teacher':      return deleteTeacher(data);
      case 'import_students':     return importStudents(data);
      case 'import_teachers':     return importTeachers(data);
      case 'deactivate_device':   return deactivateDevice(data);
      case 'update_config':       return updateConfig(data);
      case 'change_pin':          return changePin(data);
      case 'add_hari_libur':      return addHariLibur(data);
      case 'delete_hari_libur':   return deleteHariLibur(data);
      default: return jsonResponse({ success: false, message: 'Action tidak dikenal: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, message: 'Server error: ' + err.toString() });
  }
}

// ── MAIN HANDLER GET ──────────────────────────────────────────
function doGet(e) {
  try {
    const action       = e.parameter.action;
    const sessionToken = e.parameter.sessionToken;

    // GET publik
    const PUBLIC_GET = ['validate_device', 'login', 'validate_session'];
    if (!PUBLIC_GET.includes(action)) {
      const role = _validateSession(sessionToken);
      if (!role) {
        return jsonResponse({ success: false, code: 'UNAUTHORIZED', message: 'Sesi tidak valid.' });
      }
    }

    switch (action) {
      case 'login':             return doLogin({ pin: e.parameter.pin });
      case 'validate_session':  return doValidateSession({ sessionToken });
      case 'get_attendance':    return getAttendance(e.parameter);
      case 'get_students':      return getStudents();
      case 'get_teachers':      return getTeachers();
      case 'get_stats':         return getStats(e.parameter);
      case 'get_report':        return getReport(e.parameter);
      case 'get_report_guru':   return getReportGuru(e.parameter);
      case 'get_summary_wali':  return getSummaryWali(e.parameter);
      case 'get_config':        return getConfigResponse();
      case 'get_devices':       return getDevices();
      case 'validate_device':   return validateDeviceResponse(e.parameter.token);
      case 'get_absen_range':   return getAbsenRange(e.parameter);
      case 'get_hari_libur':    return getHariLibur();
      case 'get_audit_log':     return getAuditLog(e.parameter);
      default: return jsonResponse({ success: false, message: 'Action tidak dikenal: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, message: 'Server error: ' + err.toString() });
  }
}

// ── HELPERS DASAR ────────────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + name);
  return sheet;
}

function nowJakarta()   { return Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm:ss'); }
function todayJakarta() { return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'); }

function nowMinutes() {
  const jakartaTime = Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm');
  const [h, m] = jakartaTime.split(':').map(Number);
  return h * 60 + m;
}

function timeToMinutes(timeStr) {
  const [h, m] = String(timeStr).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── AUTENTIKASI ───────────────────────────────────────────────
function doLogin(data) {
  const config = getKonfigurasi();
  const pin    = String(data.pin || '');

  if (!pin) return jsonResponse({ success: false, message: 'PIN tidak boleh kosong.' });

  let role = null;
  if (pin === String(config['PIN_TU']     || '')) role = 'TU';
  else if (pin === String(config['PIN_KEPSEK'] || '')) role = 'KEPSEK';
  else if (pin === String(config['PIN_WALI']   || '')) role = 'WALI';

  if (!role) {
    _addAuditLog('LOGIN_GAGAL', 'AUTH', '', pin.length + ' digit pin salah', 'Unknown', '-');
    return jsonResponse({ success: false, message: 'PIN salah. Silakan coba lagi.' });
  }

  const token = _generateSessionToken();
  _storeSession(token, role);
  _addAuditLog('LOGIN', 'AUTH', '', '', role, role);

  return jsonResponse({ success: true, token, role });
}

function doValidateSession(data) {
  const role = _validateSession(data.sessionToken);
  if (!role) return jsonResponse({ success: false, valid: false });
  return jsonResponse({ success: true, valid: true, role });
}

function doLogout(data) {
  const role = _validateSession(data.sessionToken);
  if (role) _addAuditLog('LOGOUT', 'AUTH', '', '', role, role);
  _deleteSession(data.sessionToken);
  return jsonResponse({ success: true, message: 'Berhasil logout.' });
}

function changePin(data) {
  if (data._role !== 'TU') return jsonResponse({ success: false, message: 'Hanya TU yang dapat mengubah PIN.' });
  const sheet = getSheet(SHEET_KONFIGURASI);
  const rows  = sheet.getDataRange().getValues();
  const pinKey = data.pinKey; // PIN_TU, PIN_KEPSEK, PIN_WALI
  const VALID_KEYS = ['PIN_TU', 'PIN_KEPSEK', 'PIN_WALI'];
  if (!VALID_KEYS.includes(pinKey)) return jsonResponse({ success: false, message: 'Kunci PIN tidak valid.' });
  if (!data.newPin || data.newPin.length < 4) return jsonResponse({ success: false, message: 'PIN minimal 4 karakter.' });

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === pinKey) {
      sheet.getRange(i + 1, 2).setValue(String(data.newPin));
      _addAuditLog('CHANGE_PIN', pinKey, '***', '***', data._role, data._role);
      return jsonResponse({ success: true, message: 'PIN berhasil diubah.' });
    }
  }
  return jsonResponse({ success: false, message: 'Kunci PIN tidak ditemukan di KONFIGURASI.' });
}

function _generateSessionToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let t = 'ses_';
  for (let i = 0; i < 32; i++) t += chars.charAt(Math.floor(Math.random() * chars.length));
  return t;
}

function _storeSession(token, role) {
  const props    = PropertiesService.getScriptProperties();
  const sessions = JSON.parse(props.getProperty('mts_sessions') || '{}');
  const now      = Date.now();
  const EXPIRY   = 10 * 60 * 60 * 1000; // 10 jam
  // Bersihkan expired sessions
  for (const k in sessions) {
    if (now - sessions[k].created > EXPIRY) delete sessions[k];
  }
  sessions[token] = { role, created: now };
  props.setProperty('mts_sessions', JSON.stringify(sessions));
}

function _validateSession(token) {
  if (!token) return null;
  const props    = PropertiesService.getScriptProperties();
  const sessions = JSON.parse(props.getProperty('mts_sessions') || '{}');
  const session  = sessions[token];
  if (!session) return null;
  const EXPIRY = 10 * 60 * 60 * 1000;
  if (Date.now() - session.created > EXPIRY) {
    delete sessions[token];
    props.setProperty('mts_sessions', JSON.stringify(sessions));
    return null;
  }
  return session.role;
}

function _deleteSession(token) {
  if (!token) return;
  const props    = PropertiesService.getScriptProperties();
  const sessions = JSON.parse(props.getProperty('mts_sessions') || '{}');
  delete sessions[token];
  props.setProperty('mts_sessions', JSON.stringify(sessions));
}

// ── AUDIT LOG ────────────────────────────────────────────────
function _addAuditLog(action, target, oldVal, newVal, by, role) {
  try {
    const sheet = getSheet(SHEET_AUDIT_LOG);
    sheet.appendRow([
      todayJakarta(), nowJakarta(), action, String(target),
      String(oldVal).substring(0, 150), String(newVal).substring(0, 150),
      String(by), String(role)
    ]);
  } catch(e) { /* silent */ }
}

function getAuditLog(params) {
  const sheet  = getSheet(SHEET_AUDIT_LOG);
  const rows   = sheet.getDataRange().getValues();
  const limit  = parseInt(params.limit || '200');
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      result.push({
        tanggal: rows[i][0], jam: rows[i][1], aksi: rows[i][2],
        target: rows[i][3], sebelum: rows[i][4], sesudah: rows[i][5],
        oleh: rows[i][6], role: rows[i][7]
      });
    }
  }
  result.reverse();
  return jsonResponse({ success: true, data: result.slice(0, limit) });
}

// ── DEVICE TOKENS ─────────────────────────────────────────────
function validateToken(token) {
  if (!token) return false;
  const sheet = getSheet(SHEET_DEVICE_TOKENS);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(token) && data[i][4] === 'AKTIF') return true;
  }
  return false;
}

function validateDeviceResponse(token) {
  return jsonResponse({ success: true, valid: validateToken(token) });
}

function registerDevice(data) {
  // [BUG-06] Hanya TU yang boleh mendaftarkan perangkat — cek setelah session divalidasi di doPost
  if (data._role !== 'TU') {
    return jsonResponse({ success: false, code: 'UNAUTHORIZED', message: 'Hanya TU yang dapat mendaftarkan perangkat baru.' });
  }
  const sheet = getSheet(SHEET_DEVICE_TOKENS);
  const token = _generateDeviceToken();
  sheet.appendRow([token, data.name || 'HP Scanner', data.location || 'Pintu Masuk', todayJakarta(), 'AKTIF']);
  _addAuditLog('REGISTER_DEVICE', token, '', data.name || 'HP Scanner', data._role, data._role);
  return jsonResponse({ success: true, token, message: 'Device berhasil didaftarkan.' });
}

function _generateDeviceToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = 'MTS-';
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) r += '-';
    r += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return r;
}

function getDevices() {
  const sheet   = getSheet(SHEET_DEVICE_TOKENS);
  const data    = sheet.getDataRange().getValues();
  const devices = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      devices.push({ token: data[i][0], name: data[i][1], location: data[i][2], registered: data[i][3], status: data[i][4] });
    }
  }
  return jsonResponse({ success: true, data: devices });
}

function deactivateDevice(data) {
  const sheet = getSheet(SHEET_DEVICE_TOKENS);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.token)) {
      sheet.getRange(i + 1, 5).setValue('NONAKTIF');
      _addAuditLog('NONAKTIF_DEVICE', data.token, 'AKTIF', 'NONAKTIF', data._role, data._role);
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
    if (val instanceof Date) {
      val = String(val.getHours()).padStart(2,'0') + ':' + String(val.getMinutes()).padStart(2,'0');
    }
    config[row[0]] = val;
  });
  return config;
}

function getConfigResponse() {
  const config = getKonfigurasi();
  // JANGAN kirim PIN ke frontend
  const safe = Object.assign({}, config);
  delete safe['PIN_TU'];
  delete safe['PIN_KEPSEK'];
  delete safe['PIN_WALI'];
  return jsonResponse({ success: true, data: safe });
}

function updateConfig(data) {
  if (data._role !== 'TU') return jsonResponse({ success: false, message: 'Hanya TU yang dapat mengubah konfigurasi.' });
  const sheet   = getSheet(SHEET_KONFIGURASI);
  const rows    = sheet.getDataRange().getValues();
  const updates = data.updates || {};
  const PROTECTED = ['PIN_TU', 'PIN_KEPSEK', 'PIN_WALI']; // ubah PIN lewat change_pin

  for (let i = 0; i < rows.length; i++) {
    const key = rows[i][0];
    if (updates.hasOwnProperty(key) && !PROTECTED.includes(key)) {
      const oldVal = rows[i][1];
      sheet.getRange(i + 1, 2).setValue(updates[key]);
      _addAuditLog('UPDATE_CONFIG', key, oldVal, updates[key], data._role, data._role);
    }
  }
  return jsonResponse({ success: true, message: 'Konfigurasi berhasil diperbarui.' });
}

// ── HARI LIBUR ────────────────────────────────────────────────
function getHariLibur() {
  const sheet  = getSheet(SHEET_HARI_LIBUR);
  const rows   = sheet.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      result.push({ id: rows[i][0], tanggal: rows[i][1], keterangan: rows[i][2] });
    }
  }
  result.sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  return jsonResponse({ success: true, data: result });
}

function addHariLibur(data) {
  if (!data.tanggal) return jsonResponse({ success: false, message: 'Tanggal wajib diisi.' });
  // Cek duplikat
  const sheet = getSheet(SHEET_HARI_LIBUR);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === data.tanggal) {
      return jsonResponse({ success: false, message: 'Tanggal ' + data.tanggal + ' sudah terdaftar sebagai hari libur.' });
    }
  }
  const id = 'HL-' + new Date().getTime();
  sheet.appendRow([id, data.tanggal, data.keterangan || 'Hari Libur']);
  _addAuditLog('ADD_HARI_LIBUR', data.tanggal, '', data.keterangan, data._role, data._role);
  return jsonResponse({ success: true, message: 'Hari libur berhasil ditambahkan.' });
}

function deleteHariLibur(data) {
  const sheet = getSheet(SHEET_HARI_LIBUR);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      _addAuditLog('DELETE_HARI_LIBUR', rows[i][1], rows[i][2], '', data._role, data._role);
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true, message: 'Hari libur berhasil dihapus.' });
    }
  }
  return jsonResponse({ success: false, message: 'Data tidak ditemukan.' });
}

function _isHariLibur(tanggal) {
  try {
    const sheet = getSheet(SHEET_HARI_LIBUR);
    const rows  = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === tanggal) return String(rows[i][2] || 'Hari Libur');
    }
  } catch(e) {}
  return false;
}

function _getHariLiburSet(bulan) {
  const result = new Set();
  try {
    const sheet = getSheet(SHEET_HARI_LIBUR);
    const rows  = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (bulan ? String(rows[i][1]).startsWith(bulan) : rows[i][1]) {
        result.add(rows[i][1]);
      }
    }
  } catch(e) {}
  return result;
}

// ── PROSES ABSEN (INTI SISTEM) ────────────────────────────────
function prosesAbsen(data) {
  const qrCode  = (data.qrCode || '').trim();
  const config  = getKonfigurasi();
  const tanggal = todayJakarta();

  // Cek hari libur
  const liburInfo = _isHariLibur(tanggal);
  if (liburInfo) {
    return jsonResponse({ success: false, code: 'HARI_LIBUR', message: 'Hari ini libur: ' + liburInfo + '. Tidak ada pencatatan absensi.' });
  }

  // [BUG-07] Cek hari Minggu — pakai getDay() via Date agar tidak bergantung locale server
  const jakartaDateStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const jakartaDate    = new Date(jakartaDateStr + 'T12:00:00+07:00');
  if (jakartaDate.getDay() === 0) {
    return jsonResponse({ success: false, code: 'HARI_LIBUR', message: 'Hari ini Minggu. Tidak ada pencatatan absensi.' });
  }

  // [BUG-04] Gunakan clientTimestamp jika ada dan masih valid (dalam 1 jam)
  let jamMenitSekarang, jamStr;
  if (data.clientTimestamp) {
    const clientDate = new Date(data.clientTimestamp);
    const diffMs     = Math.abs(Date.now() - clientDate.getTime());
    if (diffMs <= 60 * 60 * 1000) {
      jamStr           = Utilities.formatDate(clientDate, TIMEZONE, 'HH:mm:ss');
      const h          = parseInt(Utilities.formatDate(clientDate, TIMEZONE, 'HH'));
      const m          = parseInt(Utilities.formatDate(clientDate, TIMEZONE, 'mm'));
      jamMenitSekarang = h * 60 + m;
    }
  }
  if (!jamStr) {
    jamMenitSekarang = nowMinutes();
    jamStr           = nowJakarta();
  }

  if (qrCode.startsWith('MTS-S-')) {
    return _absenSiswa(qrCode, tanggal, jamMenitSekarang, jamStr, config, data);
  } else if (qrCode.startsWith('MTS-G-') || qrCode.startsWith('MTS-TU-')) {
    return _absenGuru(qrCode, tanggal, jamMenitSekarang, jamStr, config, data);
  } else {
    return jsonResponse({ success: false, code: 'UNKNOWN_QR', message: 'Format QR Code tidak dikenal.' });
  }
}

function _absenSiswa(qrCode, tanggal, jamMenit, jamStr, config, reqData) {
  // [BUG-02] LockService mencegah race condition jika 2 request datang bersamaan
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {
    return jsonResponse({ success: false, message: 'Server sibuk, coba lagi dalam beberapa detik.' });
  }
  try {
    const nis        = qrCode.replace('MTS-S-', '');
    const sheetSiswa = getSheet(SHEET_SISWA);
    const rows       = sheetSiswa.getDataRange().getValues();
    let siswa        = null;

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(nis) && rows[i][6] !== 'NONAKTIF' && rows[i][6] !== 'LULUS' && rows[i][6] !== 'PINDAH' && rows[i][6] !== 'DO') {
        siswa = { nis: rows[i][0], nama: rows[i][1], kelas: rows[i][2], jenisKelamin: rows[i][3] };
        break;
      }
    }

    if (!siswa) {
      return jsonResponse({ success: false, code: 'NOT_FOUND', message: 'NIS ' + nis + ' tidak ditemukan atau sudah tidak aktif.' });
    }

    const sheetAbsen = getSheet(SHEET_ABSEN_SISWA);
    const absenRows  = sheetAbsen.getDataRange().getValues();
    for (let i = 1; i < absenRows.length; i++) {
      if (String(absenRows[i][2]) === String(nis) && absenRows[i][1] === tanggal) {
        return jsonResponse({
          success: false, code: 'DUPLICATE',
          message: siswa.nama + ' sudah tercatat hadir pukul ' + absenRows[i][5],
          siswa
        });
      }
    }

    const jamMasuk  = timeToMinutes(config['JAM_MASUK_SISWA'] || '06:40');
    const toleransi = parseInt(config['TOLERANSI_SISWA'] || '10');
    const status    = jamMenit <= (jamMasuk + toleransi) ? 'HADIR' : 'TERLAMBAT';

    const id = 'S' + new Date().getTime();
    sheetAbsen.appendRow([id, tanggal, siswa.nis, siswa.nama, siswa.kelas, jamStr, status, '', reqData.scannedBy || 'Scanner']);

    return jsonResponse({ success: true, type: 'siswa', siswa, status, jam: jamStr, tanggal });
  } finally {
    lock.releaseLock();
  }
}

function _absenGuru(qrCode, tanggal, jamMenit, jamStr, config, reqData) {
  // [BUG-02] LockService mencegah race condition jika 2 request datang bersamaan
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {
    return jsonResponse({ success: false, message: 'Server sibuk, coba lagi dalam beberapa detik.' });
  }
  try {
    const nig       = qrCode.replace('MTS-G-', '').replace('MTS-TU-', '');
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

    let existingRowIdx = -1;
    let existingData   = null;
    for (let i = 1; i < absenRows.length; i++) {
      if (String(absenRows[i][2]) === String(nig) && absenRows[i][1] === tanggal) {
        existingRowIdx = i + 1;
        existingData   = absenRows[i];
        break;
      }
    }

    if (existingRowIdx > 0) {
      if (existingData[6] && existingData[6] !== '') {
        return jsonResponse({
          success: false, code: 'DUPLICATE',
          message: guru.nama + ' sudah tercatat masuk ' + existingData[4] + ' dan pulang ' + existingData[6],
          guru
        });
      }
      // [MED-04] Validasi waktu minimum kerja — guru tidak bisa pulang dalam 4 jam pertama
      const jamMasukMenit    = timeToMinutes(String(existingData[4]).substring(0, 5));
      const MINIMUM_KERJA    = 4 * 60; // 4 jam dalam menit
      if ((jamMenit - jamMasukMenit) < MINIMUM_KERJA) {
        const minJam = Math.floor((jamMasukMenit + MINIMUM_KERJA) / 60);
        const minMnt = (jamMasukMenit + MINIMUM_KERJA) % 60;
        const pulangMinStr = String(minJam).padStart(2, '0') + ':' + String(minMnt).padStart(2, '0');
        return jsonResponse({
          success: false, code: 'TOO_EARLY',
          message: guru.nama + ' baru masuk ' + existingData[4] + '. Pulang minimal pukul ' + pulangMinStr + '.',
          guru
        });
      }
      const jamPulang    = timeToMinutes(config['JAM_PULANG_GURU'] || '15:30');
      const statusPulang = jamMenit >= jamPulang ? 'TEPAT_WAKTU' : 'PULANG_AWAL';
      sheetAbsen.getRange(existingRowIdx, 7).setValue(jamStr);
      sheetAbsen.getRange(existingRowIdx, 8).setValue(statusPulang);
      return jsonResponse({ success: true, type: 'guru_pulang', guru, status: statusPulang, jam: jamStr, tanggal });
    }

    const jamMasuk  = timeToMinutes(config['JAM_MASUK_GURU'] || '06:30');
    const toleransi = parseInt(config['TOLERANSI_GURU'] || '15');
    const status    = jamMenit <= (jamMasuk + toleransi) ? 'HADIR' : 'TERLAMBAT';

    const id = 'G' + new Date().getTime();
    sheetAbsen.appendRow([id, tanggal, guru.nig, guru.nama, jamStr, status, '', '', '']);

    return jsonResponse({ success: true, type: 'guru_masuk', guru, status, jam: jamStr, tanggal });
  } finally {
    lock.releaseLock();
  }
}

// ── INPUT MANUAL (BUGFIX + BARU) ──────────────────────────────
function addAttendance(data) {
  // Tambah/update record absensi siswa secara manual
  const tanggal    = data.tanggal || todayJakarta();
  const nis        = String(data.nis || '');
  const sheetAbsen = getSheet(SHEET_ABSEN_SISWA);
  const absenRows  = sheetAbsen.getDataRange().getValues();

  // Cek apakah sudah ada record → update
  for (let i = 1; i < absenRows.length; i++) {
    if (String(absenRows[i][2]) === nis && absenRows[i][1] === tanggal) {
      const oldStatus = absenRows[i][6];
      if (data.status)                 sheetAbsen.getRange(i + 1, 7).setValue(data.status);
      if (data.keterangan !== undefined) sheetAbsen.getRange(i + 1, 8).setValue(data.keterangan);
      _addAuditLog('UPDATE_ABSEN_SISWA', nis + '@' + tanggal, oldStatus, data.status, data._role, data._role);
      return jsonResponse({ success: true, updated: true, message: 'Absensi siswa berhasil diperbarui.' });
    }
  }

  // Belum ada → buat record baru
  const sheetSiswa = getSheet(SHEET_SISWA);
  const siswaRows  = sheetSiswa.getDataRange().getValues();
  let siswa = null;
  for (let i = 1; i < siswaRows.length; i++) {
    if (String(siswaRows[i][0]) === nis) {
      siswa = { nis: siswaRows[i][0], nama: siswaRows[i][1], kelas: siswaRows[i][2] };
      break;
    }
  }

  // Fallback: pakai data dari request jika tidak ada di sheet
  if (!siswa && data.nama) {
    siswa = { nis: nis, nama: data.nama, kelas: data.kelas || '' };
  }

  if (!siswa) return jsonResponse({ success: false, message: 'NIS ' + nis + ' tidak ditemukan.' });

  const id  = 'M' + new Date().getTime();
  const jam = data.jam || nowJakarta();
  sheetAbsen.appendRow([
    id, tanggal, siswa.nis, siswa.nama, siswa.kelas,
    jam, data.status || 'HADIR', data.keterangan || '', (data._role || 'TU') + ' (Manual)'
  ]);
  _addAuditLog('ADD_ABSEN_SISWA_MANUAL', nis + '@' + tanggal, 'Belum Absen', data.status, data._role, data._role);
  return jsonResponse({ success: true, created: true, message: 'Absensi manual siswa berhasil disimpan.' });
}

function addAttendanceGuru(data) {
  // Tambah/update record absensi guru secara manual
  const tanggal    = data.tanggal || todayJakarta();
  const nig        = String(data.nig || '');
  const sheetAbsen = getSheet(SHEET_ABSEN_GURU);
  const absenRows  = sheetAbsen.getDataRange().getValues();

  // Cek apakah sudah ada → update
  for (let i = 1; i < absenRows.length; i++) {
    if (String(absenRows[i][2]) === nig && absenRows[i][1] === tanggal) {
      const oldStatus = absenRows[i][5];
      if (data.statusMasuk)            sheetAbsen.getRange(i + 1, 6).setValue(data.statusMasuk);
      if (data.keterangan !== undefined) sheetAbsen.getRange(i + 1, 9).setValue(data.keterangan);
      _addAuditLog('UPDATE_ABSEN_GURU', nig + '@' + tanggal, oldStatus, data.statusMasuk, data._role, data._role);
      return jsonResponse({ success: true, updated: true, message: 'Absensi guru berhasil diperbarui.' });
    }
  }

  // Buat record baru
  const sheetGuru = getSheet(SHEET_GURU);
  const guruRows  = sheetGuru.getDataRange().getValues();
  let guru = null;
  for (let i = 1; i < guruRows.length; i++) {
    if (String(guruRows[i][0]) === nig) {
      guru = { nig: guruRows[i][0], nama: guruRows[i][1] };
      break;
    }
  }

  if (!guru && data.nama) guru = { nig: nig, nama: data.nama };
  if (!guru) return jsonResponse({ success: false, message: 'NIG ' + nig + ' tidak ditemukan.' });

  const id  = 'GM' + new Date().getTime();
  const jam = data.jam || nowJakarta();
  sheetAbsen.appendRow([
    id, tanggal, guru.nig, guru.nama,
    jam, data.statusMasuk || 'HADIR', '', '', data.keterangan || ''
  ]);
  _addAuditLog('ADD_ABSEN_GURU_MANUAL', nig + '@' + tanggal, 'Belum Absen', data.statusMasuk, data._role, data._role);
  return jsonResponse({ success: true, created: true, message: 'Absensi manual guru berhasil disimpan.' });
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
  const tanggal   = params.tanggal || todayJakarta();
  const kelas     = params.kelas   || '';
  const hariLibur = _isHariLibur(tanggal);

  const sheetS     = getSheet(SHEET_ABSEN_SISWA);
  const rowsS      = sheetS.getDataRange().getValues();
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

  const sheetG    = getSheet(SHEET_ABSEN_GURU);
  const rowsG     = sheetG.getDataRange().getValues();
  const absenGuru = [];
  for (let i = 1; i < rowsG.length; i++) {
    if (rowsG[i][1] === tanggal) {
      absenGuru.push({
        id: rowsG[i][0], tanggal: rowsG[i][1], nig: rowsG[i][2],
        nama: rowsG[i][3], jamMasuk: rowsG[i][4], statusMasuk: rowsG[i][5],
        jamPulang: rowsG[i][6], statusPulang: rowsG[i][7], keterangan: rowsG[i][8]
      });
    }
  }

  return jsonResponse({ success: true, tanggal, siswa: absenSiswa, guru: absenGuru, hariLibur });
}

function getStats(params) {
  const tanggal   = params.tanggal || todayJakarta();
  const hariLibur = _isHariLibur(tanggal);

  const sheetSiswaAll = getSheet(SHEET_SISWA);
  const rowsSiswaAll  = sheetSiswaAll.getDataRange().getValues();
  let totalSiswa = 0;
  for (let i = 1; i < rowsSiswaAll.length; i++) {
    if (rowsSiswaAll[i][0] && rowsSiswaAll[i][6] === 'AKTIF') totalSiswa++;
  }

  // [MED-03] Hitung total guru yang aktif (ada NIG), bukan sekadar jumlah baris
  const sheetGuruAll = getSheet(SHEET_GURU);
  const rowsGuruAll  = sheetGuruAll.getDataRange().getValues();
  let totalGuru = 0;
  for (let i = 1; i < rowsGuruAll.length; i++) {
    if (rowsGuruAll[i][0]) totalGuru++;
  }

  const rowsS = getSheet(SHEET_ABSEN_SISWA).getDataRange().getValues();
  let hadirS = 0, terlambatS = 0, izinS = 0, sakitS = 0, alpaS = 0;
  for (let i = 1; i < rowsS.length; i++) {
    if (rowsS[i][1] !== tanggal) continue;
    if (rowsS[i][6] === 'HADIR')     hadirS++;
    if (rowsS[i][6] === 'TERLAMBAT') terlambatS++;
    if (rowsS[i][6] === 'IZIN')      izinS++;
    if (rowsS[i][6] === 'SAKIT')     sakitS++;
    if (rowsS[i][6] === 'ALPA')      alpaS++;
  }

  const rowsG = getSheet(SHEET_ABSEN_GURU).getDataRange().getValues();
  let hadirG = 0, terlambatG = 0, izinG = 0, sakitG = 0;
  for (let i = 1; i < rowsG.length; i++) {
    if (rowsG[i][1] !== tanggal) continue;
    if (rowsG[i][5] === 'HADIR')     hadirG++;
    if (rowsG[i][5] === 'TERLAMBAT') terlambatG++;
    if (rowsG[i][5] === 'IZIN')      izinG++;
    if (rowsG[i][5] === 'SAKIT')     sakitG++;
  }

  const sudahAbsenS = hadirS + terlambatS + izinS + sakitS + alpaS;
  const sudahAbsenG = hadirG + terlambatG + izinG + sakitG;

  return jsonResponse({
    success: true, tanggal, hariLibur,
    siswa: {
      total: totalSiswa, hadir: hadirS, terlambat: terlambatS,
      izin: izinS, sakit: sakitS, alpa: alpaS,
      belumAbsen: Math.max(0, totalSiswa - sudahAbsenS),
      persen: totalSiswa > 0 ? Math.round((hadirS + terlambatS) / totalSiswa * 100) : 0
    },
    guru: {
      total: totalGuru, hadir: hadirG, terlambat: terlambatG,
      izin: izinG, sakit: sakitG,
      belumAbsen: Math.max(0, totalGuru - sudahAbsenG),
      persen: totalGuru > 0 ? Math.round((hadirG + terlambatG) / totalGuru * 100) : 0
    }
  });
}

function getReport(params) {
  const bulan      = params.bulan;
  const kelas      = params.kelas || '';
  if (!bulan) return jsonResponse({ success: false, message: 'Parameter bulan diperlukan (format: YYYY-MM).' });

  const hariLiburSet = _getHariLiburSet(bulan);
  const rowsSiswa    = getSheet(SHEET_SISWA).getDataRange().getValues();
  const rowsAbsen    = getSheet(SHEET_ABSEN_SISWA).getDataRange().getValues();

  const report = {};
  for (let i = 1; i < rowsSiswa.length; i++) {
    const nis = String(rowsSiswa[i][0]);
    if (!nis) continue;
    if (kelas && rowsSiswa[i][2] !== kelas) continue;
    if (rowsSiswa[i][6] === 'NONAKTIF') continue;
    report[nis] = { nis, nama: rowsSiswa[i][1], kelas: rowsSiswa[i][2], status: rowsSiswa[i][6] || 'AKTIF', hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0 };
  }

  for (let i = 1; i < rowsAbsen.length; i++) {
    const tgl = String(rowsAbsen[i][1]);
    if (!tgl.startsWith(bulan)) continue;
    if (hariLiburSet.has(tgl)) continue;
    const nis    = String(rowsAbsen[i][2]);
    const status = rowsAbsen[i][6];
    if (!report[nis]) continue;
    if      (status === 'HADIR')     report[nis].hadir++;
    else if (status === 'TERLAMBAT') report[nis].terlambat++;
    else if (status === 'IZIN')      report[nis].izin++;
    else if (status === 'SAKIT')     report[nis].sakit++;
    else if (status === 'ALPA')      report[nis].alpa++;
  }

  return jsonResponse({ success: true, bulan, hariLibur: Array.from(hariLiburSet), data: Object.values(report) });
}

function getReportGuru(params) {
  const bulan = params.bulan;
  if (!bulan) return jsonResponse({ success: false, message: 'Parameter bulan diperlukan.' });

  const rowsGuru  = getSheet(SHEET_GURU).getDataRange().getValues();
  const rowsAbsen = getSheet(SHEET_ABSEN_GURU).getDataRange().getValues();
  const hariLiburSet = _getHariLiburSet(bulan);

  const report = {};
  for (let i = 1; i < rowsGuru.length; i++) {
    const nig = String(rowsGuru[i][0]);
    if (!nig) continue;
    report[nig] = {
      nig, nama: rowsGuru[i][1], jabatan: rowsGuru[i][2],
      tipe: rowsGuru[i][5] || 'Guru',
      hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0, pulangAwal: 0
    };
  }

  for (let i = 1; i < rowsAbsen.length; i++) {
    const tgl = String(rowsAbsen[i][1]);
    if (!tgl.startsWith(bulan)) continue;
    if (hariLiburSet.has(tgl)) continue;
    const nig          = String(rowsAbsen[i][2]);
    const status       = rowsAbsen[i][5];
    const statusPulang = rowsAbsen[i][7];
    if (!report[nig]) continue;
    if      (status === 'HADIR')     report[nig].hadir++;
    else if (status === 'TERLAMBAT') report[nig].terlambat++;
    else if (status === 'IZIN')      report[nig].izin++;
    else if (status === 'SAKIT')     report[nig].sakit++;
    else if (status === 'ALPA')      report[nig].alpa++;
    if (statusPulang === 'PULANG_AWAL') report[nig].pulangAwal++;
  }

  return jsonResponse({ success: true, bulan, data: Object.values(report) });
}

function getSummaryWali(params) {
  // Format tabel: baris = siswa, kolom = tanggal (untuk rekap wali kelas)
  const bulan = params.bulan;
  const kelas = params.kelas || '';
  if (!bulan) return jsonResponse({ success: false, message: 'Parameter bulan diperlukan.' });

  const rowsSiswa = getSheet(SHEET_SISWA).getDataRange().getValues();
  const rowsAbsen = getSheet(SHEET_ABSEN_SISWA).getDataRange().getValues();
  const hariLiburSet = _getHariLiburSet(bulan);

  const siswaList = [];
  for (let i = 1; i < rowsSiswa.length; i++) {
    if (!rowsSiswa[i][0]) continue;
    if (kelas && rowsSiswa[i][2] !== kelas) continue;
    if (rowsSiswa[i][6] === 'NONAKTIF') continue;
    siswaList.push({ nis: String(rowsSiswa[i][0]), nama: rowsSiswa[i][1], kelas: rowsSiswa[i][2] });
  }

  const dateSet  = new Set();
  const absenMap = {}; // key: "nis_tanggal"
  for (let i = 1; i < rowsAbsen.length; i++) {
    const tgl = String(rowsAbsen[i][1]);
    if (!tgl.startsWith(bulan)) continue;
    if (hariLiburSet.has(tgl)) continue;
    dateSet.add(tgl);
    const nis = String(rowsAbsen[i][2]);
    absenMap[nis + '_' + tgl] = rowsAbsen[i][6];
  }

  const dates = Array.from(dateSet).sort();
  return jsonResponse({ success: true, bulan, kelas, siswaList, dates, absenMap, hariLiburSet: Array.from(hariLiburSet) });
}

function getAbsenRange(params) {
  const dari   = params.dari;
  const sampai = params.sampai;
  const tipe   = params.tipe || 'siswa';

  const sheet  = getSheet(tipe === 'guru' ? SHEET_ABSEN_GURU : SHEET_ABSEN_SISWA);
  const rows   = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    const tgl = rows[i][1];
    if (dari   && tgl < dari)   continue;
    if (sampai && tgl > sampai) continue;
    if (tipe === 'siswa') {
      result.push({ id: rows[i][0], tanggal: rows[i][1], nis: rows[i][2], nama: rows[i][3], kelas: rows[i][4], jamMasuk: rows[i][5], status: rows[i][6], keterangan: rows[i][7] });
    } else {
      result.push({ id: rows[i][0], tanggal: rows[i][1], nig: rows[i][2], nama: rows[i][3], jamMasuk: rows[i][4], statusMasuk: rows[i][5], jamPulang: rows[i][6], statusPulang: rows[i][7], keterangan: rows[i][8] });
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
      const oldStatus = data.tipe === 'guru' ? rows[i][5] : rows[i][6];
      if (data.tipe === 'guru') {
        if (data.statusMasuk)            sheet.getRange(i + 1, 6).setValue(data.statusMasuk);
        if (data.keterangan !== undefined) sheet.getRange(i + 1, 9).setValue(data.keterangan);
      } else {
        if (data.status)                 sheet.getRange(i + 1, 7).setValue(data.status);
        if (data.keterangan !== undefined) sheet.getRange(i + 1, 8).setValue(data.keterangan);
      }
      _addAuditLog('UPDATE_ABSEN', rows[i][2] + '@' + rows[i][1], oldStatus, data.status || data.statusMasuk, data._role, data._role);
      return jsonResponse({ success: true, message: 'Data absen berhasil diperbarui.' });
    }
  }
  return jsonResponse({ success: false, message: 'Data tidak ditemukan.' });
}

function addStudent(data) {
  if (!data.nis || !data.nama) return jsonResponse({ success: false, message: 'NIS dan Nama wajib diisi.' });
  const sheet = getSheet(SHEET_SISWA);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      return jsonResponse({ success: false, message: 'NIS ' + data.nis + ' sudah ada.' });
    }
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setNumberFormat("@").setValues([[data.nis, data.nama, data.kelas || '', data.jenisKelamin || '', data.namaOrtu || '', data.noHpOrtu || '', 'AKTIF']]);
  _addAuditLog('ADD_SISWA', String(data.nis), '', data.nama, data._role, data._role);
  return jsonResponse({ success: true, message: 'Siswa berhasil ditambahkan.' });
}

function editStudent(data) {
  const sheet = getSheet(SHEET_SISWA);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      const oldNama = rows[i][1];
      sheet.getRange(i + 1, 1, 1, 7).setNumberFormat("@").setValues([[
        data.nis,
        data.nama         || rows[i][1],
        data.kelas        || rows[i][2],
        data.jenisKelamin || rows[i][3],
        data.namaOrtu     || rows[i][4],
        data.noHpOrtu     || rows[i][5],
        rows[i][6]
      ]]);
      _addAuditLog('EDIT_SISWA', String(data.nis), oldNama, data.nama, data._role, data._role);
      return jsonResponse({ success: true, message: 'Data siswa berhasil diperbarui.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIS tidak ditemukan.' });
}

function archiveStudent(data) {
  const VALID_STATUSES = ['LULUS', 'PINDAH', 'DO', 'NONAKTIF', 'AKTIF'];
  const newStatus = data.archiveStatus || 'LULUS';
  if (!VALID_STATUSES.includes(newStatus)) return jsonResponse({ success: false, message: 'Status tidak valid.' });

  const sheet = getSheet(SHEET_SISWA);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      const oldStatus = rows[i][6];
      sheet.getRange(i + 1, 7).setValue(newStatus);
      _addAuditLog('ARCHIVE_SISWA', String(data.nis), oldStatus, newStatus, data._role, data._role);
      return jsonResponse({ success: true, message: 'Status siswa diubah menjadi ' + newStatus + '.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIS tidak ditemukan.' });
}

function deleteStudent(data) {
  const sheet = getSheet(SHEET_SISWA);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      _addAuditLog('DELETE_SISWA', String(data.nis), rows[i][1], '', data._role, data._role);
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true, message: 'Siswa berhasil dihapus.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIS tidak ditemukan.' });
}

function addTeacher(data) {
  if (!data.nig || !data.nama) return jsonResponse({ success: false, message: 'NIG dan Nama wajib diisi.' });
  const sheet = getSheet(SHEET_GURU);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nig)) {
      return jsonResponse({ success: false, message: 'NIG ' + data.nig + ' sudah ada.' });
    }
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setNumberFormat("@").setValues([[data.nig, data.nama, data.jabatan || '', data.mapel || '', data.jenisKelamin || '', data.tipe || 'Guru']]);
  _addAuditLog('ADD_GURU', String(data.nig), '', data.nama, data._role, data._role);
  return jsonResponse({ success: true, message: 'Guru/Tendik berhasil ditambahkan.' });
}

function editTeacher(data) {
  const sheet = getSheet(SHEET_GURU);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nig)) {
      const oldNama = rows[i][1];
      sheet.getRange(i + 1, 1, 1, 6).setNumberFormat("@").setValues([[
        data.nig,
        data.nama         || rows[i][1],
        data.jabatan      || rows[i][2],
        data.mapel        || rows[i][3],
        data.jenisKelamin || rows[i][4],
        data.tipe         || rows[i][5]
      ]]);
      _addAuditLog('EDIT_GURU', String(data.nig), oldNama, data.nama, data._role, data._role);
      return jsonResponse({ success: true, message: 'Data guru berhasil diperbarui.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIG tidak ditemukan.' });
}

function deleteTeacher(data) {
  const sheet = getSheet(SHEET_GURU);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nig)) {
      _addAuditLog('DELETE_GURU', String(data.nig), rows[i][1], '', data._role, data._role);
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true, message: 'Guru/Tendik berhasil dihapus.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIG tidak ditemukan.' });
}

function importStudents(data) {
  const students = data.students || [];

  // [BUG-08] Validasi DULU sebelum menghapus data apapun
  if (!students || students.length === 0) {
    return jsonResponse({ success: false, message: 'Data import kosong. Tidak ada perubahan.' });
  }
  const validStudents = students.filter(s => s.nis && s.nama);
  if (validStudents.length === 0) {
    return jsonResponse({ success: false, message: 'Tidak ada data valid (NIS dan Nama wajib ada). Import dibatalkan.' });
  }
  if (validStudents.length < students.length * 0.5) {
    return jsonResponse({ success: false,
      message: 'Terlalu banyak data tidak valid (' + (students.length - validStudents.length) + ' baris kosong). Periksa format file Excel.' });
  }

  const sheet    = getSheet(SHEET_SISWA);
  const lastRow  = sheet.getLastRow();
  const existingCount = lastRow > 1 ? lastRow - 1 : 0;

  // Baru hapus setelah semua validasi lolos
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  const rows = validStudents.map(s => [
    s.nis, s.nama, s.kelas, s.jenisKelamin || '', s.namaOrtu || '', s.noHpOrtu || '', 'AKTIF'
  ]);
  sheet.getRange(2, 1, rows.length, 7).setNumberFormat("@").setValues(rows);

  _addAuditLog('IMPORT_SISWA', 'ALL', existingCount + ' records', validStudents.length + ' records', data._role, data._role);
  return jsonResponse({ success: true, message: validStudents.length + ' siswa berhasil diimport. Data lama (' + existingCount + ' siswa) telah diganti.' });
}

function importTeachers(data) {
  const teachers = data.teachers || [];

  // [BUG-08] Validasi DULU sebelum menghapus data apapun
  if (!teachers || teachers.length === 0) {
    return jsonResponse({ success: false, message: 'Data import kosong. Tidak ada perubahan.' });
  }
  const validTeachers = teachers.filter(t => t.nig && t.nama);
  if (validTeachers.length === 0) {
    return jsonResponse({ success: false, message: 'Tidak ada data valid (NIG dan Nama wajib ada). Import dibatalkan.' });
  }
  if (validTeachers.length < teachers.length * 0.5) {
    return jsonResponse({ success: false,
      message: 'Terlalu banyak data tidak valid (' + (teachers.length - validTeachers.length) + ' baris kosong). Periksa format file Excel.' });
  }

  const sheet    = getSheet(SHEET_GURU);
  const lastRow  = sheet.getLastRow();
  const existingCount = lastRow > 1 ? lastRow - 1 : 0;

  // Baru hapus setelah semua validasi lolos
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  const rows = validTeachers.map(t => [
    t.nig, t.nama, t.jabatan || '', t.mapel || '', t.jenisKelamin || '', t.tipe || 'Guru'
  ]);
  sheet.getRange(2, 1, rows.length, 6).setNumberFormat("@").setValues(rows);

  _addAuditLog('IMPORT_GURU', 'ALL', existingCount + ' records', validTeachers.length + ' records', data._role, data._role);
  return jsonResponse({ success: true, message: validTeachers.length + ' guru/tendik berhasil diimport.' });
}

// ── SETUP AWAL ────────────────────────────────────────────────
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const allSheets = [
    SHEET_SISWA, SHEET_GURU, SHEET_ABSEN_SISWA, SHEET_ABSEN_GURU,
    SHEET_KONFIGURASI, SHEET_DEVICE_TOKENS, SHEET_HARI_LIBUR, SHEET_AUDIT_LOG
  ];

  allSheets.forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  // ── Headers ──
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
  ss.getSheetByName(SHEET_HARI_LIBUR).getRange(1,1,1,3).setValues([[
    'ID','Tanggal','Keterangan'
  ]]);
  ss.getSheetByName(SHEET_AUDIT_LOG).getRange(1,1,1,8).setValues([[
    'Tanggal','Jam','Aksi','Target','Sebelum','Sesudah','Oleh','Role'
  ]]);
  ss.getSheetByName(SHEET_DEVICE_TOKENS).getRange(1,1,1,5).setValues([[
    'Token','Nama Device','Lokasi','Tanggal Daftar','Status'
  ]]);

  // ── Konfigurasi (v2.0 — PIN ada di sini, bukan di config.js!) ──
  const sheetKfg = ss.getSheetByName(SHEET_KONFIGURASI);
  sheetKfg.getRange(1,1,14,2).setValues([
    ['JAM_MASUK_SISWA','06:40'],
    ['TOLERANSI_SISWA','10'],
    ['JAM_MASUK_GURU','06:30'],
    ['TOLERANSI_GURU','15'],
    ['JAM_PULANG_GURU','15:30'],
    ['TAHUN_AJARAN','2026/2027'],
    ['SEMESTER','1'],
    ['NAMA_SEKOLAH','MTS Al Huda Putri Malang'],
    ['PIN_TU','admin123'],       // ← GANTI SETELAH SETUP!
    ['PIN_KEPSEK','kepsek123'],  // ← GANTI SETELAH SETUP!
    ['PIN_WALI','wali123'],      // ← GANTI SETELAH SETUP!
    ['WALI_KELAS_VII',''],       // contoh: isi nama wali kelas
    ['WALI_KELAS_VIII',''],
    ['WALI_KELAS_IX','']
  ]);
  sheetKfg.getRange('B1:B5').setNumberFormat('@STRING@');
  // Proteksi baris PIN agar tidak terlihat di spreadsheet default
  sheetKfg.getRange('B9:B11').setFontColor('#cccccc');

  // ── Hapus sheet default ──
  ['Sheet1','Lembar1','Sheet'].forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) try { ss.deleteSheet(s); } catch(e) {}
  });

  // ── Format header biru ──
  allSheets.forEach(name => {
    const s = ss.getSheetByName(name);
    if (s && s.getLastColumn() > 0) {
      s.getRange(1, 1, 1, s.getLastColumn())
        .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
    }
  });

  SpreadsheetApp.getUi().alert(
    '✅ Setup Selesai! (v2.0)\n\n' +
    '⚠️ LANGKAH PENTING — Ganti PIN default segera!\n' +
    'Buka sheet KONFIGURASI dan ubah baris:\n' +
    '  PIN_TU      → ganti dari "admin123"\n' +
    '  PIN_KEPSEK  → ganti dari "kepsek123"\n' +
    '  PIN_WALI    → ganti dari "wali123"\n\n' +
    'Langkah selanjutnya:\n' +
    '1. Ganti semua PIN di sheet KONFIGURASI\n' +
    '2. Deploy Apps Script sebagai Web App\n' +
    '3. Salin URL ke file assets/js/config.js\n' +
    '4. Buka dashboard dan login\n\n' +
    'Lihat SETUP.md untuk panduan lengkap.'
  );
}
