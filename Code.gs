/**
 * TPD BOX PLANT TRANSFER CAR INVENTORY SYSTEM - Google Sheets backend
 * Container-bound script: open your Google Sheet > Extensions > Apps Script > paste this file.
 * Sheets used: INVENTORY IN, INVENTORY OUT, CORRUGATED SKU (your data), USERS, AUDIT LOG (created by setup()).
 */
const CONFIG = {
  SHIFTS: ['DAY SHIFT', 'NIGHT SHIFT'],
  DESTINATIONS: ['Flexo 01', 'Flexo 02', 'Flexo 03', 'Flexo 04', 'Flexo 05'],
  MAX_QTY: 9999999,
  MAX_FAILS: 5,          // wrong PINs allowed per user ...
  LOCK_SECONDS: 600      // ... before a 10-minute lockout
};
const S = { IN: 'INVENTORY IN', OUT: 'INVENTORY OUT', SKU: 'CORRUGATED SKU', USERS: 'USERS', LOG: 'AUDIT LOG' };
const HEAD = {
  IN: ['ENTRY ID', 'WEEK NO.', 'DATE/TIME', 'TIME IN', 'SHIFT', 'QUANTITY', 'SKU/ITEM CODE', 'DESCRIPTION', 'CUSTOMER'],
  OUT: ['ENTRY ID', 'WEEK NO.', 'DATE/TIME', 'TIME OUT', 'SHIFT', 'QUANTITY', 'DELIVERED TO', 'SKU/ITEM CODE', 'DESCRIPTION', 'CUSTOMER'],
  SKU: ['SKU', 'DESCRIPTION', 'CUSTOMER'],
  USERS: ['NAME', 'PIN', 'ROLE', 'ACTIVE'],
  LOG: ['TIMESTAMP', 'USER', 'ACTION', 'SHEET', 'ENTRY ID', 'DETAILS']
};
const ROLES = { VIEWER: 1, ENCODER: 2, ADMIN: 3 };
const TZ = () => Session.getScriptTimeZone();
const SS = () => SpreadsheetApp.getActiveSpreadsheet();
const norm = s => String(s == null ? '' : s).trim().toUpperCase();

/* ---------------- one-time setup (run from the editor) ---------------- */
function setup() {
  const ss = SS();
  Object.keys(HEAD).forEach(k => {
    const name = S[k]; let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, HEAD[k].length).setValues([HEAD[k]]).setFontWeight('bold'); sh.setFrozenRows(1); }
  });
  const u = ss.getSheetByName(S.USERS);
  if (u.getLastRow() < 2) { // first admin with a random PIN - change it in the USERS sheet
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    u.getRange('B:B').setNumberFormat('@');
    u.appendRow(['Admin', pin, 'ADMIN', 'YES']);
    Logger.log('First admin created. Name: Admin  PIN: ' + pin);
  }
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'onSheetChange') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  bump_();
  Logger.log('Setup complete. Check the USERS sheet for the admin PIN.');
}
function onSheetChange() { bump_(); } // manual edits in the Sheet reach every open page

/* ---------------- web app entry points ---------------- */
function doGet() { return out_({ ok: true, service: 'TPD inventory API', version: ver_() }); }

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request.' }); }
  try {
    const user = auth_(p);
    switch (p.action) {
      case 'login': return out_({ ok: true, user, cfg: cfg_(), version: ver_() });
      case 'version': return out_({ ok: true, version: ver_() });
      case 'all': return out_({ ok: true, user, cfg: cfg_(), version: ver_(), data: readAll_() });
      case 'add': case 'update': case 'delete': return out_(write_(p, user));
      default: return out_({ ok: false, error: 'Unknown action.' });
    }
  } catch (err) {
    return out_({ ok: false, error: err.message, code: err.code || 'ERR' });
  }
}
const out_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const cfg_ = () => ({ shifts: CONFIG.SHIFTS, destinations: CONFIG.DESTINATIONS, maxQty: CONFIG.MAX_QTY });
const fail_ = (msg, code) => { const e = new Error(msg); e.code = code; return e; };

/* ---------------- auth ---------------- */
function auth_(p) {
  const name = norm(p.name), cache = CacheService.getScriptCache(), fk = 'fail:' + name;
  if (!name || !p.pin) throw fail_('Enter your name and PIN.', 'AUTH');
  if (Number(cache.get(fk) || 0) >= CONFIG.MAX_FAILS) throw fail_('Too many wrong attempts. Try again in 10 minutes.', 'AUTH');
  const sh = SS().getSheetByName(S.USERS); if (!sh) throw fail_('Run setup() first.', 'ERR');
  const rows = sh.getDataRange().getValues().slice(1);
  const r = rows.find(x => norm(x[0]) === name && norm(x[3]) !== 'NO');
  if (!r || String(r[1]).trim() !== String(p.pin).trim() || !ROLES[norm(r[2])]) {
    cache.put(fk, String(Number(cache.get(fk) || 0) + 1), CONFIG.LOCK_SECONDS);
    throw fail_('Wrong name or PIN.', 'AUTH');
  }
  cache.remove(fk);
  return { name: String(r[0]).trim(), role: norm(r[2]) };
}

