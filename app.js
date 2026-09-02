"use strict";

/* ============================================================
   Gradezilla — suivi de notes, calculateur "note necessaire",
   GPA cumulatif (Concordia, echelle 4.30) + import de documents
   via l'API Claude. Donnees locales (localStorage + IndexedDB).
   ============================================================ */

const STORE_KEY = "gradezilla_v1";

const LETTERS = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];

const GPA_POINTS = {
  "A+": 4.3, "A": 4.0, "A-": 3.7,
  "B+": 3.3, "B": 3.0, "B-": 2.7,
  "C+": 2.3, "C": 2.0, "C-": 1.7,
  "D+": 1.3, "D": 1.0, "D-": 0.7,
  "F": 0.0,
};

// Seuils %→lettre par defaut (schema courant en genie a Concordia — editable par cours).
const DEFAULT_SCALE = [
  { letter: "A+", min: 90 }, { letter: "A", min: 85 }, { letter: "A-", min: 80 },
  { letter: "B+", min: 77 }, { letter: "B", min: 73 }, { letter: "B-", min: 70 },
  { letter: "C+", min: 67 }, { letter: "C", min: 63 }, { letter: "C-", min: 60 },
  { letter: "D+", min: 57 }, { letter: "D", min: 53 }, { letter: "D-", min: 50 },
  { letter: "F", min: 0 },
];

const TAGLINES = [
  "Nourris le monstre avec tes syllabus 🦖",
  "Un syllabus par-ci, une note par-la…",
  "Gradezilla a calcule ta trajectoire.",
  "Vise la lettre, pas le stress.",
  "Chaque % compte, mais pas trop.",
  "Le final, c'est juste le boss de fin.",
];

