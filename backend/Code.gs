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
const CACHE               = CacheService.getScriptCache();

// ── CACHE HELPERS (gratis, bawaan Apps Script — CacheService) ──
// TTL efektif diperpanjang otomatis selama masih ada aktivitas (di-re-put
// tiap kali dibaca ulang setelah update), jadi bertahan sepanjang jam
// sekolah walau batas maksimum CacheService cuma 6 jam per put().
function _cacheGet(key) {
  try { const v = CACHE.get(key); return v ? JSON.parse(v) : null; } catch(e) { return null; }
}
function _cacheSet(key, value, ttlSec) {
  try { CACHE.put(key, JSON.stringify(value), ttlSec); } catch(e) { /* value terlalu besar/cache penuh -> fallback baca sheet */ }
}
function _cacheRemove(key) {
  try { CACHE.remove(key); } catch(e) {}
}

// ── ROLE HELPER ─────────────────────────────────────────────────
function _forbidden(msg) {
  return jsonResponse({ success: false, code: 'FORBIDDEN', message: msg || 'Akses ditolak untuk role Anda.' });
}

// ── PIN HASH (SHA-256) — supaya PIN tidak lagi plaintext di sheet ──
function _hashPin(pin) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin), Utilities.Charset.UTF_8);
  return raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

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
      case 'bulk_add_attendance': return bulkAddAttendance(data);
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

    // GET publik (tidak butuh session)
    const PUBLIC_GET = ['validate_device', 'login', 'validate_session'];
    // GET yang diautentikasi lewat device token (bukan session) — dipakai scanner
    const DEVICE_GET = ['get_scan_index', 'get_attendance_summary'];

    if (DEVICE_GET.includes(action)) {
      if (!validateToken(e.parameter.token)) {
        return jsonResponse({ success: false, code: 'INVALID_TOKEN', message: 'Device tidak terdaftar atau tidak aktif.' });
      }
    } else if (!PUBLIC_GET.includes(action)) {
      const role = _validateSession(sessionToken);
      if (!role) {
        return jsonResponse({ success: false, code: 'UNAUTHORIZED', message: 'Sesi tidak valid.' });
      }
      e.parameter._role = role;
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
      case 'get_devices':       return getDevices(e.parameter);
      case 'validate_device':   return validateDeviceResponse(e.parameter.token);
      case 'get_absen_range':   return getAbsenRange(e.parameter);
      case 'get_hari_libur':    return getHariLibur();
      case 'get_audit_log':     return getAuditLog(e.parameter);
      case 'get_attendance_summary': return getAttendanceSummary(e.parameter); // [FIX-COUNTER] Summary harian untuk scanner
      case 'get_scan_index':    return getScanIndex();
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
  const pin = String(data.pin || '');
  if (!pin) return jsonResponse({ success: false, message: 'PIN tidak boleh kosong.' });

  // Rate-limit percobaan gagal — proteksi brute-force PIN pendek
  const lock = _checkLoginLock();
  if (lock.locked) {
    return jsonResponse({ success: false, code: 'LOCKED', message: 'Terlalu banyak percobaan PIN salah. Coba lagi dalam ' + lock.waitMin + ' menit.' });
  }

  const config    = getKonfigurasi();
  const ROLE_KEYS = [['PIN_TU', 'TU'], ['PIN_KEPSEK', 'KEPSEK'], ['PIN_WALI', 'WALI']];
  let role = null;

  for (let i = 0; i < ROLE_KEYS.length; i++) {
    const key = ROLE_KEYS[i][0], r = ROLE_KEYS[i][1];
    const hash = config[key + '_HASH'];
    if (hash) {
      if (_hashPin(pin) === hash) { role = r; break; }
    } else if (config[key]) {
      // Konfigurasi lama (plaintext) ditemukan — cocokkan lalu migrasi otomatis ke hash
      if (pin === String(config[key])) {
        role = r;
        _migratePinToHash(key, pin);
        break;
      }
    }
  }

  if (!role) {
    _registerLoginFailure();
    _addAuditLog('LOGIN_GAGAL', 'AUTH', '', pin.length + ' digit pin salah', 'Unknown', '-');
    return jsonResponse({ success: false, message: 'PIN salah. Silakan coba lagi.' });
  }

  _clearLoginFailures();
  const token = _generateSessionToken();
  _storeSession(token, role);
  _addAuditLog('LOGIN', 'AUTH', '', '', role, role);

  return jsonResponse({ success: true, token, role });
}

// ── LOGIN RATE-LIMIT (CacheService, gratis) ─────────────────────
function _checkLoginLock() {
  const fails = _cacheGet('login_fail_count') || 0;
  if (fails >= 15) return { locked: true, waitMin: 5 };
  return { locked: false };
}
function _registerLoginFailure() {
  const fails = (_cacheGet('login_fail_count') || 0) + 1;
  _cacheSet('login_fail_count', fails, 300); // jendela geser 5 menit
}
function _clearLoginFailures() {
  _cacheRemove('login_fail_count');
}

