// Patients & medicine-course store (JSON file) + its API routes
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const DB_FILE = path.join(__dirname, 'data/db.json');
const LOCATIONS = [
  { id: 'jalgaon', name: 'Jalgaon', code: 'JAL' },
  { id: 'pune', name: 'Pune', code: 'PUN' },
];
const LOC_IDS = LOCATIONS.map(l => l.id);
const DOCTORS = [
  { id: 'kushal', name: 'Dr Kushal Somani' },
  { id: 'antim', name: 'Dr Antim Somani' },
];
const DOC_IDS = DOCTORS.map(d => d.id);
// Message templates staff can pick from before sending (editable in Settings)
const DEFAULT_TEMPLATES = [
  { id: 'before', name: 'Medicine running out',
    text: 'Namaste {first} 🙏\n\nYour medicines from Dr Somani\'s Homoeopathy ({clinic}) will finish on {lastTablet}. ' +
      'Please visit the clinic to collect your next medicines so there is no break in your treatment.\n\nFor any query, call us on {clinicPhone}.' },
  { id: 'complete', name: 'Medicines complete — collect next',
    text: 'Namaste {first} 🙏\n\nYour {days}-day medicines from {doctor} ({clinic}) are complete today. ' +
      'Please visit the clinic to collect your next medicines so your treatment continues without a break.\n\n' +
      'For any query, call us on {clinicPhone}.\n— Dr Somani\'s Homoeopathy' },
  { id: 'followup', name: 'Gentle follow-up',
    text: 'Namaste {first}, a gentle reminder from Dr Somani\'s Homoeopathy ({clinic}).\n\n' +
      'Your medicines were completed on {completed}. To keep your treatment on track, please visit us or reply here to arrange your next medicines. 🌿' },
  { id: 'final', name: 'Treatment plan complete — review',
    text: 'Namaste {first} 🙏\n\nToday completes your treatment plan with {doctor}. ' +
      'Please visit our {clinic} clinic for a review consultation so the doctor can plan the next step.\n\nFor any query, call us on {clinicPhone}.\n— Dr Somani\'s Homoeopathy' },
  { id: 'missed', name: 'Missed refill — gentle nudge',
    text: 'Namaste {first}, we noticed you haven\'t collected your medicines yet. Breaking the course can slow your recovery — ' +
      'please visit our {clinic} clinic soon, or call {clinicPhone}. 🌿' },
  { id: 'marathi', name: 'मराठी — औषध पूर्ण',
    text: 'नमस्कार {first} 🙏\n\nडॉ. सोमाणी होमिओपॅथी ({clinic}) कडून आठवण: आपला {days} दिवसांचा औषधोपचार पूर्ण झाला आहे. ' +
      'उपचार न थांबवता पुढील औषधे घेण्यासाठी कृपया क्लिनिकला भेट द्या.\n\nसंपर्क: {clinicPhone}' },
  { id: 'hindi', name: 'हिंदी — दवा पूरी',
    text: 'नमस्ते {first} 🙏\n\nडॉ. सोमाणी होमियोपैथी ({clinic}) की ओर से याद दिलाना: आपका {days} दिन का दवा कोर्स पूरा हो गया है। ' +
      'कृपया अगली दवाइयाँ लेने के लिए क्लिनिक आएँ।\n\nसंपर्क: {clinicPhone}' },
];
// Reminder plan: offsets in days from the completion day (the day after the last tablet)
const DEFAULT_SCHEDULE = [
  { id: 's1', offset: 0, templateId: 'complete' },
  { id: 's2', offset: 3, templateId: 'followup' },
  { id: 's3', offset: 7, templateId: 'final' },
];