/* ---------- utilitaires ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function fmt(n, d = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 10 ** d) / 10 ** d;
  return String(r);
}
function gfmt(n) { return (n === null || n === undefined || !Number.isFinite(n)) ? "—" : n.toFixed(2); }
function defaultScaleRows() {
  try { if (db && db.settings && Array.isArray(db.settings.defaultScale) && db.settings.defaultScale.length) return db.settings.defaultScale; } catch (e) { /* TDZ au tout premier chargement */ }
  return DEFAULT_SCALE;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function validDate(s) {
  if (!s) return "";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
function daysUntil(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

/* ============================================================
   Etat / persistance
   ============================================================ */
function blankCourse(code = "", title = "") {
  return {
    id: uid(), code, title, credits: 3, target: "A-",
    instructor: "", email: "", room: "", officeHours: "", latePolicy: "",
    scale: defaultScaleRows().map((x) => ({ ...x })),
    components: [], files: [], _missing: [],
  };
}

function defaultDB() {
  const session = {
    id: uid(),
    name: "Automne 2026",
    start: "2026-09-08", end: "2026-12-03",
    archived: false,
    courses: [
      blankCourse("MATH 205", "Differential & Integral Calculus II"),
      blankCourse("CHEM 205", "General Chemistry"),
      blankCourse("PHYS 205", "Mechanics"),
      blankCourse("RELI 226", "Religion course"),
    ],
  };
  return {
    version: 1,
    currentSessionId: session.id,
    sessions: [session],
    past: [],
    settings: {
      apiKey: "", model: "claude-sonnet-5", dark: false, gpaIncludeProjected: true,
      defaultScale: DEFAULT_SCALE.map((x) => ({ ...x })),
    },
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultDB();
    const parsed = JSON.parse(raw);
    // garde-fous minimaux
    if (!parsed.sessions || !Array.isArray(parsed.sessions) || !parsed.sessions.length) return defaultDB();
    parsed.past = parsed.past || [];
    parsed.settings = Object.assign({ apiKey: "", model: "claude-sonnet-5", dark: false, gpaIncludeProjected: true }, parsed.settings || {});
    if (!Array.isArray(parsed.settings.defaultScale) || !parsed.settings.defaultScale.length) {
      parsed.settings.defaultScale = DEFAULT_SCALE.map((x) => ({ ...x }));
    }
    parsed.sessions.forEach((s) => {
      s.courses = s.courses || [];
      s.courses.forEach((c) => {
        c.scale = (c.scale && c.scale.length) ? c.scale : DEFAULT_SCALE.map((x) => ({ ...x }));
        c.components = c.components || [];
        c.files = c.files || [];
        c._missing = c._missing || [];
        c.components.forEach((comp) => { comp.items = comp.items || []; });
      });
    });
    return parsed;
  } catch (e) {
    console.error("loadDB", e);
    return defaultDB();
  }
}

let db = loadDB();
function saveDB() { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }

function currentSession() {
  return db.sessions.find((s) => s.id === db.currentSessionId) || db.sessions[0];
}
function findCourse(id) {
  for (const s of db.sessions) {
    const c = s.courses.find((x) => x.id === id);
    if (c) return { session: s, course: c };
  }
  return null;
}

/* ============================================================
   IndexedDB — stockage des fichiers source
   ============================================================ */
let _idb = null;
function openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("gradezilla-files", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("files")) {
        req.result.createObjectStore("files", { keyPath: "id" });
      }
    };
    req.onsuccess = () => { _idb = req.result; resolve(_idb); };
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(rec) {
  const d = await openIDB();
  return new Promise((res, rej) => {
    const tx = d.transaction("files", "readwrite");
    tx.objectStore("files").put(rec);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(id) {
  const d = await openIDB();
  return new Promise((res, rej) => {
    const r = d.transaction("files", "readonly").objectStore("files").get(id);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDelete(id) {
  const d = await openIDB();
  return new Promise((res, rej) => {
    const tx = d.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

/* ============================================================
   Maths des notes
   ============================================================ */
function letterForPct(scale, p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return null;
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  for (const row of sorted) if (p >= row.min) return row.letter;
  return "F";
}
function gpaForLetter(l) { return l && (l in GPA_POINTS) ? GPA_POINTS[l] : null; }
function minPctForLetter(scale, letter) {
  const row = scale.find((r) => r.letter === letter);
  return row ? row.min : null;
}

/**
 * Decompose un cours en "points" sur l'echelle des ponderations reelles.
 * Chaque composante repartit son poids en "cases" egales :
 *  - regle best_k_of_n : k cases (poids/k chacune), on garde les k meilleures notes
 *  - regle drop_lowest : (nb items - n) cases
 *  - sinon : 1 case par item
 */
function courseBreakdown(course) {
  let locked = 0, lockedWeight = 0, remainingWeight = 0;
  const totalWeight = course.components.reduce((s, c) => s + (num(c.weight) || 0), 0);

  for (const c of course.components) {
    const w = num(c.weight) || 0;
    if (w <= 0) continue;
    const items = (c.items && c.items.length) ? c.items : [{ grade: null, max: 100 }];
    const gradedScores = items
      .filter((it) => num(it.grade) !== null)
      .map((it) => (num(it.grade) / (num(it.max) || 100)) * 100)
      .sort((a, b) => b - a);

    let slots, perSlot, kept;
    if (c.rule && c.rule.type === "best_k_of_n" && c.rule.keep > 0) {
      slots = c.rule.keep;
      perSlot = w / slots;
      kept = gradedScores.slice(0, slots);
    } else if (c.rule && c.rule.type === "drop_lowest" && c.rule.n > 0) {
      slots = Math.max(1, items.length - c.rule.n);
      perSlot = w / slots;
      kept = gradedScores.slice(0, slots);
    } else {
      slots = items.length;
      perSlot = w / slots;
      kept = gradedScores;
    }
    const countGraded = kept.length;
    const sum = kept.reduce((a, b) => a + b, 0);
    locked += (sum / 100) * perSlot;
    lockedWeight += countGraded * perSlot;
    remainingWeight += Math.max(0, slots - countGraded) * perSlot;
  }
  const standingPct = lockedWeight > 0 ? (locked / lockedWeight) * 100 : null;
  return { locked, lockedWeight, remainingWeight, totalWeight, standingPct };
}

function currentLetter(course) {
  const bd = courseBreakdown(course);
  return bd.standingPct === null ? null : letterForPct(course.scale, bd.standingPct);
}

/** Calcul "note necessaire" pour atteindre `targetLetter`. */
function requiredForTarget(course, targetLetter) {
  const bd = courseBreakdown(course);
  const { locked, remainingWeight, totalWeight } = bd;
  const targetMin = minPctForLetter(course.scale, targetLetter);

  if (totalWeight <= 0) return { state: "no-weight", bd };

  const minPct = (locked / totalWeight) * 100;                       // si 0% sur le reste
  const maxPct = ((locked + remainingWeight) / totalWeight) * 100;   // si 100% sur le reste
  const bestLetter = letterForPct(course.scale, maxPct);
  const worstLetter = letterForPct(course.scale, minPct);

  if (remainingWeight < 0.001) {
    return { state: "locked", bd, finalPct: minPct, finalLetter: letterForPct(course.scale, minPct), targetMin, minPct, maxPct, bestLetter, worstLetter, remainingWeight };
  }

  const neededPoints = (targetMin / 100) * totalWeight - locked;
  const required = (neededPoints / remainingWeight) * 100;

  let state = "need";
  if (required <= 0) state = "secured";
  else if (required > 100) state = "impossible";

  return { state, bd, required, targetMin, minPct, maxPct, bestLetter, worstLetter, remainingWeight };
}

/* ---------- agregats session / GPA ---------- */
function sessionGPA(session) {
  let pts = 0, cr = 0, n = 0;
  for (const c of session.courses) {
    const l = currentLetter(c);
    const credits = num(c.credits) || 0;
    if (l && credits > 0) { pts += gpaForLetter(l) * credits; cr += credits; n++; }
  }
  return { gpa: cr > 0 ? pts / cr : null, credits: cr, n };
}
function sessionAvgPct(session) {
  let sum = 0, cr = 0;
  for (const c of session.courses) {
    const bd = courseBreakdown(c);
    const credits = num(c.credits) || 0;
    if (bd.standingPct !== null && credits > 0) { sum += bd.standingPct * credits; cr += credits; }
  }
  return cr > 0 ? sum / cr : null;
}
function cumulativeGPA(includeProjected) {
  let pts = 0, cr = 0;
  for (const p of db.past) {
    const credits = num(p.credits) || 0;
    const g = gpaForLetter(p.letter);
    if (g !== null && credits > 0) { pts += g * credits; cr += credits; }
  }
  for (const s of db.sessions) {
    if (!s.archived && !includeProjected) continue;
    for (const c of s.courses) {
      const l = currentLetter(c);
      const credits = num(c.credits) || 0;
      if (l && credits > 0) { pts += gpaForLetter(l) * credits; cr += credits; }
    }
  }
  return { gpa: cr > 0 ? pts / cr : null, credits: cr };
}

/* ============================================================
   Rendu
   ============================================================ */
let activeView = "view-courses";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

function applyTheme() {
  document.body.classList.toggle("dark", !!db.settings.dark);
}

function render() {
  applyTheme();
  if (activeView === "view-courses") renderCourses();
  else if (activeView === "view-dates") renderDates();
  else if (activeView === "view-gpa") renderGPA();
  else if (activeView === "view-settings") renderSettings();
}

/* ---------- vue COURS ---------- */
function renderCourses() {
  const sel = $("#session-select");
  sel.innerHTML = db.sessions.map((s) =>
    `<option value="${s.id}" ${s.id === db.currentSessionId ? "selected" : ""}>${esc(s.name)}${s.archived ? " (archivee)" : ""}</option>`
  ).join("");

  const session = currentSession();
  const g = sessionGPA(session);
  const avg = sessionAvgPct(session);
  $("#session-summary").innerHTML = `
    <div class="summary-row">
      <div class="summary-metric">
        <span class="metric-value">${gfmt(g.gpa)}</span>
        <span class="metric-label">GPA session</span>
      </div>
      <div class="summary-metric">
        <span class="metric-value">${avg === null ? "—" : fmt(avg, 1) + "%"}</span>
        <span class="metric-label">Moyenne pondérée</span>
      </div>
      <div class="summary-metric">
        <span class="metric-value">${g.n}/${session.courses.length}</span>
        <span class="metric-label">Cours notés</span>
      </div>
    </div>`;

  const list = $("#course-list");
  if (!session.courses.length) {
    list.innerHTML = `<p class="empty">Aucun cours. Ajoute-en un ou importe un syllabus.</p>`;
    return;
  }
  list.innerHTML = session.courses.map((c) => {
    const bd = courseBreakdown(c);
    const l = currentLetter(c);
    const req = requiredForTarget(c, c.target);
    let line = "";
    if (req.state === "no-weight") line = `<span class="muted">Ajoute les composantes du cours</span>`;
    else if (req.state === "locked") line = `Note finale : <strong>${fmt(req.finalPct)}%</strong> · ${req.finalLetter}`;
    else if (req.state === "secured") line = `<span class="ok">${c.target} déjà assuré</span> même à 0% sur le reste`;
    else if (req.state === "impossible") line = `<span class="bad">${c.target} hors d'atteinte</span> · max ${fmt(req.maxPct)}% (${req.bestLetter})`;
    else line = `Pour <strong>${c.target}</strong> : besoin de <strong>${fmt(req.required)}%</strong> sur les ${fmt(req.remainingWeight)}% restants`;

    return `
      <button type="button" class="course-card" data-open-course="${c.id}">
        <div class="course-card-top">
          <span class="course-code">${esc(c.code || "Sans nom")}</span>
          <span class="letter-chip ${l ? "" : "empty"}">${l || "—"}</span>
        </div>
        ${c.title ? `<div class="course-title">${esc(c.title)}</div>` : ""}
        <div class="course-standing">${bd.standingPct === null ? '<span class="muted">Aucune note entrée</span>' : "Note actuelle : <strong>" + fmt(bd.standingPct) + "%</strong>"}</div>
        <div class="course-need">${line}</div>
      </button>`;
  }).join("");
}

/* ---------- vue DATES ---------- */
function slotWeight(component) {
  const w = num(component.weight) || 0;
  const items = (component.items && component.items.length) ? component.items : [{}];
  let slots;
  if (component.rule && component.rule.type === "best_k_of_n" && component.rule.keep > 0) slots = component.rule.keep;
  else if (component.rule && component.rule.type === "drop_lowest" && component.rule.n > 0) slots = Math.max(1, items.length - component.rule.n);
  else slots = items.length;
  return slots > 0 ? w / slots : w;
}

function renderDates() {
  const session = currentSession();
  const rows = [];
  for (const c of session.courses) {
    for (const comp of c.components) {
      for (const it of comp.items) {
        if (!it.date) continue;
        if (num(it.grade) !== null) continue; // deja fait
        rows.push({
          date: it.date,
          d: daysUntil(it.date),
          code: c.code || "Sans nom",
          comp: comp.name,
          item: it.name || comp.name,
          weight: slotWeight(comp),
        });
      }
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const el = $("#dates-list");
  if (!rows.length) {
    el.innerHTML = `<p class="empty">Aucune échéance à venir dans « ${esc(session.name)} ».<br>Ajoute des dates dans tes cours ou importe un syllabus.</p>`;
    return;
  }
  const bucket = (r) => (r.d < 0 ? "En retard" : r.d <= 7 ? "Cette semaine" : r.d <= 21 ? "Dans 3 semaines" : "Plus tard");
  let html = "", lastBucket = null;
  for (const r of rows) {
    const b = bucket(r);
    if (b !== lastBucket) { html += `<h3 class="dates-bucket">${b}</h3>`; lastBucket = b; }
    const when = r.d < 0 ? `il y a ${-r.d} j` : r.d === 0 ? "aujourd'hui" : r.d === 1 ? "demain" : `dans ${r.d} j`;
    html += `
      <div class="date-row ${r.d < 0 ? "overdue" : r.d <= 7 ? "soon" : ""}">
        <div class="date-main">
          <span class="date-item">${esc(r.item)}</span>
          <span class="date-course">${esc(r.code)} · ${esc(r.comp)}</span>
        </div>
        <div class="date-side">
          <span class="date-when">${when}</span>
          <span class="date-weight">~${fmt(r.weight)}%</span>
        </div>
      </div>`;
  }
  el.innerHTML = html;
}

/* ---------- vue GPA ---------- */
function renderGPA() {
  $("#gpa-include-projected").checked = !!db.settings.gpaIncludeProjected;
  const cum = cumulativeGPA(db.settings.gpaIncludeProjected);
  $("#gpa-summary").innerHTML = `
    <div class="summary-row">
      <div class="summary-metric big">
        <span class="metric-value">${gfmt(cum.gpa)}</span>
        <span class="metric-label">GPA cumulatif / 4.30</span>
      </div>
      <div class="summary-metric">
        <span class="metric-value">${fmt(cum.credits, 1)}</span>
        <span class="metric-label">Crédits comptés</span>
      </div>
    </div>`;

  let html = "";
  for (const s of db.sessions) {
    const g = sessionGPA(s);
    html += `<div class="gpa-session">
      <div class="gpa-session-head">
        <span>${esc(s.name)}${s.archived ? " · archivée" : ""}</span>
        <span class="letter-chip ${g.gpa === null ? "empty" : ""}">${gfmt(g.gpa)}</span>
      </div>`;
    for (const c of s.courses) {
      const l = currentLetter(c);
      html += `<div class="gpa-course">
        <span>${esc(c.code || "Sans nom")} <span class="muted">· ${fmt(num(c.credits) || 0, 1)} cr</span></span>
        <span class="letter-chip ${l ? "" : "empty"}">${l || "—"}</span>
      </div>`;
    }
    html += `</div>`;
  }
  if (db.past.length) {
    html += `<div class="gpa-session"><div class="gpa-session-head"><span>Antérieurs / externes</span><span></span></div>`;
    db.past.forEach((p) => {
      html += `<div class="gpa-course">
        <span>${esc(p.term || "")} — ${esc(p.code || "")} <span class="muted">· ${fmt(num(p.credits) || 0, 1)} cr</span></span>
        <span>
          <span class="letter-chip">${esc(p.letter)}</span>
          <button type="button" class="mini-del" data-del-past="${p.id}" aria-label="Supprimer">&#10005;</button>
        </span>
      </div>`;
    });
    html += `</div>`;
  }
  $("#gpa-sessions").innerHTML = html;
}

/* ---------- vue REGLAGES ---------- */
function renderSettings() {
  $("#api-key-input").value = db.settings.apiKey || "";
  $("#model-select").value = db.settings.model || "claude-sonnet-5";
  $("#dark-toggle").checked = !!db.settings.dark;
  renderScaleEditor($("#default-scale-editor"), db.settings.defaultScale, () => saveDB());
}

function renderScaleEditor(container, scale, onChange) {
  container.innerHTML = scale.map((r, i) => `
    <div class="scale-row">
      <span class="scale-letter">${r.letter}</span>
      <span class="scale-geq">≥</span>
      <input type="number" min="0" max="100" step="0.5" value="${r.min}" data-scale-idx="${i}" ${onChange ? "" : "disabled"}>
      <span class="scale-pct">%</span>
    </div>`).join("");
  if (onChange) {
    container.oninput = (e) => {
      const idx = e.target.dataset.scaleIdx;
      if (idx === undefined) return;
      scale[+idx].min = num(e.target.value) ?? 0;
      onChange();
    };
  }
}

/* ============================================================
   Detail d'un cours
   ============================================================ */
let openCourseId = null;

function ruleBadge(rule) {
  if (!rule) return "";
  if (rule.type === "best_k_of_n") return `<span class="rule-badge">garde ${rule.keep}/${rule.of}</span>`;
  if (rule.type === "drop_lowest") return `<span class="rule-badge">retire ${rule.n} pire${rule.n > 1 ? "s" : ""}</span>`;
  return "";
}

function courseDetailHTML(c) {
  const bd = courseBreakdown(c);
  const l = currentLetter(c);
  const req = requiredForTarget(c, c.target);
  const weightSum = bd.totalWeight;

  let needBlock;
  if (req.state === "no-weight") {
    needBlock = `<p class="muted">Ajoute au moins une composante avec une pondération pour activer le calcul.</p>`;
  } else if (req.state === "locked") {
    needBlock = `<p>Toutes les notes sont entrées. Note finale : <strong>${fmt(req.finalPct)}%</strong> → <strong>${req.finalLetter}</strong>.</p>`;
  } else {
    const pieces = [];
    if (req.state === "secured") {
      pieces.push(`<p class="ok">✔ <strong>${c.target}</strong> est déjà assuré, même avec 0% sur ce qui reste.</p>`);
    } else if (req.state === "impossible") {
      pieces.push(`<p class="bad">⚠ <strong>${c.target}</strong> n'est plus atteignable. Le maximum possible est <strong>${fmt(req.maxPct)}%</strong> (${req.bestLetter}).</p>`);
    } else {
      pieces.push(`<p>Il te reste <strong>${fmt(req.remainingWeight)}%</strong> du cours à faire. Pour viser <strong>${c.target}</strong> (≥ ${fmt(req.targetMin)}%), il te faut une moyenne de <strong class="big-need">${fmt(req.required)}%</strong> sur tout ce qui reste.</p>`);
    }
    pieces.push(`<p class="range-line">Fourchette finale possible : <strong>${fmt(req.minPct)}%</strong> (${req.worstLetter}) → <strong>${fmt(req.maxPct)}%</strong> (${req.bestLetter}).</p>`);
    needBlock = pieces.join("");
  }

  const missingBanner = (c._missing && c._missing.length) ? `
    <div class="missing-banner">
      <div class="missing-head"><strong>À compléter à la main</strong>
        <button type="button" class="mini-link" data-act="clear-missing">Masquer</button></div>
      <ul>${c._missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
    </div>` : "";

  const weightWarn = (c.components.length && Math.abs(weightSum - 100) > 0.5) ? `
    <div class="warn-line">Les pondérations totalisent <strong>${fmt(weightSum)}%</strong> (attendu 100%).</div>` : "";

  const comps = c.components.map((comp) => {
    const rows = (comp.items.length ? comp.items : []).map((it) => `
      <tr data-comp="${comp.id}" data-item="${it.id}">
        <td><input type="text" class="cell-name" value="${esc(it.name)}" data-field="name" placeholder="Nom"></td>
        <td><input type="date" class="cell-date" value="${esc(it.date)}" data-field="date"></td>
        <td><input type="number" class="cell-grade" value="${it.grade ?? ""}" data-field="grade" placeholder="—" step="0.5"></td>
        <td class="cell-slash">/</td>
        <td><input type="number" class="cell-max" value="${it.max ?? 100}" data-field="max" step="1"></td>
        <td><button type="button" class="mini-del" data-act="del-item" aria-label="Supprimer">&#10005;</button></td>
      </tr>`).join("");
    return `
      <div class="comp-card" data-comp="${comp.id}">
        <div class="comp-head">
          <input type="text" class="comp-name" value="${esc(comp.name)}" data-field="comp-name" placeholder="Composante">
          <span class="comp-weight-wrap"><input type="number" class="comp-weight" value="${comp.weight ?? ""}" data-field="comp-weight" step="1">%</span>
        </div>
        <div class="comp-sub">
          ${ruleBadge(comp.rule)}
          <button type="button" class="mini-link" data-act="edit-rule">Règle spéciale…</button>
          <button type="button" class="mini-link danger" data-act="del-comp">Supprimer la composante</button>
        </div>
        <div class="items-table-wrap">
          <table class="items-table">
            <thead><tr><th>Élément</th><th>Date</th><th>Note</th><th></th><th>Max</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <button type="button" class="mini-add" data-act="add-item">+ Élément</button>
      </div>`;
  }).join("");

  const filesHTML = c.files.length
    ? c.files.map((f) => `
        <div class="file-row">
          <button type="button" class="file-open" data-act="open-file" data-file="${f.id}">📄 ${esc(f.name)}</button>
          <button type="button" class="mini-del" data-act="del-file" data-file="${f.id}" aria-label="Supprimer">&#10005;</button>
        </div>`).join("")
    : `<p class="muted">Aucun document.</p>`;

  return `
    <div class="cd-header">
      <input type="text" class="cd-code" value="${esc(c.code)}" data-field="code" placeholder="MATH 205">
      <input type="text" class="cd-title" value="${esc(c.title)}" data-field="title" placeholder="Titre du cours">
      <div class="cd-meta">
        <label>Crédits <input type="number" class="cd-credits" value="${c.credits ?? ""}" data-field="credits" step="0.25" min="0"></label>
        <label>Objectif
          <select class="cd-target" data-field="target">
            ${LETTERS.map((x) => `<option value="${x}" ${x === c.target ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
      </div>
    </div>

    <div class="cd-stat">
      <div><span class="cd-stat-val">${bd.standingPct === null ? "—" : fmt(bd.standingPct) + "%"}</span><span class="cd-stat-lab">Note actuelle</span></div>
      <div><span class="cd-stat-val letter-chip ${l ? "" : "empty"}">${l || "—"}</span><span class="cd-stat-lab">Lettre</span></div>
      <div><span class="cd-stat-val">${l ? gfmt(gpaForLetter(l)) : "—"}</span><span class="cd-stat-lab">GPA</span></div>
    </div>

    ${missingBanner}

    <div class="need-box">
      <h3>🎯 Note nécessaire</h3>
      ${needBlock}
      <p class="method-note">Méthode : chaque composante répartit son poids également entre ses éléments ; les règles « garde k/n » et « retire la pire » sont prises en compte.</p>
    </div>

    ${weightWarn}

    <div class="cd-section">
      <div class="cd-section-head"><h3>Composantes &amp; notes</h3><button type="button" class="mini-add" data-act="add-comp">+ Composante</button></div>
      ${comps || '<p class="muted">Aucune composante. Ajoute-les ou importe le syllabus.</p>'}
    </div>

    <details class="cd-section">
      <summary>Infos du cours</summary>
      <label class="stack">Enseignant·e <input type="text" data-field="instructor" value="${esc(c.instructor)}"></label>
      <label class="stack">Courriel <input type="text" data-field="email" value="${esc(c.email)}"></label>
      <label class="stack">Local <input type="text" data-field="room" value="${esc(c.room)}"></label>
      <label class="stack">Heures de bureau <input type="text" data-field="officeHours" value="${esc(c.officeHours)}"></label>
      <label class="stack">Politique de retard <input type="text" data-field="latePolicy" value="${esc(c.latePolicy)}"></label>
    </details>

    <details class="cd-section">
      <summary>Barème (% → lettre) de ce cours</summary>
      <p class="hint">À Concordia chaque prof fixe ses seuils. Ajuste-les selon le syllabus.</p>
      <div class="scale-editor" id="cd-scale-editor"></div>
    </details>

    <details class="cd-section">
      <summary>Documents (${c.files.length})</summary>
      ${filesHTML}
      <label class="secondary-btn file-label" for="cd-file-input">+ Ajouter un document</label>
      <input type="file" id="cd-file-input" class="hidden" accept=".pdf,.docx,.txt,image/*">
    </details>

    <button type="button" class="danger-btn" data-act="del-course">Supprimer ce cours</button>
  `;
}

function openCourse(id) {
  openCourseId = id;
  const fc = findCourse(id);
  if (!fc) return;
  $("#course-detail-heading").textContent = fc.course.code || "Cours";
  $("#course-detail-body").innerHTML = courseDetailHTML(fc.course);
  const scaleEl = $("#cd-scale-editor");
  if (scaleEl) renderScaleEditor(scaleEl, fc.course.scale, () => { saveDB(); refreshCourseStats(); });
  $("#course-detail").classList.remove("hidden");
  document.body.classList.add("no-scroll");
}
function closeCourse() {
  $("#course-detail").classList.add("hidden");
  document.body.classList.remove("no-scroll");
  openCourseId = null;
  render();
}
/** Re-render partiel : stats + bloc besoin, sans perdre le focus des champs. */
function refreshCourseStats() {
  const fc = findCourse(openCourseId);
  if (!fc) return;
  const c = fc.course;
  const bd = courseBreakdown(c);
  const l = currentLetter(c);
  const statEl = $("#course-detail-body .cd-stat");
  if (statEl) {
    statEl.innerHTML = `
      <div><span class="cd-stat-val">${bd.standingPct === null ? "—" : fmt(bd.standingPct) + "%"}</span><span class="cd-stat-lab">Note actuelle</span></div>
      <div><span class="cd-stat-val letter-chip ${l ? "" : "empty"}">${l || "—"}</span><span class="cd-stat-lab">Lettre</span></div>
      <div><span class="cd-stat-val">${l ? gfmt(gpaForLetter(l)) : "—"}</span><span class="cd-stat-lab">GPA</span></div>`;
  }
  const need = $("#course-detail-body .need-box");
  if (need) {
    const tmp = document.createElement("div");
    tmp.innerHTML = courseDetailHTML(c);
    need.innerHTML = tmp.querySelector(".need-box").innerHTML;
  }
}

/* ---------- evenements du detail ---------- */
function cdCourse() { const fc = findCourse(openCourseId); return fc ? fc.course : null; }

$("#course-detail-body").addEventListener("input", (e) => {
  const c = cdCourse(); if (!c) return;
  const t = e.target;
  const field = t.dataset.field;

  if (field === "comp-name" || field === "comp-weight") {
    const compId = t.closest(".comp-card").dataset.comp;
    const comp = c.components.find((x) => x.id === compId);
    if (!comp) return;
    if (field === "comp-name") comp.name = t.value;
    else comp.weight = num(t.value) ?? 0;
    saveDB(); refreshCourseStats(); return;
  }
  if (t.closest("tr[data-item]")) {
    const tr = t.closest("tr[data-item]");
    const comp = c.components.find((x) => x.id === tr.dataset.comp);
    const it = comp && comp.items.find((x) => x.id === tr.dataset.item);
    if (!it) return;
    if (field === "name") it.name = t.value;
    else if (field === "date") it.date = t.value;
    else if (field === "grade") it.grade = t.value === "" ? null : num(t.value);
    else if (field === "max") it.max = num(t.value) ?? 100;
    saveDB(); refreshCourseStats(); return;
  }
  if (["code", "title", "credits", "target", "instructor", "email", "room", "officeHours", "latePolicy"].includes(field)) {
    if (field === "credits") c.credits = num(t.value) ?? 0;
    else c[field] = t.value;
    if (field === "code") $("#course-detail-heading").textContent = t.value || "Cours";
    saveDB(); refreshCourseStats(); return;
  }
});

$("#course-detail-body").addEventListener("change", (e) => {
  const c = cdCourse(); if (!c) return;
  if (e.target.id === "cd-file-input" && e.target.files.length) {
    attachFilesToCourse(c, e.target.files);
  }
});

$("#course-detail-body").addEventListener("click", async (e) => {
  const c = cdCourse(); if (!c) return;
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === "clear-missing") { c._missing = []; saveDB(); openCourse(c.id); return; }

  if (act === "add-comp") {
    c.components.push({ id: uid(), name: "Nouvelle composante", weight: 0, rule: null, items: [] });
    saveDB(); openCourse(c.id); return;
  }
  const compCard = btn.closest(".comp-card");
  const comp = compCard && c.components.find((x) => x.id === compCard.dataset.comp);

  if (act === "del-comp" && comp) {
    if (confirm(`Supprimer « ${comp.name} » ?`)) { c.components = c.components.filter((x) => x !== comp); saveDB(); openCourse(c.id); }
    return;
  }
  if (act === "add-item" && comp) {
    comp.items.push({ id: uid(), name: `Élément ${comp.items.length + 1}`, date: "", grade: null, max: 100, note: "" });
    saveDB(); openCourse(c.id); return;
  }
  if (act === "del-item") {
    const tr = btn.closest("tr[data-item]");
    const cp = c.components.find((x) => x.id === tr.dataset.comp);
    if (cp) { cp.items = cp.items.filter((x) => x.id !== tr.dataset.item); saveDB(); openCourse(c.id); }
    return;
  }
  if (act === "edit-rule" && comp) { editRuleModal(c, comp); return; }

  if (act === "open-file") { openStoredFile(btn.dataset.file); return; }
  if (act === "del-file") {
    await idbDelete(btn.dataset.file);
    c.files = c.files.filter((f) => f.id !== btn.dataset.file);
    saveDB(); openCourse(c.id); return;
  }
  if (act === "del-course") {
    if (confirm("Supprimer ce cours et ses notes ?")) {
      for (const f of c.files) await idbDelete(f.id).catch(() => {});
      const fc = findCourse(c.id);
      fc.session.courses = fc.session.courses.filter((x) => x.id !== c.id);
      saveDB(); closeCourse();
    }
    return;
  }
});

function editRuleModal(course, comp) {
  const r = comp.rule || {};
  openModal("Règle spéciale de notation", `
    <p class="hint">Pour « ${esc(comp.name)} ».</p>
    <label class="radio-row"><input type="radio" name="rule" value="none" ${!comp.rule ? "checked" : ""}> Aucune (tous les éléments comptent également)</label>
    <label class="radio-row"><input type="radio" name="rule" value="best_k_of_n" ${r.type === "best_k_of_n" ? "checked" : ""}> Garder les <input type="number" id="rule-keep" value="${r.keep || 4}" min="1" style="width:3.5em"> meilleurs sur <input type="number" id="rule-of" value="${r.of || 5}" min="1" style="width:3.5em"></label>
    <label class="radio-row"><input type="radio" name="rule" value="drop_lowest" ${r.type === "drop_lowest" ? "checked" : ""}> Retirer les <input type="number" id="rule-n" value="${r.n || 1}" min="1" style="width:3.5em"> pires résultats</label>
    <div class="form-actions"><button type="button" id="rule-save">Enregistrer</button></div>
  `);
  $("#rule-save").onclick = () => {
    const v = $('input[name="rule"]:checked').value;
    if (v === "none") comp.rule = null;
    else if (v === "best_k_of_n") comp.rule = { type: "best_k_of_n", keep: +$("#rule-keep").value || 1, of: +$("#rule-of").value || 1 };
    else comp.rule = { type: "drop_lowest", n: +$("#rule-n").value || 1 };
    saveDB(); closeModal(); openCourse(course.id);
  };
}

async function attachFilesToCourse(course, fileList) {
  for (const f of fileList) {
    const id = uid();
    await idbPut({ id, name: f.name, type: f.type, blob: f });
    course.files.push({ id, name: f.name, type: f.type });
  }
  saveDB(); openCourse(course.id);
  toast("Document ajouté");
}
async function openStoredFile(id) {
  const rec = await idbGet(id);
  if (!rec) { toast("Fichier introuvable"); return; }
  const url = URL.createObjectURL(rec.blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ============================================================
   Modal generique
   ============================================================ */
function openModal(title, bodyHTML) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHTML;
  $("#modal").classList.remove("hidden");
  document.body.classList.add("no-scroll");
}
function closeModal() {
  $("#modal").classList.add("hidden");
  document.body.classList.remove("no-scroll");
}
$("#modal-close").onclick = closeModal;
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
$("#course-detail-close").onclick = closeCourse;

/* ============================================================
   Session : menu, ajout de cours, cours antérieurs
   ============================================================ */
$("#session-select").addEventListener("change", (e) => {
  db.currentSessionId = e.target.value; saveDB(); render();
});

$("#session-menu-btn").onclick = () => {
  const s = currentSession();
  openModal("Session : " + s.name, `
    <label class="stack">Nom <input type="text" id="s-name" value="${esc(s.name)}"></label>
    <div class="row">
      <label class="stack">Début <input type="date" id="s-start" value="${esc(s.start || "")}"></label>
      <label class="stack">Fin <input type="date" id="s-end" value="${esc(s.end || "")}"></label>
    </div>
    <label class="checkbox-row"><input type="checkbox" id="s-archived" ${s.archived ? "checked" : ""}> Session terminée (archivée)</label>
    <div class="form-actions">
      <button type="button" id="s-save">Enregistrer</button>
      <button type="button" id="s-new" class="secondary-btn">+ Nouvelle session</button>
    </div>
    <button type="button" id="s-del" class="danger-btn" ${db.sessions.length <= 1 ? "disabled" : ""}>Supprimer cette session</button>
  `);
  $("#s-save").onclick = () => {
    s.name = $("#s-name").value.trim() || s.name;
    s.start = $("#s-start").value; s.end = $("#s-end").value;
    s.archived = $("#s-archived").checked;
    saveDB(); closeModal(); render();
  };
  $("#s-new").onclick = () => {
    const ns = { id: uid(), name: "Nouvelle session", start: "", end: "", archived: false, courses: [] };
    db.sessions.push(ns); db.currentSessionId = ns.id; saveDB(); closeModal(); render();
  };
  $("#s-del").onclick = () => {
    if (db.sessions.length <= 1) return;
    if (!confirm("Supprimer la session « " + s.name + " » et tous ses cours ?")) return;
    db.sessions = db.sessions.filter((x) => x.id !== s.id);
    db.currentSessionId = db.sessions[0].id;
    saveDB(); closeModal(); render();
  };
};

$("#add-course-btn").onclick = () => {
  openModal("Nouveau cours", `
    <label class="stack">Sigle <input type="text" id="nc-code" placeholder="MATH 205"></label>
    <label class="stack">Titre (optionnel) <input type="text" id="nc-title"></label>
    <label class="stack">Crédits <input type="number" id="nc-credits" value="3" step="0.25" min="0"></label>
    <div class="form-actions"><button type="button" id="nc-save">Créer</button></div>
  `);
  $("#nc-code").focus();
  $("#nc-save").onclick = () => {
    const c = blankCourse($("#nc-code").value.trim(), $("#nc-title").value.trim());
    c.credits = num($("#nc-credits").value) ?? 3;
    currentSession().courses.push(c);
    saveDB(); closeModal(); render();
    openCourse(c.id);
  };
};

$("#add-past-course-btn").onclick = () => {
  openModal("Cours antérieur / externe", `
    <p class="hint">Pour bâtir ton GPA cumulatif avec des cours déjà terminés.</p>
    <label class="stack">Session / provenance <input type="text" id="pc-term" placeholder="Hiver 2026 · Cégep"></label>
    <label class="stack">Sigle <input type="text" id="pc-code" placeholder="ENGR 201"></label>
    <div class="row">
      <label class="stack">Crédits <input type="number" id="pc-credits" value="3" step="0.25" min="0"></label>
      <label class="stack">Lettre
        <select id="pc-letter">${LETTERS.map((x) => `<option>${x}</option>`).join("")}</select>
      </label>
    </div>
    <div class="form-actions"><button type="button" id="pc-save">Ajouter</button></div>
  `);
  $("#pc-save").onclick = () => {
    db.past.push({
      id: uid(),
      term: $("#pc-term").value.trim(),
      code: $("#pc-code").value.trim(),
      credits: num($("#pc-credits").value) ?? 0,
      letter: $("#pc-letter").value,
    });
    saveDB(); closeModal(); render();
  };
};

$("#gpa-sessions").addEventListener("click", (e) => {
  const b = e.target.closest("[data-del-past]");
  if (!b) return;
  db.past = db.past.filter((p) => p.id !== b.dataset.delPast);
  saveDB(); render();
});

$("#gpa-include-projected").addEventListener("change", (e) => {
  db.settings.gpaIncludeProjected = e.target.checked; saveDB(); render();
});

$("#course-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-open-course]");
  if (b) openCourse(b.dataset.openCourse);
});

/* ============================================================
   Reglages : evenements
   ============================================================ */
$("#save-settings-btn").onclick = () => {
  db.settings.apiKey = $("#api-key-input").value.trim();
  db.settings.model = $("#model-select").value;
  saveDB(); toast("Réglages enregistrés");
};
$("#dark-toggle").addEventListener("change", (e) => {
  db.settings.dark = e.target.checked; saveDB(); applyTheme();
});
$("#reset-scale-btn").onclick = () => {
  db.settings.defaultScale = DEFAULT_SCALE.map((x) => ({ ...x }));
  saveDB(); renderSettings(); toast("Barème par défaut réinitialisé");
};

$("#test-api-btn").onclick = async () => {
  const key = $("#api-key-input").value.trim();
  if (!key) { toast("Entre une clé d'abord"); return; }
  db.settings.apiKey = key; db.settings.model = $("#model-select").value; saveDB();
  toast("Test en cours…");
  try {
    await callClaude("Réponds uniquement par: OK", [{ type: "text", text: "ping" }], 20);
    toast("✅ Clé valide");
  } catch (err) {
    toast("❌ " + err.message.slice(0, 80));
  }
};

$("#export-btn").onclick = () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gradezilla-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$("#backup-file").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const parsed = JSON.parse(r.result);
      if (!parsed.sessions) throw new Error("format invalide");
      if (!confirm("Remplacer toutes les données actuelles par cette sauvegarde ?")) return;
      db = parsed; saveDB(); db = loadDB(); render();
      toast("Sauvegarde importée");
    } catch (err) { toast("Fichier invalide"); }
  };
  r.readAsText(f);
});

/* ============================================================
   IMPORT de documents (API Claude)
   ============================================================ */
let pendingFiles = [];

function renderChips() {
  $("#import-file-chips").innerHTML = pendingFiles.map((f, i) =>
    `<span class="chip">${esc(f.name)}<button type="button" data-chip="${i}" aria-label="Retirer">&#10005;</button></span>`
  ).join("");
}
$("#import-file-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chip]"); if (!b) return;
  pendingFiles.splice(+b.dataset.chip, 1); renderChips();
});

$("#import-pick-btn").onclick = () => $("#import-file").click();
$("#import-file").addEventListener("change", (e) => { addImportFiles(e.target.files); e.target.value = ""; });

const dz = $("#drop-zone");
["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove("drag")));
dz.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addImportFiles(e.dataTransfer.files); });

function addImportFiles(list) {
  for (const f of list) {
    if (f.size > 12 * 1024 * 1024) { toast(`${f.name} : trop gros (max 12 Mo)`); continue; }
    pendingFiles.push({ name: f.name, type: f.type || guessType(f.name), file: f });
  }
  renderChips();
}
function guessType(name) {
  const e = name.toLowerCase().split(".").pop();
  return { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[e] || "";
}

function blobToB64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// .docx = zip ; on lit word/document.xml et on retire les balises. JSZip charge en differe depuis un CDN.
let _jszip = null;
function loadJSZip() {
  if (_jszip) return Promise.resolve(_jszip);
  if (window.JSZip) { _jszip = window.JSZip; return Promise.resolve(_jszip); }
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => { _jszip = window.JSZip; res(_jszip); };
    s.onerror = () => rej(new Error("Impossible de charger le lecteur .docx (hors-ligne ?). Copie-colle le texte."));
    document.head.appendChild(s);
  });
}
async function extractDocxText(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const xml = await zip.file("word/document.xml").async("string");
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function buildContentBlocks() {
  const blocks = [];
  const pastedText = $("#import-text").value.trim();
  const textParts = [];
  if (pastedText) textParts.push("=== TEXTE COLLÉ ===\n" + pastedText);

  for (const pf of pendingFiles) {
    const t = pf.type;
    if (t === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: await blobToB64(pf.file) } });
    } else if (t.startsWith("image/")) {
      blocks.push({ type: "image", source: { type: "base64", media_type: t, data: await blobToB64(pf.file) } });
    } else if (t.includes("wordprocessingml") || pf.name.toLowerCase().endsWith(".docx")) {
      textParts.push(`=== ${pf.name} ===\n` + await extractDocxText(pf.file));
    } else {
      textParts.push(`=== ${pf.name} ===\n` + await pf.file.text());
    }
  }
  if (textParts.length) blocks.push({ type: "text", text: textParts.join("\n\n") });
  blocks.push({ type: "text", text: "Extrais les infos de ce cours selon le schéma JSON demandé. Aujourd'hui : 2026-09-02. Session type : automne 2026 (sept–déc 2026) ou hiver 2027 (janv–avr 2027)." });
  return blocks;
}

const EXTRACT_SYSTEM = `Tu extrais la structure d'un cours universitaire (Concordia) à partir d'un syllabus et/ou d'un relevé de notes.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises Markdown.

Schéma :
{
  "course": {"code": string|null, "title": string|null, "instructor": string|null, "email": string|null, "room": string|null, "officeHours": string|null, "latePolicy": string|null, "credits": number|null},
  "gradeScale": [{"letter": "A+", "min": number}, ...] | null,   // seuils %→lettre SI présents dans le document
  "components": [
    {"name": string, "weight": number,                          // poids en %, nombre seul (ex: 25 pas "25%")
     "rule": {"type":"best_k_of_n","keep":number,"of":number} | {"type":"drop_lowest","n":number} | null,
     "items": [{"name": string, "date": "YYYY-MM-DD"|null}]}     // devoirs/quiz/examens de cette composante, avec dates si connues
  ],
  "grades": [{"component": string, "item": string|null, "grade": number, "max": number}],  // notes DÉJÀ obtenues (relevé)
  "uncertain": [string],   // libellés FR des champs devinés / peu fiables
  "missing": [string]      // libellés FR des infos importantes ABSENTES du document (ex: "Date du final", "Crédits", "Pondération du labo")
}

Règles : les poids doivent si possible totaliser 100. Déduis l'année des dates selon le contexte de session. Si une info est absente, mets null et ajoute un libellé clair dans "missing". Ne fabrique pas de dates ni de pondérations.`;

async function callClaude(system, content, maxTokens = 3000) {
  const key = db.settings.apiKey;
  if (!key) throw new Error("Ajoute ta clé API dans Réglages.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: db.settings.model || "claude-sonnet-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = j.error?.message || JSON.stringify(j); } catch { detail = await res.text(); }
    throw new Error(`API ${res.status} — ${detail}`.slice(0, 200));
  }
  const data = await res.json();
  return (data.content || []).map((b) => b.text || "").join("").trim();
}

function parseJSONLoose(s) {
  let t = s.trim();
  if (t.startsWith("```")) t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a > 0 || b < t.length - 1) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

$("#import-analyze-btn").onclick = async () => {
  if (!pendingFiles.length && !$("#import-text").value.trim()) { toast("Ajoute un fichier ou colle du texte"); return; }
  if (!db.settings.apiKey) { toast("Ajoute ta clé API dans Réglages"); switchView("view-settings"); return; }
  const status = $("#import-status");
  const review = $("#import-review");
  review.classList.add("hidden");
  status.classList.remove("hidden");
  status.innerHTML = `<span class="spinner"></span> Analyse en cours…`;
  try {
    const blocks = await buildContentBlocks();
    const raw = await callClaude(EXTRACT_SYSTEM, blocks, 3000);
    const data = parseJSONLoose(raw);
    status.classList.add("hidden");
    renderReview(data);
  } catch (err) {
    status.innerHTML = `<span class="bad">❌ ${esc(err.message)}</span>`;
  }
};

function validRule(r) {
  if (!r || typeof r !== "object") return null;
  if (r.type === "best_k_of_n" && +r.keep > 0 && +r.of > 0) return { type: "best_k_of_n", keep: +r.keep, of: +r.of };
  if (r.type === "drop_lowest" && +r.n > 0) return { type: "drop_lowest", n: +r.n };
  return null;
}
function normalizeScale(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const map = {};
  arr.forEach((r) => { if (r && LETTERS.includes(r.letter) && num(r.min) !== null) map[r.letter] = num(r.min); });
  if (!Object.keys(map).length) return null;
  return DEFAULT_SCALE.map((d) => ({ letter: d.letter, min: d.letter in map ? map[d.letter] : d.min }));
}

function courseFromParsed(data) {
  const c = blankCourse(data.course?.code || "", data.course?.title || "");
  const co = data.course || {};
  ["instructor", "email", "room", "officeHours", "latePolicy"].forEach((k) => { if (co[k]) c[k] = String(co[k]); });
  if (num(co.credits) !== null) c.credits = num(co.credits);
  const sc = normalizeScale(data.gradeScale);
  if (sc) c.scale = sc;

  c.components = (data.components || []).map((comp) => ({
    id: uid(),
    name: comp.name || "Composante",
    weight: num(comp.weight) ?? 0,
    rule: validRule(comp.rule),
    items: (comp.items || []).map((it) => ({
      id: uid(), name: it.name || "Élément", date: validDate(it.date), grade: null, max: 100, note: "",
    })),
  }));
  applyParsedGrades(c, data.grades || []);

  c._missing = [];
  (data.missing || []).forEach((m) => c._missing.push(String(m)));
  (data.uncertain || []).forEach((m) => c._missing.push("À vérifier : " + String(m)));
  const wsum = c.components.reduce((s, x) => s + (num(x.weight) || 0), 0);
  if (c.components.length && Math.abs(wsum - 100) > 0.5) c._missing.push(`Pondérations à corriger (total ${fmt(wsum)}% au lieu de 100%)`);
  if (num(co.credits) === null) c._missing.push("Nombre de crédits");
  return c;
}

function applyParsedGrades(course, grades) {
  grades.forEach((g, i) => {
    if (num(g.grade) === null) return;
    let comp = course.components.find((x) => x.name.toLowerCase().includes(String(g.component || "").toLowerCase().slice(0, 4)) && g.component)
      || course.components.find((x) => String(g.component || "").toLowerCase().includes(x.name.toLowerCase()));
    if (!comp) {
      comp = { id: uid(), name: g.component || `Composante ${i + 1}`, weight: 0, rule: null, items: [] };
      course.components.push(comp);
    }
    let it = g.item ? comp.items.find((x) => x.name.toLowerCase() === String(g.item).toLowerCase()) : null;
    if (!it) {
      it = { id: uid(), name: g.item || `Note ${comp.items.length + 1}`, date: "", grade: null, max: 100, note: "" };
      comp.items.push(it);
    }
    it.grade = num(g.grade);
    it.max = num(g.max) || 100;
  });
}

function mergeParsedIntoCourse(course, data) {
  const co = data.course || {};
  ["instructor", "email", "room", "officeHours", "latePolicy"].forEach((k) => { if (!course[k] && co[k]) course[k] = String(co[k]); });
  if ((num(course.credits) === 3 || num(course.credits) === null) && num(co.credits) !== null) course.credits = num(co.credits);
  const sc = normalizeScale(data.gradeScale);
  if (sc && JSON.stringify(course.scale) === JSON.stringify(DEFAULT_SCALE)) course.scale = sc;

  (data.components || []).forEach((comp) => {
    const exists = course.components.find((x) => x.name.toLowerCase() === String(comp.name || "").toLowerCase());
    if (exists) {
      if ((num(exists.weight) || 0) === 0 && num(comp.weight) !== null) exists.weight = num(comp.weight);
      (comp.items || []).forEach((it) => {
        if (!exists.items.find((x) => x.name.toLowerCase() === String(it.name || "").toLowerCase())) {
          exists.items.push({ id: uid(), name: it.name || "Élément", date: validDate(it.date), grade: null, max: 100, note: "" });
        }
      });
    } else {
      course.components.push({
        id: uid(), name: comp.name || "Composante", weight: num(comp.weight) ?? 0, rule: validRule(comp.rule),
        items: (comp.items || []).map((it) => ({ id: uid(), name: it.name || "Élément", date: validDate(it.date), grade: null, max: 100, note: "" })),
      });
    }
  });
  applyParsedGrades(course, data.grades || []);
  course._missing = course._missing || [];
  (data.missing || []).forEach((m) => course._missing.push(String(m)));
}

function summarizeParsed(data) {
  const nComp = (data.components || []).length;
  const nDates = (data.components || []).reduce((s, c) => s + (c.items || []).filter((i) => i.date).length, 0);
  const nGrades = (data.grades || []).filter((g) => num(g.grade) !== null).length;
  const bits = [];
  if (data.course?.code) bits.push(`<strong>${esc(data.course.code)}</strong>${data.course.title ? " — " + esc(data.course.title) : ""}`);
  bits.push(`${nComp} composante${nComp > 1 ? "s" : ""}`);
  if (nDates) bits.push(`${nDates} date${nDates > 1 ? "s" : ""}`);
  if (nGrades) bits.push(`${nGrades} note${nGrades > 1 ? "s" : ""} déjà obtenue${nGrades > 1 ? "s" : ""}`);
  return bits.join(" · ");
}

function renderReview(data) {
  const review = $("#import-review");
  const session = currentSession();
  const missing = [...(data.missing || []), ...(data.uncertain || []).map((u) => "à vérifier : " + u)];
  const compRows = (data.components || []).map((c) =>
    `<li>${esc(c.name || "?")} — <strong>${c.weight ?? "?"}%</strong>${c.rule ? " · règle spéciale" : ""}${(c.items || []).length ? ` · ${c.items.length} élément(s)` : ""}</li>`
  ).join("");

  review.innerHTML = `
    <h3>Résultat de l'analyse</h3>
    <p class="review-summary">${summarizeParsed(data)}</p>
    ${compRows ? `<ul class="review-comps">${compRows}</ul>` : ""}
    ${missing.length ? `<div class="missing-banner"><div class="missing-head"><strong>Manquant / à confirmer</strong></div><ul>${missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul><p class="hint">Tu pourras tout compléter à la main juste après.</p></div>` : ""}
    <div class="field">
      <label for="review-target">Ajouter à</label>
      <select id="review-target">
        <option value="__new__">➕ Nouveau cours dans « ${esc(session.name)} »</option>
        ${session.courses.map((c) => `<option value="${c.id}">Fusionner avec ${esc(c.code || "sans nom")}</option>`).join("")}
      </select>
    </div>
    <div class="form-actions">
      <button type="button" id="review-commit">Importer et compléter</button>
      <button type="button" id="review-cancel" class="secondary-btn">Annuler</button>
    </div>`;
  review.classList.remove("hidden");
  review._data = data;

  $("#review-cancel").onclick = () => review.classList.add("hidden");
  $("#review-commit").onclick = async () => {
    const target = $("#review-target").value;
    const session2 = currentSession();
    let course;
    if (target === "__new__") {
      course = courseFromParsed(data);
      session2.courses.push(course);
    } else {
      course = session2.courses.find((c) => c.id === target);
      mergeParsedIntoCourse(course, data);
    }
    // rattache les fichiers importes au cours
    for (const pf of pendingFiles) {
      const id = uid();
      await idbPut({ id, name: pf.name, type: pf.type, blob: pf.file });
      course.files.push({ id, name: pf.name, type: pf.type });
    }
    pendingFiles = []; renderChips();
    $("#import-text").value = "";
    review.classList.add("hidden");
    saveDB();
    toast("Cours importé — complète ce qui manque");
    switchView("view-courses");
    openCourse(course.id);
  };
}

/* ============================================================
   Navigation
   ============================================================ */
function switchView(id) {
  activeView = id;
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  $$("#bottom-nav .nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  window.scrollTo(0, 0);
  render();
}
$$("#bottom-nav .nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));

/* ============================================================
   Init
   ============================================================ */
$("#tagline").textContent = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
switchView("view-courses");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