// ── MIGRASI PIN PLAINTEXT -> HASH (otomatis, sekali per key) ────
function _migratePinToHash(key, plainPin) {
  try {
    const sheet = getSheet(SHEET_KONFIGURASI);
    const rows  = sheet.getDataRange().getValues();
    let hashRowIdx = -1, plainRowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === key + '_HASH') hashRowIdx = i;
      if (rows[i][0] === key) plainRowIdx = i;
    }
    const hash = _hashPin(plainPin);
    if (hashRowIdx >= 0) sheet.getRange(hashRowIdx + 1, 2).setValue(hash);
    else sheet.appendRow([key + '_HASH', hash]);
    if (plainRowIdx >= 0) sheet.getRange(plainRowIdx + 1, 2).setValue('');
    _cacheRemove('cfg_v1');
  } catch (e) { /* migrasi gagal -> tetap jalan pakai plaintext di percobaan berikutnya */ }
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
  const pinKey = data.pinKey; // PIN_TU, PIN_KEPSEK, PIN_WALI
  const VALID_KEYS = ['PIN_TU', 'PIN_KEPSEK', 'PIN_WALI'];
  if (!VALID_KEYS.includes(pinKey)) return jsonResponse({ success: false, message: 'Kunci PIN tidak valid.' });
  if (!data.newPin || String(data.newPin).length < 4) return jsonResponse({ success: false, message: 'PIN minimal 4 karakter.' });

  // PIN disimpan sebagai hash SHA-256, bukan plaintext — bersihkan sisa plaintext lama jika ada
  const sheet   = getSheet(SHEET_KONFIGURASI);
  const rows    = sheet.getDataRange().getValues();
  const hashKey = pinKey + '_HASH';
  const hash    = _hashPin(data.newPin);
  let hashRowIdx = -1, plainRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === hashKey) hashRowIdx = i;
    if (rows[i][0] === pinKey)  plainRowIdx = i;
  }
  if (hashRowIdx >= 0) sheet.getRange(hashRowIdx + 1, 2).setValue(hash);
  else sheet.appendRow([hashKey, hash]);
  if (plainRowIdx >= 0) sheet.getRange(plainRowIdx + 1, 2).setValue('');

  _cacheRemove('cfg_v1');
  _addAuditLog('CHANGE_PIN', pinKey, '***', '***', data._role, data._role);
  return jsonResponse({ success: true, message: 'PIN berhasil diubah.' });
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
  if (!params || params._role !== 'TU') return _forbidden('Hanya TU yang dapat melihat audit log.');
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
  return _getActiveDeviceTokensCached().indexOf(String(token)) !== -1;
}

function _getActiveDeviceTokensCached() {
  let list = _cacheGet('device_tokens_v1');
  if (list) return list;
  const sheet = getSheet(SHEET_DEVICE_TOKENS);
  const data  = sheet.getDataRange().getValues();
  list = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][4] === 'AKTIF') list.push(String(data[i][0]));
  }
  _cacheSet('device_tokens_v1', list, 300);
  return list;
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
  _cacheRemove('device_tokens_v1');
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

function getDevices(params) {
  params = params || {};
  if (params._role !== 'TU' && params._role !== 'KEPSEK') {
    return _forbidden('Hanya TU dan Kepala Sekolah yang dapat melihat daftar perangkat.');
  }
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
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat menonaktifkan perangkat.');
  const sheet = getSheet(SHEET_DEVICE_TOKENS);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.token)) {
      sheet.getRange(i + 1, 5).setValue('NONAKTIF');
      _cacheRemove('device_tokens_v1');
      _addAuditLog('NONAKTIF_DEVICE', data.token, 'AKTIF', 'NONAKTIF', data._role, data._role);
      return jsonResponse({ success: true, message: 'Device berhasil dinonaktifkan.' });
    }
  }
  return jsonResponse({ success: false, message: 'Token tidak ditemukan.' });
}

// ── KONFIGURASI ───────────────────────────────────────────────
function getKonfigurasi() {
  let config = _cacheGet('cfg_v1');
  if (config) return config;
  const sheet = getSheet(SHEET_KONFIGURASI);
  const data  = sheet.getDataRange().getValues();
  config = {};
  data.forEach(row => {
    if (!row[0]) return;
    let val = row[1];
    if (val instanceof Date) {
      val = String(val.getHours()).padStart(2,'0') + ':' + String(val.getMinutes()).padStart(2,'0');
    }
    config[row[0]] = val;
  });
  _cacheSet('cfg_v1', config, 300);
  return config;
}

function getConfigResponse() {
  const config = getKonfigurasi();
  // JANGAN kirim PIN (plaintext maupun hash) ke frontend
  const safe = Object.assign({}, config);
  ['PIN_TU', 'PIN_KEPSEK', 'PIN_WALI', 'PIN_TU_HASH', 'PIN_KEPSEK_HASH', 'PIN_WALI_HASH'].forEach(k => delete safe[k]);
  return jsonResponse({ success: true, data: safe });
}

function updateConfig(data) {
  if (data._role !== 'TU') return jsonResponse({ success: false, message: 'Hanya TU yang dapat mengubah konfigurasi.' });
  const sheet   = getSheet(SHEET_KONFIGURASI);
  const rows    = sheet.getDataRange().getValues();
  const updates = data.updates || {};
  const PROTECTED = ['PIN_TU', 'PIN_KEPSEK', 'PIN_WALI', 'PIN_TU_HASH', 'PIN_KEPSEK_HASH', 'PIN_WALI_HASH']; // ubah PIN lewat change_pin

  for (let i = 0; i < rows.length; i++) {
    const key = rows[i][0];
    if (updates.hasOwnProperty(key) && !PROTECTED.includes(key)) {
      const oldVal = rows[i][1];
      sheet.getRange(i + 1, 2).setValue(updates[key]);
      _addAuditLog('UPDATE_CONFIG', key, oldVal, updates[key], data._role, data._role);
    }
  }
  _cacheRemove('cfg_v1');
  return jsonResponse({ success: true, message: 'Konfigurasi berhasil diperbarui.' });
}

// ── HARI LIBUR ────────────────────────────────────────────────
function _getAllHariLiburCached() {
  let list = _cacheGet('hari_libur_v1');
  if (list) return list;
  const sheet = getSheet(SHEET_HARI_LIBUR);
  const rows  = sheet.getDataRange().getValues();
  list = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) list.push({ id: rows[i][0], tanggal: rows[i][1], keterangan: rows[i][2] });
  }
  _cacheSet('hari_libur_v1', list, 3600);
  return list;
}