// ---------- dates (all YYYY-MM-DD, India time) ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function todayIST() { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); }
function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function validDate(d) { return typeof d === 'string' && DATE_RE.test(d) && !isNaN(new Date(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d; }

// ---------- persistence ----------
let db = null;
db = load();

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const def = defaultSettings();
    const old = d.settings || {};
    d.settings = { ...def, ...old, clinics: { ...def.clinics, ...old.clinics } };
    // migrate v1 (single template + remindBefore) to templates + schedule
    if (!Array.isArray(old.templates)) {
      d.settings.templates = def.templates.map(t => (t.id === 'complete' && old.template ? { ...t, text: old.template } : t));
    }
    if (!d.settings.templates.some(t => t.id === 'before') && d.settings.templates.length < 12) d.settings.templates.unshift({ ...DEFAULT_TEMPLATES[0] });
    d.settings.planDefaults = { ...def.planDefaults, ...old.planDefaults, intervals: { ...def.planDefaults.intervals, ...(old.planDefaults || {}).intervals } };
    d.settings.doctorDefault = { ...def.doctorDefault, ...old.doctorDefault };
    if (!Array.isArray(old.schedule)) {
      d.settings.schedule = def.schedule.map((st, i) => (i === 0 ? { ...st, offset: -(old.remindBefore || 0) } : st));
    }
    delete d.settings.template; delete d.settings.remindBefore;
    // reminders are linked to plan steps by a stable id (not by position), so editing the plan can't move them
    d.settings.schedule.forEach((st, i) => { if (!st.id) st.id = 's' + (i + 1) + '-' + crypto.randomBytes(3).toString('hex'); });
    for (const c of d.courses) for (const r of c.reminders || []) {
      if (!r.stepId) r.stepId = (d.settings.schedule[r.step ?? 0] || d.settings.schedule[0]).id;
      delete r.step;
    }
    d.rev = d.rev || 1;
    return d;
  } catch (e) {
    if (e.code !== 'ENOENT') { console.error('db.json unreadable — refusing to overwrite it.', e.message); process.exit(1); }
    const fresh = { rev: 1, patients: [], courses: [], counters: { jalgaon: 0, pune: 0 }, settings: defaultSettings() };
    db = fresh;   // seed uses the plan builder, which reads settings from db
    require('./seed')(fresh, { todayIST, addDays, newId, nextRegNo: loc => nextRegNo(fresh, loc), buildPlan });
    write(fresh);
    return fresh;
  }
}
function defaultSettings() {
  return {
    templates: DEFAULT_TEMPLATES.map(t => ({ ...t })),
    // treatment plan: medicine every 14 or 28 days, one reminder on each refill day, ~6 months
    planDefaults: { intervals: { 14: 12, 28: 6 }, regularTpl: 'complete', lastTpl: 'final' },
    doctorDefault: { pune: 'kushal', jalgaon: 'antim' },
    schedule: DEFAULT_SCHEDULE.map(s => ({ ...s })),
    clinics: {
      jalgaon: { name: 'Jalgaon', phone: '+91 98341 72124' },
      pune: { name: 'Pune (Wakad)', phone: '+91 98341 72124' },
    },
  };
}
function write(d) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, DB_FILE);
}
function save() { db.rev = (db.rev || 0) + 1; write(db); }
// Recent changes, so other devices can fetch just what changed since their last sync
const changes = [];   // { rev, pid } | { rev, settings: true } | { rev, full: true }
function logChange(entry) { changes.push({ rev: db.rev, ...entry }); if (changes.length > 1000) changes.shift(); }
function deltaSince(since) {
  if (!changes.length || since < changes[0].rev - 1 || since > db.rev) return null;
  const after = changes.filter(c => c.rev > since);
  if (after.some(c => c.full)) return null;
  const pids = new Set(after.filter(c => c.pid).map(c => c.pid));
  const out = { rev: db.rev, today: todayIST(), delta: true,
    patch: { patients: db.patients.filter(p => pids.has(p.id)), patientIds: [...pids], courses: pids.size ? db.courses.filter(c => pids.has(c.patientId)) : [] } };
  if (after.some(c => c.settings)) out.settings = db.settings;
  return out;
}