/* ---------------- reading ---------------- */
function table_(key) {
  const sh = SS().getSheetByName(S[key]); if (!sh) throw fail_('Sheet "' + S[key] + '" not found.', 'ERR');
  const vals = sh.getDataRange().getValues(), disp = sh.getDataRange().getDisplayValues();
  const hdr = {}; (vals[0] || []).forEach((h, i) => { if (norm(h)) hdr[norm(h)] = i; });
  const miss = HEAD[key].filter(h => hdr[h] === undefined);
  if (miss.length) throw fail_('Sheet "' + S[key] + '" is missing column(s): ' + miss.join(', '), 'ERR');
  return { sh, vals, disp, hdr };
}
function secOf_(s) { // "9:16:27 AM" / "09:16" -> seconds, else null
  const m = String(s).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i); if (!m) return null;
  let h = +m[1]; if (m[4]) h = h % 12 + (/pm/i.test(m[4]) ? 12 : 0);
  return h * 3600 + +m[2] * 60 + (+m[3] || 0);
}
function readTx_(key) {
  const { vals, disp, hdr } = table_(key), tcol = hdr[key === 'IN' ? 'TIME IN' : 'TIME OUT'], res = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i], c = n => r[hdr[n]];
    let dt = c('DATE/TIME'); const sku = String(c('SKU/ITEM CODE')).trim(), q = Number(c('QUANTITY'));
    if (!(dt instanceof Date)) { const p = new Date(dt); dt = isNaN(p) || dt === '' ? null : p; }
    if (!sku || !dt || !q) continue;
    let sec = secOf_(disp[i][tcol]); if (sec === null) sec = secOf_(Utilities.formatDate(dt, TZ(), 'HH:mm:ss'));
    const t = [Math.floor(sec / 3600), Math.floor(sec % 3600 / 60), sec % 60].map(x => ('0' + x).slice(-2)).join(':');
    res.push({ id: Number(c('ENTRY ID')) || 0, wk: Number(c('WEEK NO.')) || 0, d: Utilities.formatDate(dt, TZ(), 'yyyy-MM-dd'), t,
      shift: String(c('SHIFT')).trim(), q, sku, desc: String(c('DESCRIPTION')).trim(), cust: String(c('CUSTOMER')).trim(),
      fx: key === 'OUT' ? String(c('DELIVERED TO')).trim() : '' });
  }
  return res;
}
function readSkus_() {
  const { vals, hdr } = table_('SKU'), res = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i], sku = String(r[hdr['SKU']]).trim(); if (!sku) continue;
    const o = { sku, desc: String(r[hdr['DESCRIPTION']]).trim(), cust: String(r[hdr['CUSTOMER']]).trim() };
    if (hdr['BOX TYPE'] !== undefined && r[hdr['BOX TYPE']] !== '') o.box = String(r[hdr['BOX TYPE']]).trim();
    if (hdr['BOX CAPACITY'] !== undefined && r[hdr['BOX CAPACITY']] !== '') o.cap = String(r[hdr['BOX CAPACITY']]).trim();
    res.push(o);
  }
  return res;
}
const readAll_ = () => ({ ins: readTx_('IN'), outs: readTx_('OUT'), sku: readSkus_() });