function getHariLibur() {
  const result = _getAllHariLiburCached().slice().sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  return jsonResponse({ success: true, data: result });
}

function addHariLibur(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat mengelola hari libur.');
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
  _cacheRemove('hari_libur_v1');
  _addAuditLog('ADD_HARI_LIBUR', data.tanggal, '', data.keterangan, data._role, data._role);
  return jsonResponse({ success: true, message: 'Hari libur berhasil ditambahkan.' });
}

function deleteHariLibur(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat mengelola hari libur.');
  const sheet = getSheet(SHEET_HARI_LIBUR);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      _addAuditLog('DELETE_HARI_LIBUR', rows[i][1], rows[i][2], '', data._role, data._role);
      sheet.deleteRow(i + 1);
      _cacheRemove('hari_libur_v1');
      return jsonResponse({ success: true, message: 'Hari libur berhasil dihapus.' });
    }
  }
  return jsonResponse({ success: false, message: 'Data tidak ditemukan.' });
}

function _isHariLibur(tanggal) {
  const list = _getAllHariLiburCached();
  for (let i = 0; i < list.length; i++) {
    if (list[i].tanggal === tanggal) return String(list[i].keterangan || 'Hari Libur');
  }
  return false;
}

function _getHariLiburSet(bulan) {
  const result = new Set();
  const list = _getAllHariLiburCached();
  for (let i = 0; i < list.length; i++) {
    if (bulan ? String(list[i].tanggal).startsWith(bulan) : list[i].tanggal) {
      result.add(list[i].tanggal);
    }
  }
  return result;
}

// ── PROSES ABSEN (INTI SISTEM) ────────────────────────────────
function prosesAbsen(data) {
  const qrCode = (data.qrCode || '').trim();
  const config = getKonfigurasi();

  // [BUG-04 / offline] Ambil tanggal & jam dari clientTimestamp jika valid, supaya
  // scan offline yang baru sync berjam-jam (atau berhari-hari, mis. weekend) kemudian
  // tetap tercatat pada tanggal & jam SAAT SCAN — bukan saat sinkronisasi terjadi.
  let tanggal, jamMenitSekarang, jamStr;
  const clientInfo = _parseClientTimestamp(data.clientTimestamp);
  if (clientInfo) {
    tanggal          = clientInfo.tanggal;
    jamStr           = clientInfo.jamStr;
    jamMenitSekarang = clientInfo.jamMenit;
  } else {
    tanggal          = todayJakarta();
    jamMenitSekarang = nowMinutes();
    jamStr           = nowJakarta();
  }

  // Cek hari libur pada TANGGAL SCAN (bukan tanggal server saat request diterima)
  const liburInfo = _isHariLibur(tanggal);
  if (liburInfo) {
    return jsonResponse({ success: false, code: 'HARI_LIBUR', message: 'Hari itu libur: ' + liburInfo + '. Tidak ada pencatatan absensi.' });
  }

  // [BUG-07] Cek hari Minggu pada tanggal scan — pakai getDay() via Date agar tidak bergantung locale server
  const scanDate = new Date(tanggal + 'T12:00:00+07:00');
  if (scanDate.getDay() === 0) {
    return jsonResponse({ success: false, code: 'HARI_LIBUR', message: 'Hari itu Minggu. Tidak ada pencatatan absensi.' });
  }

  if (qrCode.startsWith('MTS-S-')) {
    return _absenSiswa(qrCode, tanggal, jamMenitSekarang, jamStr, config, data);
  } else if (qrCode.startsWith('MTS-G-') || qrCode.startsWith('MTS-TU-')) {
    return _absenGuru(qrCode, tanggal, jamMenitSekarang, jamStr, config, data);
  } else {
    return jsonResponse({ success: false, code: 'UNKNOWN_QR', message: 'Format QR Code tidak dikenal.' });
  }
}

// Parsing + sanity-check clientTimestamp dari scanner (dipakai untuk scan langsung
// maupun scan offline yang disinkronkan belakangan).
function _parseClientTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const diffMs    = Date.now() - d.getTime();
  const MAX_FUTURE = 5 * 60 * 1000;            // toleransi jam HP maju 5 menit
  const MAX_PAST   = 7 * 24 * 60 * 60 * 1000;  // maksimal mundur 7 hari (offline lama/weekend)
  if (diffMs < -MAX_FUTURE || diffMs > MAX_PAST) return null; // di luar batas wajar -> pakai waktu server
  return {
    tanggal:  Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd'),
    jamStr:   Utilities.formatDate(d, TIMEZONE, 'HH:mm:ss'),
    jamMenit: parseInt(Utilities.formatDate(d, TIMEZONE, 'HH')) * 60 + parseInt(Utilities.formatDate(d, TIMEZONE, 'mm'))
  };
}

// ── INDEKS SISWA/GURU (CACHED) — hindari baca seluruh sheet tiap scan ──
function _isSiswaAktifForScan(status) {
  return status !== 'NONAKTIF' && status !== 'LULUS' && status !== 'PINDAH' && status !== 'DO';
}

function _getSiswaAllCached() {
  let list = _cacheGet('siswa_all_v1');
  if (list) return list;
  const rows = getSheet(SHEET_SISWA).getDataRange().getValues();
  list = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      list.push({
        nis: rows[i][0], nama: rows[i][1], kelas: rows[i][2],
        jenisKelamin: rows[i][3], namaOrtu: rows[i][4], noHpOrtu: rows[i][5],
        status: rows[i][6] || 'AKTIF'
      });
    }
  }
  _cacheSet('siswa_all_v1', list, 1800);
  return list;
}