function newId() { return crypto.randomUUID(); }
function nextRegNo(d, loc) {
  d.counters[loc] = (d.counters[loc] || 0) + 1;
  const code = LOCATIONS.find(l => l.id === loc).code;
  return `${code}-${String(d.counters[loc]).padStart(4, '0')}`;
}

// ---------- validation ----------
class Bad extends Error {}
function str(v, max, field, required) {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw new Bad(`${field} is required.`);
  if (s.length > max) throw new Bad(`${field} is too long (max ${max} characters).`);
  return s;
}
function phone(v) {
  let digits = String(v || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Bad('Enter a valid 10-digit mobile number.');
  return digits;
}
function days(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 90) throw new Bad('Medicine interval must be between 1 and 90 days.');
  return n;
}
function date(v, field) {
  if (!validDate(v)) throw new Bad(`${field} must be a valid date.`);
  return v;
}
function location(v) {
  if (!LOC_IDS.includes(v)) throw new Bad('Choose a clinic location.');
  return v;
}

function patientFields(b, existing = {}) {
  const age = b.age === '' || b.age == null ? null : Number(b.age);
  if (age != null && (!Number.isInteger(age) || age < 0 || age > 120)) throw new Bad('Age must be between 0 and 120.');
  const gender = b.gender || '';
  if (!['', 'M', 'F', 'O'].includes(gender)) throw new Bad('Invalid gender.');
  return {
    name: str(b.name, 100, 'Name', true),
    phone: phone(b.phone),
    altPhone: b.altPhone ? phone(b.altPhone) : '',
    age, gender,
    location: location(b.location ?? existing.location),
    doctor: (() => { const loc = b.location ?? existing.location; const v = b.doctor ?? existing.doctor ?? db.settings.doctorDefault[loc]; if (!DOC_IDS.includes(v)) throw new Bad('Choose a doctor.'); return v; })(),
    address: str(b.address, 200, 'Address'),
    complaint: str(b.complaint, 300, 'Chief complaint'),
    notes: str(b.notes, 1000, 'Notes'),
  };
}
const normName = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
function assertUniqueName(name, selfId) {
  const n = normName(name);
  const dup = db.patients.find(p => p.id !== selfId && normName(p.name) === n);
  if (dup) throw new Bad(`${dup.name} is already registered (${dup.regNo}). Open that patient instead of adding again.`);
}
// Treatment plan: medicine every `days` days, one reminder on each refill day (14DR1 = day 14, 14DR2 = day 28 …)
function defaultIntervals(days) {
  const iv = db.settings.planDefaults.intervals;
  return iv[days] || Math.max(1, Math.min(24, Math.round(168 / days)));
}
function buildPlan(days, n) {
  const pd = db.settings.planDefaults;
  const ids = new Set(db.settings.templates.map(t => t.id));
  const reg = ids.has(pd.regularTpl) ? pd.regularTpl : db.settings.templates[0].id;
  const last = ids.has(pd.lastTpl) ? pd.lastTpl : reg;
  return Array.from({ length: n }, (_, k) => ({ id: 'r' + (k + 1), offset: days * k, templateId: k === n - 1 && n > 1 ? last : reg }));
}
function intervals(v, days) {
  if (v === undefined || v === null || v === '') return defaultIntervals(days);
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 24) throw new Bad('Number of intervals must be between 1 and 24.');
  return n;
}
// A reminder plan: 1–5 steps, each N days from the completion day, with a saved message
function validatePlan(list, tplIds) {
  if (!Array.isArray(list) || !list.length || list.length > 5) throw new Bad('Choose 1 to 5 reminders.');
  const offs = new Set(), sids = new Set();
  return list.map(st => {
    if (!st || typeof st !== 'object') throw new Bad('Invalid reminder plan.');
    const offset = Number(st.offset);
    if (!Number.isInteger(offset) || offset < -3 || offset > 30) throw new Bad('Each reminder must be between 3 days before and 30 days after completion.');
    if (offs.has(offset)) throw new Bad('Two reminders can’t be on the same day.');
    offs.add(offset);
    const templateId = str(st.templateId, 40, 'Message', true);
    if (!tplIds.has(templateId)) throw new Bad('A reminder uses a message that isn’t saved yet — save messages first.');
    // keep an existing step's id so its sent reminders stay attached; new steps get a fresh id
    let id = typeof st.id === 'string' && /^[\w-]{1,40}$/.test(st.id) ? st.id : '';
    if (!id || sids.has(id)) id = 's' + crypto.randomBytes(4).toString('hex');
    sids.add(id);
    return { id, offset, templateId };
  }).sort((a, x) => a.offset - x.offset);
}
const tplIdSet = () => new Set(db.settings.templates.map(t => t.id));
const planOf = c => c.plan || db.settings.schedule;