/* ---------------- writing ---------------- */
function weekNo_(d) { // Excel WEEKNUM(date, 2), same as the old pages
  const y = +Utilities.formatDate(d, TZ(), 'yyyy'), m = +Utilities.formatDate(d, TZ(), 'M') - 1, day = +Utilities.formatDate(d, TZ(), 'd');
  const jan1 = new Date(Date.UTC(y, 0, 1)), doy = Math.round((Date.UTC(y, m, day) - jan1) / 864e5);
  return Math.floor((doy + (jan1.getUTCDay() + 6) % 7) / 7) + 1;
}
function check_(key, p) {
  const sku = readSkus_().find(s => norm(s.sku) === norm(p.sku));
  if (!sku) throw fail_('This SKU is not in the CORRUGATED SKU sheet.', 'VALID');
  const q = Number(p.qty);
  if (!Number.isInteger(q) || q < 1 || q > CONFIG.MAX_QTY) throw fail_('Quantity must be a whole number from 1 to ' + CONFIG.MAX_QTY + '.', 'VALID');
  if (CONFIG.SHIFTS.indexOf(p.shift) < 0) throw fail_('Select a valid shift.', 'VALID');
  if (key === 'OUT' && CONFIG.DESTINATIONS.indexOf(p.deliv) < 0) throw fail_('Select a valid flexo machine.', 'VALID');
  return { sku, q };
}
function write_(p, user) {
  const key = p.kind === 'out' ? 'OUT' : 'IN', need = p.action === 'add' ? 'ENCODER' : p.action === 'update' ? 'ENCODER' : 'ADMIN';
  if (ROLES[user.role] < ROLES[need]) throw fail_('Your role (' + user.role + ') cannot do this.', 'ROLE');
  const cache = CacheService.getScriptCache(), rk = p.reqId ? 'req:' + p.reqId : null;
  if (rk && cache.get(rk)) return JSON.parse(cache.get(rk)); // retry of an already-saved request
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const t = table_(key), { sh, vals, hdr } = t, idCol = hdr['ENTRY ID'];
    const findRow = id => { for (let i = 1; i < vals.length; i++) if (Number(vals[i][idCol]) === Number(id)) return i; return -1; };
    let result, detail;
    if (p.action === 'add') {
      const v = check_(key, p), now = new Date(); let maxId = 0;
      for (let i = 1; i < vals.length; i++) maxId = Math.max(maxId, Number(vals[i][idCol]) || 0);
      const secs = +Utilities.formatDate(now, TZ(), 'H') * 3600 + +Utilities.formatDate(now, TZ(), 'm') * 60 + +Utilities.formatDate(now, TZ(), 's');
      const row = new Array(vals[0].length).fill('');
      const put = (h, x) => { if (hdr[h] !== undefined) row[hdr[h]] = x; };
      put('ENTRY ID', maxId + 1); put('WEEK NO.', weekNo_(now)); put('DATE/TIME', now); put(key === 'IN' ? 'TIME IN' : 'TIME OUT', secs / 86400);
      put('SHIFT', p.shift); put('QUANTITY', v.q); put('SKU/ITEM CODE', v.sku.sku); put('DESCRIPTION', v.sku.desc); put('CUSTOMER', v.sku.cust);
      if (key === 'OUT') put('DELIVERED TO', p.deliv);
      const r = Math.max(sh.getLastRow(), 1) + 1;
      sh.getRange(r, 1, 1, row.length).setValues([row]);
      sh.getRange(r, hdr['DATE/TIME'] + 1).setNumberFormat('mm/dd/yyyy h:mm AM/PM');
      sh.getRange(r, hdr[key === 'IN' ? 'TIME IN' : 'TIME OUT'] + 1).setNumberFormat('h:mm:ss AM/PM');
      result = { ok: true, id: maxId + 1, row: r }; detail = v.q + ' x ' + v.sku.sku + (key === 'OUT' ? ' -> ' + p.deliv : '') + ' (' + p.shift + ')';
    } else {
      const i = findRow(p.id); if (i < 0) throw fail_('Entry #' + p.id + ' no longer exists. Refresh and try again.', 'VALID');
      if (p.action === 'delete') {
        detail = 'was ' + vals[i][hdr['QUANTITY']] + ' x ' + vals[i][hdr['SKU/ITEM CODE']]; sh.deleteRow(i + 1); result = { ok: true, id: p.id };
      } else {
        const v = check_(key, p), set = (h, x) => sh.getRange(i + 1, hdr[h] + 1).setValue(x);
        detail = 'was ' + vals[i][hdr['QUANTITY']] + ' x ' + vals[i][hdr['SKU/ITEM CODE']] + ' -> now ' + v.q + ' x ' + v.sku.sku;
        set('SHIFT', p.shift); set('QUANTITY', v.q); set('SKU/ITEM CODE', v.sku.sku); set('DESCRIPTION', v.sku.desc); set('CUSTOMER', v.sku.cust);
        if (key === 'OUT') set('DELIVERED TO', p.deliv);
        result = { ok: true, id: p.id };
      }
    }
    SS().getSheetByName(S.LOG).appendRow([new Date(), user.name, p.action.toUpperCase(), S[key], result.id, detail]);
    bump_(); result.version = ver_();
    if (rk) cache.put(rk, JSON.stringify(result), 600);
    return result;
  } finally { lock.releaseLock(); }
}

/* ---------------- change stamp (lets pages refresh only when something changed) ---------------- */
const ver_ = () => PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0';
const bump_ = () => PropertiesService.getScriptProperties().setProperty('DATA_VERSION', String(Date.now()));