function _getGuruAllCached() {
  let list = _cacheGet('guru_all_v1');
  if (list) return list;
  const rows = getSheet(SHEET_GURU).getDataRange().getValues();
  list = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      list.push({
        nig: rows[i][0], nama: rows[i][1], jabatan: rows[i][2],
        mapel: rows[i][3], jenisKelamin: rows[i][4], tipe: rows[i][5] || 'Guru'
      });
    }
  }
  _cacheSet('guru_all_v1', list, 1800);
  return list;
}

function _findSiswaForScan(nis) {
  const list = _getSiswaAllCached();
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].nis) === String(nis) && _isSiswaAktifForScan(list[i].status)) {
      return { nis: list[i].nis, nama: list[i].nama, kelas: list[i].kelas, jenisKelamin: list[i].jenisKelamin };
    }
  }
  return null;
}

function _findGuruByNig(nig) {
  const list = _getGuruAllCached();
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].nig) === String(nig)) return list[i];
  }
  return null;
}

// ── PETA ABSENSI HARI-INI (CACHED) — sekali baca sheet per hari, sisanya dari cache ──
function _getAbsenSiswaMapCached(tanggal) {
  const key = 'absen_s_' + tanggal;
  let map = _cacheGet(key);
  if (map) return map;
  const rows = getSheet(SHEET_ABSEN_SISWA).getDataRange().getValues();
  map = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === tanggal) map[String(rows[i][2])] = { jam: rows[i][5], status: rows[i][6] };
  }
  _cacheSet(key, map, 21600);
  return map;
}

function _getAbsenGuruMapCached(tanggal) {
  const key = 'absen_g_' + tanggal;
  let map = _cacheGet(key);
  if (map) return map;
  const rows = getSheet(SHEET_ABSEN_GURU).getDataRange().getValues();
  map = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === tanggal) {
      map[String(rows[i][2])] = {
        rowIndex: i + 1, jamMasuk: rows[i][4], statusMasuk: rows[i][5],
        jamPulang: rows[i][6], statusPulang: rows[i][7]
      };
    }
  }
  _cacheSet(key, map, 21600);
  return map;
}

function _absenSiswa(qrCode, tanggal, jamMenit, jamStr, config, reqData) {
  const nis   = qrCode.replace('MTS-S-', '');
  const siswa = _findSiswaForScan(nis); // dari cache, tanpa baca sheet
  if (!siswa) {
    return jsonResponse({ success: false, code: 'NOT_FOUND', message: 'NIS ' + nis + ' tidak ditemukan atau sudah tidak aktif.' });
  }

  // [BUG-02] LockService mencegah race condition — sekarang lock hanya membungkus
  // baca peta absensi (dari cache) + tulis baris baru, bukan pembacaan sheet penuh.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return jsonResponse({ success: false, message: 'Server sibuk, coba lagi dalam beberapa detik.' });
  }
  try {
    const cacheKey = 'absen_s_' + tanggal;
    const map      = _getAbsenSiswaMapCached(tanggal);
    const existing = map[String(nis)];
    if (existing) {
      return jsonResponse({
        success: false, code: 'DUPLICATE',
        message: siswa.nama + ' sudah tercatat hadir pukul ' + existing.jam,
        siswa
      });
    }

    const jamMasuk  = timeToMinutes(config['JAM_MASUK_SISWA'] || '06:40');
    const toleransi = parseInt(config['TOLERANSI_SISWA'] || '10');
    const status    = jamMenit <= (jamMasuk + toleransi) ? 'HADIR' : 'TERLAMBAT';

    const id = 'S' + new Date().getTime();
    getSheet(SHEET_ABSEN_SISWA).appendRow([id, tanggal, siswa.nis, siswa.nama, siswa.kelas, jamStr, status, '', reqData.scannedBy || 'Scanner']);

    map[String(nis)] = { jam: jamStr, status };
    _cacheSet(cacheKey, map, 21600);

    return jsonResponse({ success: true, type: 'siswa', siswa, status, jam: jamStr, tanggal });
  } finally {
    lock.releaseLock();
  }
}