function courseFields(b) {
  const start = date(b.startDate || todayIST(), 'Start date');
  if (start > addDays(todayIST(), 1)) throw new Bad('Start date can’t be in the future.');
  if (start < addDays(todayIST(), -366)) throw new Bad('Start date can’t be more than a year ago.');
  const d = days(b.days);
  const n = intervals(b.intervals, d);
  return { startDate: start, days: d, intervals: n, dueDate: addDays(start, d), plan: buildPlan(d, n), medicine: str(b.medicine, 300, 'Medicine notes') };
}

// ---------- operations ----------
function find(list, id) { const x = list.find(i => i.id === id); if (!x) throw new Bad('Not found.', 404); return x; }
function closeOpenCourses(patientId, by, status = 'collected') {
  for (const c of db.courses) {
    if (c.patientId === patientId && (c.status === 'active' || c.status === 'reminded')) {
      c.status = status; c.closedAt = new Date().toISOString(); c.closedBy = by;
    }
  }
}
function addCourse(patient, fields, by) {
  const c = { id: newId(), patientId: patient.id, location: patient.location, status: 'active', reminders: [],
    createdAt: new Date().toISOString(), createdBy: by, ...fields };
  db.courses.push(c);
  patient.lastVisit = fields.startDate;
  return c;
}

function snapshot() {
  return { rev: db.rev, patients: db.patients, courses: db.courses, settings: db.settings, locations: LOCATIONS, doctors: DOCTORS, today: todayIST() };
}
// Only what one patient's change touched — keeps responses small even with thousands of courses
function patchFor(pid) {
  const pt = db.patients.find(x => x.id === pid);
  return { rev: db.rev, today: todayIST(), patch: { patients: pt ? [pt] : [], patientIds: [pid], courses: db.courses.filter(c => c.patientId === pid) } };
}