function _absenGuru(qrCode, tanggal, jamMenit, jamStr, config, reqData) {
  const nig  = qrCode.replace('MTS-G-', '').replace('MTS-TU-', '');
  const guru = _findGuruByNig(nig); // dari cache, tanpa baca sheet
  if (!guru) {
    return jsonResponse({ success: false, code: 'NOT_FOUND', message: 'NIG ' + nig + ' tidak ditemukan.' });
  }

  // [BUG-02] Lock hanya membungkus baca peta absensi (cache) + tulis — bukan sheet penuh
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return jsonResponse({ success: false, message: 'Server sibuk, coba lagi dalam beberapa detik.' });
  }
  try {
    const cacheKey   = 'absen_g_' + tanggal;
    const map        = _getAbsenGuruMapCached(tanggal);
    const existing   = map[String(nig)];
    const sheetAbsen = getSheet(SHEET_ABSEN_GURU);

    if (existing) {
      if (existing.jamPulang) {
        return jsonResponse({
          success: false, code: 'DUPLICATE',
          message: guru.nama + ' sudah tercatat masuk ' + existing.jamMasuk + ' dan pulang ' + existing.jamPulang,
          guru
        });
      }
      // [MED-04] Validasi waktu minimum kerja sebelum boleh scan pulang (bisa diatur di Pengaturan)
      const jamMasukMenit = timeToMinutes(String(existing.jamMasuk).substring(0, 5));
      const minKerjaMenit = (parseFloat(config['MIN_JAM_KERJA_GURU']) || 4) * 60;
      if ((jamMenit - jamMasukMenit) < minKerjaMenit) {
        const minJam = Math.floor((jamMasukMenit + minKerjaMenit) / 60);
        const minMnt = Math.round((jamMasukMenit + minKerjaMenit) % 60);
        const pulangMinStr = String(minJam).padStart(2, '0') + ':' + String(minMnt).padStart(2, '0');
        return jsonResponse({
          success: false, code: 'TOO_EARLY',
          message: guru.nama + ' baru masuk ' + existing.jamMasuk + '. Pulang minimal pukul ' + pulangMinStr + '.',
          guru
        });
      }
      const jamPulang    = timeToMinutes(config['JAM_PULANG_GURU'] || '15:30');
      const statusPulang = jamMenit >= jamPulang ? 'TEPAT_WAKTU' : 'PULANG_AWAL';
      sheetAbsen.getRange(existing.rowIndex, 7).setValue(jamStr);
      sheetAbsen.getRange(existing.rowIndex, 8).setValue(statusPulang);

      existing.jamPulang    = jamStr;
      existing.statusPulang = statusPulang;
      _cacheSet(cacheKey, map, 21600);

      return jsonResponse({ success: true, type: 'guru_pulang', guru, status: statusPulang, jam: jamStr, tanggal });
    }

    const jamMasuk  = timeToMinutes(config['JAM_MASUK_GURU'] || '06:30');
    const toleransi = parseInt(config['TOLERANSI_GURU'] || '15');
    const status    = jamMenit <= (jamMasuk + toleransi) ? 'HADIR' : 'TERLAMBAT';

    const id = 'G' + new Date().getTime();
    sheetAbsen.appendRow([id, tanggal, guru.nig, guru.nama, jamStr, status, '', '', '']);
    const newRowIndex = sheetAbsen.getLastRow(); // aman: masih di dalam lock, tidak ada penulis lain di antara ini

    map[String(nig)] = { rowIndex: newRowIndex, jamMasuk: jamStr, statusMasuk: status, jamPulang: '', statusPulang: '' };
    _cacheSet(cacheKey, map, 21600);

    return jsonResponse({ success: true, type: 'guru_masuk', guru, status, jam: jamStr, tanggal });
  } finally {
    lock.releaseLock();
  }
}

// ── INPUT MANUAL (BUGFIX + BARU) ──────────────────────────────
function addAttendance(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat menginput absensi manual.');
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
      SpreadsheetApp.flush(); // [FIX-02] Paksa commit data sebelum return
      _cacheRemove('absen_s_' + tanggal);
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
  SpreadsheetApp.flush(); // [FIX-02] Paksa commit data sebelum return agar frontend dapat data terbaru
  _cacheRemove('absen_s_' + tanggal);
  _addAuditLog('ADD_ABSEN_SISWA_MANUAL', nis + '@' + tanggal, 'Belum Absen', data.status, data._role, data._role);
  return jsonResponse({ success: true, created: true, message: 'Absensi manual siswa berhasil disimpan.' });
}

function addAttendanceGuru(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat menginput absensi manual.');
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
      SpreadsheetApp.flush(); // [FIX-02] Paksa commit data sebelum return
      _cacheRemove('absen_g_' + tanggal);
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
  SpreadsheetApp.flush(); // [FIX-02] Paksa commit data sebelum return agar frontend dapat data terbaru
  _cacheRemove('absen_g_' + tanggal);
  _addAuditLog('ADD_ABSEN_GURU_MANUAL', nig + '@' + tanggal, 'Belum Absen', data.statusMasuk, data._role, data._role);
  return jsonResponse({ success: true, created: true, message: 'Absensi manual guru berhasil disimpan.' });
}

// ── INPUT MASSAL (mis. "Tandai Semua Alpa") — satu kali lock, satu audit log ──
function bulkAddAttendance(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat menginput absensi massal.');
  const tanggal = data.tanggal || todayJakarta();
  const items   = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return jsonResponse({ success: false, message: 'Tidak ada data untuk disimpan.' });

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return jsonResponse({ success: false, message: 'Server sibuk, coba lagi dalam beberapa detik.' });
  }
  try {
    const sheetAbsen = getSheet(SHEET_ABSEN_SISWA);
    const map = _getAbsenSiswaMapCached(tanggal);
    const newRows = [];
    let created = 0, skipped = 0;

    items.forEach(item => {
      const nis = String(item.nis || '');
      if (!nis || map[nis]) { skipped++; return; } // sudah ada record hari itu -> lewati
      const id  = 'M' + new Date().getTime() + '_' + created;
      const jam = item.jam || nowJakarta();
      const status = item.status || 'ALPA';
      newRows.push([id, tanggal, nis, item.nama || '', item.kelas || '', jam, status, item.keterangan || '', (data._role || 'TU') + ' (Manual)']);
      map[nis] = { jam, status };
      created++;
    });

    if (newRows.length > 0) {
      sheetAbsen.getRange(sheetAbsen.getLastRow() + 1, 1, newRows.length, 9).setValues(newRows);
      SpreadsheetApp.flush(); // [FIX-02] Paksa commit sebelum return agar frontend dapat data terbaru
      _cacheSet('absen_s_' + tanggal, map, 21600);
    }

    _addAuditLog('BULK_ADD_ABSEN_SISWA', tanggal, '', created + ' siswa ditandai', data._role, data._role);
    return jsonResponse({ success: true, created, skipped, message: created + ' siswa berhasil disimpan' + (skipped ? ', ' + skipped + ' dilewati (sudah ada data).' : '.') });
  } finally {
    lock.releaseLock();
  }
}

// ── GET DATA ──────────────────────────────────────────────────
function getStudents() {
  return jsonResponse({ success: true, data: _getSiswaAllCached() });
}

function getTeachers() {
  return jsonResponse({ success: true, data: _getGuruAllCached() });
}

// Endpoint ringan untuk scanner — diautentikasi via device token, dipakai
// untuk lookup nama instan di HP tanpa harus login sesi TU/Kepsek/Wali.
function getScanIndex() {
  const siswa = _getSiswaAllCached()
    .filter(s => _isSiswaAktifForScan(s.status))
    .map(s => ({ nis: s.nis, nama: s.nama, kelas: s.kelas }));
  const guru = _getGuruAllCached()
    .map(g => ({ nig: g.nig, nama: g.nama, jabatan: g.jabatan, tipe: g.tipe }));
  return jsonResponse({ success: true, siswa, guru });
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

// [FIX-COUNTER] Endpoint ringan untuk scanner: hitung jumlah hadir/terlambat/total hari ini
// Bisa diakses dengan device token saja (tanpa session admin)
function getAttendanceSummary(params) {
  const tanggal = params.tanggal || todayJakarta();

  // Device token sudah divalidasi di doGet (DEVICE_GET). Hitung dari peta
  // absensi harian yang sudah di-cache — tidak perlu baca seluruh sheet.
  const mapS = _getAbsenSiswaMapCached(tanggal);

  let hadir = 0, terlambat = 0, izin = 0, sakit = 0, alpa = 0;
  Object.keys(mapS).forEach(nis => {
    const status = String(mapS[nis].status || '').toUpperCase();
    if (status === 'HADIR' || status === 'TEPAT_WAKTU') hadir++;
    else if (status === 'TERLAMBAT') terlambat++;
    else if (status === 'IZIN') izin++;
    else if (status === 'SAKIT') sakit++;
    else if (status === 'ALPA') alpa++;
  });

  const total = hadir + terlambat + izin + sakit + alpa;
  return jsonResponse({
    success: true,
    tanggal,
    summary: { hadir, terlambat, izin, sakit, alpa, total }
  });
}

function getStats(params) {
  const tanggal   = params.tanggal || todayJakarta();
  const hariLibur = _isHariLibur(tanggal);

  // [MED-03/B12] Konsisten dengan aturan kelayakan scan: status kosong dihitung AKTIF
  const totalSiswa = _getSiswaAllCached().filter(s => _isSiswaAktifForScan(s.status)).length;
  const totalGuru  = _getGuruAllCached().length;

  const mapS = _getAbsenSiswaMapCached(tanggal);
  let hadirS = 0, terlambatS = 0, izinS = 0, sakitS = 0, alpaS = 0;
  Object.keys(mapS).forEach(nis => {
    const st = mapS[nis].status;
    if      (st === 'HADIR')     hadirS++;
    else if (st === 'TERLAMBAT') terlambatS++;
    else if (st === 'IZIN')      izinS++;
    else if (st === 'SAKIT')     sakitS++;
    else if (st === 'ALPA')      alpaS++;
  });

  const mapG = _getAbsenGuruMapCached(tanggal);
  let hadirG = 0, terlambatG = 0, izinG = 0, sakitG = 0;
  Object.keys(mapG).forEach(nig => {
    const st = mapG[nig].statusMasuk;
    if      (st === 'HADIR')     hadirG++;
    else if (st === 'TERLAMBAT') terlambatG++;
    else if (st === 'IZIN')      izinG++;
    else if (st === 'SAKIT')     sakitG++;
  });

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
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat mengubah data absensi.');
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
      SpreadsheetApp.flush(); // [FIX-02] Paksa commit data sebelum return
      _cacheRemove((data.tipe === 'guru' ? 'absen_g_' : 'absen_s_') + rows[i][1]);
      _addAuditLog('UPDATE_ABSEN', rows[i][2] + '@' + rows[i][1], oldStatus, data.status || data.statusMasuk, data._role, data._role);
      return jsonResponse({ success: true, message: 'Data absen berhasil diperbarui.' });
    }
  }
  return jsonResponse({ success: false, message: 'Data tidak ditemukan.' });
}

function addStudent(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat menambah data siswa.');
  if (!data.nis || !data.nama) return jsonResponse({ success: false, message: 'NIS dan Nama wajib diisi.' });
  const sheet = getSheet(SHEET_SISWA);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      return jsonResponse({ success: false, message: 'NIS ' + data.nis + ' sudah ada.' });
    }
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setNumberFormat("@").setValues([[data.nis, data.nama, data.kelas || '', data.jenisKelamin || '', data.namaOrtu || '', data.noHpOrtu || '', 'AKTIF']]);
  _cacheRemove('siswa_all_v1');
  _addAuditLog('ADD_SISWA', String(data.nis), '', data.nama, data._role, data._role);
  return jsonResponse({ success: true, message: 'Siswa berhasil ditambahkan.' });
}

function editStudent(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat mengubah data siswa.');
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
      _cacheRemove('siswa_all_v1');
      _addAuditLog('EDIT_SISWA', String(data.nis), oldNama, data.nama, data._role, data._role);
      return jsonResponse({ success: true, message: 'Data siswa berhasil diperbarui.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIS tidak ditemukan.' });
}

function archiveStudent(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat mengubah status arsip siswa.');
  const VALID_STATUSES = ['LULUS', 'PINDAH', 'DO', 'NONAKTIF', 'AKTIF'];
  const newStatus = data.archiveStatus || 'LULUS';
  if (!VALID_STATUSES.includes(newStatus)) return jsonResponse({ success: false, message: 'Status tidak valid.' });

  const sheet = getSheet(SHEET_SISWA);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      const oldStatus = rows[i][6];
      sheet.getRange(i + 1, 7).setValue(newStatus);
      _cacheRemove('siswa_all_v1');
      _addAuditLog('ARCHIVE_SISWA', String(data.nis), oldStatus, newStatus, data._role, data._role);
      return jsonResponse({ success: true, message: 'Status siswa diubah menjadi ' + newStatus + '.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIS tidak ditemukan.' });
}