// Returns true if it handled the route
async function api(req, res, p, user, { send, readBody }) {
  const m = req.method;
  const by = user.name || user.email;
  if (m !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    send(res, 415, { error: 'JSON required.' }); return true;
  }
  // Large JSON is gzipped when the browser accepts it
  const out = (code, obj) => {
    const json = JSON.stringify(obj);
    if (json.length > 8192 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      return send(res, code, zlib.gzipSync(json, { level: 6 }), { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    }
    send(res, code, Buffer.from(json), { 'Content-Type': 'application/json' });
  };
  let before = null;
  const ok = pid => { save(); logChange(pid ? { pid } : { full: true }); out(200, pid ? patchFor(pid) : snapshot()); return true; };
  let mm, b = {};
  try {
    if (m !== 'GET' && m !== 'DELETE') b = await readBody(req);
    // Every change is all-or-nothing: if validation or the disk write fails, roll back to this copy.
    // Taken after the body is read, so nothing else can run between the copy and the change.
    if (m !== 'GET') before = structuredClone(db);

    if (p === '/api/data' && m === 'GET') {
      const since = Number(new URL(req.url, 'http://x').searchParams.get('since'));
      if (since && since === db.rev) { send(res, 200, { unchanged: true, rev: db.rev, today: todayIST() }); return true; }
      const delta = since ? deltaSince(since) : null;
      out(200, delta || snapshot()); return true;
    }

    if (p === '/api/patients' && m === 'POST') {
      const f = patientFields(b);
      assertUniqueName(f.name);
      const cf = courseFields(b.course || {});
      const pt = { id: newId(), regNo: nextRegNo(db, f.location), ...f, createdAt: new Date().toISOString(), createdBy: by };
      db.patients.push(pt);
      addCourse(pt, cf, by);
      return ok(pt.id);
    }
    if ((mm = p.match(/^\/api\/patients\/([\w-]+)$/)) && m === 'PUT') {
      const pt = find(db.patients, mm[1]);
      const f = patientFields(b, pt);
      assertUniqueName(f.name, pt.id);
      if (f.location !== pt.location) {           // moved clinic: open courses follow the patient
        for (const c of db.courses) if (c.patientId === pt.id && (c.status === 'active' || c.status === 'reminded')) c.location = f.location;
      }
      Object.assign(pt, f, { updatedAt: new Date().toISOString(), updatedBy: by });
      return ok(pt.id);
    }
    if ((mm = p.match(/^\/api\/patients\/([\w-]+)\/archive$/)) && m === 'POST') {
      const pt = find(db.patients, mm[1]);
      pt.archived = !!b.archived;
      if (pt.archived) closeOpenCourses(pt.id, by, 'stopped');
      return ok(pt.id);
    }
    // New course for a returning patient (closes any open course as collected)
    if ((mm = p.match(/^\/api\/patients\/([\w-]+)\/courses$/)) && m === 'POST') {
      const pt = find(db.patients, mm[1]);
      if (pt.archived) throw new Bad('Restore this patient before starting a new course.');
      const cf = courseFields(b);
      closeOpenCourses(pt.id, by, 'collected');
      addCourse(pt, cf, by);
      return ok(pt.id);
    }
    if ((mm = p.match(/^\/api\/courses\/([\w-]+)\/plan$/)) && m === 'PUT') {
      const c = find(db.courses, mm[1]);
      const n = intervals(b.intervals, c.days);                // regenerate r1..rN; sent reminders keep their ids
      c.intervals = n; c.plan = buildPlan(c.days, n);
      return ok(c.patientId);
    }
    if ((mm = p.match(/^\/api\/courses\/([\w-]+)\/(remind|unremind|stop|reopen)$/)) && m === 'POST') {
      const c = find(db.courses, mm[1]);
      const action = mm[2];
      if (action === 'remind') {
        if (c.status !== 'active' && c.status !== 'reminded') throw new Bad('This course is already closed.');
        const stepId = str(b.stepId, 40, 'Reminder step', true);
        if (!planOf(c).some(st => st.id === stepId)) throw new Bad('This reminder step no longer exists — refresh the page.');
        if (c.reminders.some(r => r.stepId === stepId)) throw new Bad('This reminder is already marked as sent.');
        const templateId = b.templateId ? str(b.templateId, 40, 'Template') : '';
        c.reminders.push({ at: new Date().toISOString(), by, stepId, templateId,
          channel: str(b.channel || 'whatsapp', 20, 'Channel'), note: str(b.note, 300, 'Note') });
        c.status = 'reminded';
      } else if (action === 'unremind') {
        const stepId = b.stepId == null ? null : String(b.stepId);
        let i = -1;
        for (let k = c.reminders.length - 1; k >= 0; k--) if (stepId == null || c.reminders[k].stepId === stepId) { i = k; break; }
        if (i < 0) throw new Bad('Nothing to undo.');
        c.reminders.splice(i, 1);
        if (c.status === 'reminded' && !c.reminders.length) c.status = 'active';
      } else if (action === 'stop') {
        if (c.status !== 'active' && c.status !== 'reminded') throw new Bad('This course is already closed.');
        c.status = 'stopped'; c.closedAt = new Date().toISOString(); c.closedBy = by; c.stopReason = str(b.reason, 200, 'Reason');
      } else if (action === 'reopen') {
        if (c.status === 'active' || c.status === 'reminded') throw new Bad('This course is already open.');
        const other = db.courses.find(o => o.patientId === c.patientId && o.id !== c.id && (o.status === 'active' || o.status === 'reminded'));
        if (other) throw new Bad('This patient already has an open course.');
        c.status = c.reminders.length ? 'reminded' : 'active'; delete c.closedAt; delete c.closedBy; delete c.stopReason;
      }
      return ok(c.patientId);
    }
    if (p === '/api/settings' && m === 'PUT') {
      const s = db.settings;
      if (b.templates !== undefined) {
        if (!Array.isArray(b.templates) || !b.templates.length || b.templates.length > 12) throw new Bad('Keep between 1 and 12 messages.');
        const seen = new Set();
        s.templates = b.templates.map(t => {
          const id = str(t && t.id, 40, 'Message id', true);
          if (!/^[\w-]+$/.test(id) || seen.has(id)) throw new Bad('Invalid message id.');
          seen.add(id);
          return { id, name: str(t.name, 40, 'Message name', true), text: str(t.text, 1500, 'Message text', true) };
        });
      }
      if (b.schedule !== undefined) s.schedule = validatePlan(b.schedule, new Set(s.templates.map(t => t.id)));
      // a deleted message falls back to the first one
      const ids = new Set(s.templates.map(t => t.id));
      for (const st of s.schedule) if (!ids.has(st.templateId)) st.templateId = s.templates[0].id;
      for (const c of db.courses) for (const st of c.plan || []) if (!ids.has(st.templateId)) st.templateId = s.templates[0].id;
      if (b.planDefaults) {
        const pd = b.planDefaults, ids = new Set(s.templates.map(t => t.id));
        const iv = {};
        for (const k of ['14', '28']) {
          const n = Number(pd.intervals?.[k]);
          if (!Number.isInteger(n) || n < 1 || n > 24) throw new Bad('Number of intervals must be between 1 and 24.');
          iv[k] = n;
        }
        if (!ids.has(pd.regularTpl) || !ids.has(pd.lastTpl)) throw new Bad('Choose saved messages for the reminders.');
        s.planDefaults = { intervals: iv, regularTpl: pd.regularTpl, lastTpl: pd.lastTpl };
      }
      if (b.doctorDefault) for (const id of LOC_IDS) if (b.doctorDefault[id]) {
        if (!DOC_IDS.includes(b.doctorDefault[id])) throw new Bad('Unknown doctor.');
        s.doctorDefault[id] = b.doctorDefault[id];
      }
      if (b.clinics) for (const id of LOC_IDS) if (b.clinics[id]) {
        s.clinics[id] = {
          name: str(b.clinics[id].name, 60, 'Clinic name', true),
          phone: b.clinics[id].phone ? str(b.clinics[id].phone, 20, 'Clinic phone') : '',
        };
      }
      save(); logChange({ settings: true }); out(200, { rev: db.rev, today: todayIST(), settings: db.settings }); return true;
    }
    if (p === '/api/sample' && m === 'DELETE') {
      const ids = new Set(db.patients.filter(x => x.sample).map(x => x.id));
      db.patients = db.patients.filter(x => !ids.has(x.id));
      db.courses = db.courses.filter(c => !ids.has(c.patientId));
      if (!db.patients.length) db.counters = { jalgaon: 0, pune: 0 };
      return ok();
    }
  } catch (e) {
    if (before) db = before;
    if (e instanceof Bad) { send(res, e.message === 'Not found.' ? 404 : 400, { error: e.message }); return true; }
    if (e.message === 'too large') { send(res, 413, { error: 'That’s too much text to save at once.' }); return true; }
    if (e.message === 'not an object' || e instanceof SyntaxError) { send(res, 400, { error: 'Invalid request.' }); return true; }
    throw e;
  }
  send(res, 404, { error: 'Not found.' });
  return true;
}

module.exports = { api, LOCATIONS };