function deleteStudent(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat menghapus data siswa.');
  const sheet = getSheet(SHEET_SISWA);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nis)) {
      _addAuditLog('DELETE_SISWA', String(data.nis), rows[i][1], '', data._role, data._role);
      sheet.deleteRow(i + 1);
      _cacheRemove('siswa_all_v1');
      return jsonResponse({ success: true, message: 'Siswa berhasil dihapus.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIS tidak ditemukan.' });
}

function addTeacher(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat menambah data guru/tendik.');
  if (!data.nig || !data.nama) return jsonResponse({ success: false, message: 'NIG dan Nama wajib diisi.' });
  const sheet = getSheet(SHEET_GURU);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nig)) {
      return jsonResponse({ success: false, message: 'NIG ' + data.nig + ' sudah ada.' });
    }
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setNumberFormat("@").setValues([[data.nig, data.nama, data.jabatan || '', data.mapel || '', data.jenisKelamin || '', data.tipe || 'Guru']]);
  _cacheRemove('guru_all_v1');
  _addAuditLog('ADD_GURU', String(data.nig), '', data.nama, data._role, data._role);
  return jsonResponse({ success: true, message: 'Guru/Tendik berhasil ditambahkan.' });
}

function editTeacher(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat mengubah data guru/tendik.');
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
      _cacheRemove('guru_all_v1');
      _addAuditLog('EDIT_GURU', String(data.nig), oldNama, data.nama, data._role, data._role);
      return jsonResponse({ success: true, message: 'Data guru berhasil diperbarui.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIG tidak ditemukan.' });
}

function deleteTeacher(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat menghapus data guru/tendik.');
  const sheet = getSheet(SHEET_GURU);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.nig)) {
      _addAuditLog('DELETE_GURU', String(data.nig), rows[i][1], '', data._role, data._role);
      sheet.deleteRow(i + 1);
      _cacheRemove('guru_all_v1');
      return jsonResponse({ success: true, message: 'Guru/Tendik berhasil dihapus.' });
    }
  }
  return jsonResponse({ success: false, message: 'NIG tidak ditemukan.' });
}

// ── BACKUP OTOMATIS SEBELUM IMPORT (aman dari kegagalan di tengah proses) ──
function _backupSheet(sourceSheet, prefix) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmm');
    const name  = (prefix + '_' + stamp).substring(0, 100);
    const data  = sourceSheet.getDataRange().getValues();
    let backupSheet = ss.getSheetByName(name);
    if (backupSheet) ss.deleteSheet(backupSheet);
    backupSheet = ss.insertSheet(name);
    if (data.length > 0) backupSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
    backupSheet.hideSheet();
    _pruneOldBackups(prefix, 3);
  } catch (e) { /* backup gagal -> tetap lanjutkan import, jangan blokir TU */ }
}

function _pruneOldBackups(prefix, keep) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const matches = ss.getSheets()
      .filter(s => s.getName().indexOf(prefix + '_') === 0)
      .sort((a, b) => a.getName().localeCompare(b.getName())); // nama berisi stempel waktu -> urut kronologis
    while (matches.length > keep) ss.deleteSheet(matches.shift());
  } catch (e) {}
}

function importStudents(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat mengimpor data siswa.');
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

  const sheet   = getSheet(SHEET_SISWA);
  const lastRow = sheet.getLastRow();
  const existingCount = lastRow > 1 ? lastRow - 1 : 0;

  // Backup dulu sebelum menyentuh data lama — bisa dipulihkan manual dari sheet
  // tersembunyi "BACKUP_SISWA_..." jika terjadi sesuatu yang tidak diinginkan.
  _backupSheet(sheet, 'BACKUP_SISWA');

  // Pertahankan siswa yang sudah diarsipkan (LULUS/PINDAH/DO/NONAKTIF) dan TIDAK
  // termasuk di file import baru — supaya import "refresh siswa aktif" tidak
  // menghapus riwayat siswa yang sudah lulus/pindah/keluar.
  const existingRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 7).getValues() : [];
  const importedNis  = new Set(validStudents.map(s => String(s.nis)));
  const ARCHIVE_STATUSES = ['LULUS', 'PINDAH', 'DO', 'NONAKTIF'];
  const archivedKeep = existingRows.filter(r =>
    r[0] && !importedNis.has(String(r[0])) && ARCHIVE_STATUSES.indexOf(r[6]) !== -1
  );

  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  const newRows = validStudents.map(s => [
    s.nis, s.nama, s.kelas, s.jenisKelamin || '', s.namaOrtu || '', s.noHpOrtu || '', 'AKTIF'
  ]);
  const allRows = newRows.concat(archivedKeep);
  sheet.getRange(2, 1, allRows.length, 7).setNumberFormat("@").setValues(allRows);

  _cacheRemove('siswa_all_v1');
  _addAuditLog('IMPORT_SISWA', 'ALL', existingCount + ' records',
    validStudents.length + ' records (+' + archivedKeep.length + ' arsip dipertahankan)', data._role, data._role);
  return jsonResponse({
    success: true,
    message: validStudents.length + ' siswa berhasil diimport' +
      (archivedKeep.length ? ', ' + archivedKeep.length + ' siswa arsip (lulus/pindah/DO) dipertahankan' : '') +
      '. Backup data lama tersimpan otomatis di sheet tersembunyi.'
  });
}

function importTeachers(data) {
  if (data._role !== 'TU') return _forbidden('Hanya TU yang dapat mengimpor data guru/tendik.');
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

  const sheet   = getSheet(SHEET_GURU);
  const lastRow = sheet.getLastRow();
  const existingCount = lastRow > 1 ? lastRow - 1 : 0;

  _backupSheet(sheet, 'BACKUP_GURU');

  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  const rows = validTeachers.map(t => [
    t.nig, t.nama, t.jabatan || '', t.mapel || '', t.jenisKelamin || '', t.tipe || 'Guru'
  ]);
  sheet.getRange(2, 1, rows.length, 6).setNumberFormat("@").setValues(rows);

  _cacheRemove('guru_all_v1');
  _addAuditLog('IMPORT_GURU', 'ALL', existingCount + ' records', validTeachers.length + ' records', data._role, data._role);
  return jsonResponse({ success: true, message: validTeachers.length + ' guru/tendik berhasil diimport. Backup data lama tersimpan otomatis di sheet tersembunyi.' });
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

  // ── Konfigurasi (v2.1 — PIN disimpan sebagai HASH SHA-256, bukan plaintext) ──
  const sheetKfg = ss.getSheetByName(SHEET_KONFIGURASI);
  sheetKfg.getRange(1,1,15,2).setValues([
    ['JAM_MASUK_SISWA','06:40'],
    ['TOLERANSI_SISWA','10'],
    ['JAM_MASUK_GURU','06:30'],
    ['TOLERANSI_GURU','15'],
    ['JAM_PULANG_GURU','15:30'],
    ['MIN_JAM_KERJA_GURU','4'],
    ['TAHUN_AJARAN','2026/2027'],
    ['SEMESTER','1'],
    ['NAMA_SEKOLAH','MTS Al Huda Putri Malang'],
    ['PIN_TU_HASH', _hashPin('admin123')],       // PIN awal: admin123 — GANTI lewat menu Pengaturan setelah login!
    ['PIN_KEPSEK_HASH', _hashPin('kepsek123')],  // PIN awal: kepsek123 — GANTI lewat menu Pengaturan setelah login!
    ['PIN_WALI_HASH', _hashPin('wali123')],      // PIN awal: wali123 — GANTI lewat menu Pengaturan setelah login!
    ['WALI_KELAS_VII',''],       // contoh: isi nama wali kelas
    ['WALI_KELAS_VIII',''],
    ['WALI_KELAS_IX','']
  ]);
  sheetKfg.getRange('B1:B5').setNumberFormat('@STRING@');

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
    '✅ Setup Selesai! (v2.1)\n\n' +
    'PIN AWAL (dipakai untuk login pertama kali):\n' +
    '  TU      → admin123\n' +
    '  KEPSEK  → kepsek123\n' +
    '  WALI    → wali123\n\n' +
    '⚠️ PIN disimpan sebagai HASH di sheet KONFIGURASI — tidak bisa dibaca ulang ' +
    'dari sheet. Ganti PIN HANYA lewat Dashboard > Pengaturan > Ganti PIN (bukan ' +
    'dengan mengedit sheet secara manual).\n\n' +
    'Langkah selanjutnya:\n' +
    '1. Login dengan PIN default di atas, lalu segera ganti lewat menu Pengaturan\n' +
    '2. Deploy Apps Script sebagai Web App\n' +
    '3. Salin URL ke file assets/js/config.js\n' +
    '4. Buka dashboard dan login\n\n' +
    'Lihat SETUP.md untuk panduan lengkap.'
  );
}

// ── ARSIP ABSENSI LAMA (jalankan manual dari editor Apps Script, mis. tiap awal
// tahun ajaran, agar sheet ABSEN_SISWA/ABSEN_GURU tidak membengkak) ──
// Cara pakai: pilih function ini di dropdown Apps Script editor lalu klik Run.
function arsipkanAbsenLama() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Arsipkan Absensi Lama', 'Arsipkan semua data absensi SEBELUM tanggal (format YYYY-MM-DD):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const cutoff = String(resp.getResponseText() || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
    ui.alert('Format tanggal tidak valid. Gunakan YYYY-MM-DD, mis. 2026-07-01');
    return;
  }

  const movedS = _archiveAttendanceSheet(SHEET_ABSEN_SISWA, 'ABSEN_SISWA_ARSIP', cutoff);
  const movedG = _archiveAttendanceSheet(SHEET_ABSEN_GURU, 'ABSEN_GURU_ARSIP', cutoff);
  _cacheRemove('siswa_all_v1');
  _cacheRemove('guru_all_v1');

  ui.alert('✅ Arsip selesai.\n\n' + movedS + ' baris absensi siswa dan ' + movedG +
    ' baris absensi guru sebelum ' + cutoff + ' dipindahkan ke sheet arsip.');
}

function _archiveAttendanceSheet(sourceName, archiveName, cutoff) {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(sourceName);
  if (!source) return 0;
  const data = source.getDataRange().getValues();
  if (data.length <= 1) return 0;

  const header = data[0];
  const keep   = [header];
  const moved  = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && String(data[i][1]) < cutoff) moved.push(data[i]);
    else keep.push(data[i]);
  }
  if (moved.length === 0) return 0;

  let archiveSheet = ss.getSheetByName(archiveName);
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(archiveName);
    archiveSheet.getRange(1, 1, 1, header.length).setValues([header])
      .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
  }
  const archiveLastRow = archiveSheet.getLastRow();
  archiveSheet.getRange(archiveLastRow + 1, 1, moved.length, header.length).setNumberFormat('@').setValues(moved);

  source.clearContents();
  source.getRange(1, 1, keep.length, header.length).setValues(keep);

  return moved.length;
}
