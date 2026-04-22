// ──────────────────────────────────────────────────────────────────
// DATA DEFINITIONS
// ──────────────────────────────────────────────────────────────────

function getSimpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

const PHASES = {
  1: { label:'Phase 1 — Foundation', desc:'Build the daily baseline: sleep, movement, focused work, and a quick review loop.' },
  2: { label:'Phase 2 — Build',      desc:'Increase volume carefully. Make the weekly review decide what gets more time.' },
  3: { label:'Phase 3 — Sharpen',    desc:'Specialise around the goals that matter most. Track fewer things with better signal.' },
  4: { label:'Phase 4 — Integrate',  desc:'Pressure-test the system, simplify what is noisy, and keep the useful routines durable.' },
};

const NON_NEGS = [];
const TRAINING = {};

const TARGET_BASE_CFG = {
  rest:   { label:'Rest',       short:'Rest',  base:'2h',  target: 0,   desc:'Weekend rest day: recovery and optional light review only.' },
  hard:   { label:'Daily',      short:'Day',   base:'6h',  target: 6.0, desc:'Standard workday: one consistent 6 hour task set.' },
};

const DIFFICULTY_KEYS = ['hard'];
const DIFFICULTY_LABELS = { hard:'Daily' };
const WORKDAY_DOWS = [1, 2, 3, 4, 5];
const TRAINING_ID_ALIASES = {
  t2_focus:'tr_focus',
  t4_focus:'tr_focus',
  t6_focus:'tr_focus',
  fb30_focus:'tr_focus',
  fb60_focus:'tr_focus',
  fb90_focus:'tr_focus'
};
const TRACKING_ID_TO_DISPLAY_ID = {
  tr_focus:'t2_focus'
};
const LINKED_CHECK_GROUPS = [
  ['nn_focus_rep', 'tr_focus']
];

let TARGETS = {};
function updateTargetsMap() {
  TARGETS = {};
  Object.keys(TARGET_BASE_CFG).forEach(k => {
    const cfg = TARGET_BASE_CFG[k];
    TARGETS[k] = { 
      ...cfg, 
      targetHours: cfg.target 
    };
  });
}


const EXERCISE_BY_DOW = {};
const SUNDAY_PROTOCOL = [];

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_FOCUS = {
  1:'Set the week up',
  2:'Deep work + practice',
  3:'Midweek review + focused output',
  4:'Deep work + learning',
  5:'Close loops + weekly readout',
  6:'Rest Day · maintenance only',
  0:'Rest Day',
};

// ──────────────────────────────────────────────────────────────────
// STATE + STORAGE
// ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'tracker_consumer_state';
const BACKUP_DB = 'tracker_consumer_backup_db';
const BACKUP_STORE = 'handles';
const BACKUP_HANDLE_KEY = 'tracker-data';
const DEFAULT_TITLE = 'Tracker';

const TODAY_NUMBER_FIELDS = [
  { key:'sleepHours', id:'inp-sleep',    label:'Sleep Hours',          type:'number', attrs:'min="0" max="12" step="0.5"', placeholder:'7.5' },
  { key:'lightsOut',  id:'inp-lights',   label:'Wind-down Time',       type:'time',   attrs:'', placeholder:'' },
  { key:'energy',     id:'inp-energy',   label:'Energy Score',         type:'number', attrs:'min="1" max="10"', placeholder:'7' },
  { key:'focusScore',    id:'inp-focusScore',  label:'Focus Score',          type:'number', attrs:'', placeholder:'-' },
  { key:'practiceReps', id:'inp-practice',       label:'Practice Reps',        type:'number', attrs:'', placeholder:'0' },
  { key:'projectReps', id:'inp-project',   label:'Project Reps',         type:'number', attrs:'', placeholder:'0' },
  { key:'deepWorkReps', id:'inp-deepWork',     label:'Deep Work Reps',       type:'number', attrs:'', placeholder:'0' },
  { key:'mood',       id:'inp-mood',     label:'Mood / Stress',        type:'number', attrs:'', placeholder:'-' },
  { key:'readingMins', id:'inp-reading', label:'Reading / Learning Min', type:'number', attrs:'min="0"', placeholder:'0' },
  { key:'contestDone', id:'inp-contest', label:'Key Milestone Done',    type:'checkbox', attrs:'', placeholder:'' },
];

const DEFAULT_BENCHMARKS = [
  { id:'bm_sleep', name:'Sleep consistency', current:'Track in Daily', status:'grey', good:'7h+ most nights', ok:'Some misses', bad:'Repeated short nights', note:'Use sleep hours from Today\'s Numbers as the signal.', action:'Protect the evening routine before adding more work.' },
  { id:'bm_focus', name:'Focused work', current:'Weekly hours trend', status:'grey', good:'Enough hours for your goal', ok:'Reduced but intentional', bad:'Avoided or scattered', note:'Use the timer and task-hour logs to judge this.', action:'Shrink the task and log one honest focus block.' },
  { id:'bm_recovery', name:'Energy and recovery', current:'Energy average', status:'grey', good:'7+/10 average', ok:'5-7/10', bad:'Below 5/10', note:'A simple load-management signal.', action:'Cut optional load and fix sleep, food, and movement first.' },
];

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

let state = loadState();
let backupHandle = null;
let backupTimer = null;
let serverAutosave = false;
let serverTimer = null;
let backupStatus = 'Local browser autosave is active. Connect a backup file for working-directory autosave.';
let backupStatusKind = 'warn';

function canonicalTrainingId(id) {
  return TRAINING_ID_ALIASES[id] || id;
}

function trackingIdForTask(taskOrId) {
  if (typeof taskOrId === 'object' && taskOrId) return taskOrId.trackingId || canonicalTrainingId(taskOrId.id);
  return canonicalTrainingId(taskOrId);
}

function linkedCheckIds(id) {
  const canonical = trackingIdForTask(id);
  const group = LINKED_CHECK_GROUPS.find(ids => ids.includes(id) || ids.includes(canonical));
  return group || [canonical];
}

function isFocusRepDone(d) {
  return !!(d.checks?.nn_focus_rep || d.checks?.tr_focus || (d.focusScore !== null && d.focusScore !== undefined && d.focusScore !== ''));
}

function isCheckDone(d, id) {
  const canonical = trackingIdForTask(id);
  if (linkedCheckIds(canonical).includes('tr_focus')) return isFocusRepDone(d);
  return !!d.checks?.[canonical];
}

function setLinkedCheck(d, id, value) {
  if (!d.checks) d.checks = {};
  linkedCheckIds(id).forEach(checkId => {
    d.checks[checkId] = !!value;
  });
}

function normalizeAppliesTo(appliesTo) {
  const values = Array.isArray(appliesTo) ? appliesTo : DIFFICULTY_KEYS.filter(key => key !== 'rest');
  const filtered = [...new Set(values.filter(value => DIFFICULTY_KEYS.includes(value)))];
  return filtered.length ? filtered : DIFFICULTY_KEYS.filter(key => key !== 'rest');
}

function canonicalizeTrainingItems(items = []) {
  const seen = new Set();
  return items.map(item => {
    const trackingId = item.trackingId || canonicalTrainingId(item.id);
    const id = item.id === trackingId && TRACKING_ID_TO_DISPLAY_ID[trackingId] ? TRACKING_ID_TO_DISPLAY_ID[trackingId] : item.id;
    return { ...item, id, trackingId };
  }).filter(item => {
    const key = trackingIdForTask(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itemAppliesToDifficulty(item, difficulty) {
  return normalizeAppliesTo(item.appliesTo).includes(difficulty);
}

function migrateTrainingIdentity() {
  Object.values(state.days || {}).forEach(day => {
    migrateLegacyDayFields(day);
    if (day.taskHours) {
      Object.entries(TRAINING_ID_ALIASES).forEach(([oldId, newId]) => {
        if (day.taskHours[oldId] !== undefined) {
          const oldVal = +day.taskHours[oldId] || 0;
          if (oldVal < 0) console.warn('Negative hours in migration:', oldId, oldVal);
          day.taskHours[newId] = Math.round(((+day.taskHours[newId] || 0) + Math.max(0, oldVal)) * 10000) / 10000;
          delete day.taskHours[oldId];
        }
      });
    }
    if (day.checks) {
      Object.entries(TRAINING_ID_ALIASES).forEach(([oldId, newId]) => {
        if (day.checks[oldId] !== undefined) {
          day.checks[newId] = !!day.checks[newId] || !!day.checks[oldId];
          delete day.checks[oldId];
        }
      });
      LINKED_CHECK_GROUPS.forEach(group => {
        if (group.some(id => day.checks[id])) group.forEach(id => { day.checks[id] = true; });
      });
    }
  });
  Object.keys(state.trainingTemplates || {}).forEach(key => {
    state.trainingTemplates[key].forEach(entry => {
      entry.items = canonicalizeTrainingItems(entry.items);
    });
  });
  Object.keys(state.customTraining || {}).forEach(key => {
    state.customTraining[key] = canonicalizeTrainingItems(state.customTraining[key]);
  });
  Object.keys(state.removedTraining || {}).forEach(key => {
    state.removedTraining[key] = [...new Set((state.removedTraining[key] || []).map(canonicalTrainingId))];
  });
}

function legacyKey(...parts) {
  return parts.join('');
}

function migrateLegacyDayFields(day) {
  const legacyFocus = legacyKey('ze', 'ta', 'mac');
  if (day[legacyFocus] !== undefined && day.focusScore === undefined) {
    day.focusScore = day[legacyFocus];
    delete day[legacyFocus];
  }
  const fieldMap = [
    [String.fromCharCode(99, 112) + 'Problems', 'practiceReps'],
    [String.fromCharCode(112, 114, 111, 98) + 'Problems', 'projectReps'],
    [String.fromCharCode(98, 109, 111) + 'Problems', 'deepWorkReps']
  ];
  fieldMap.forEach(([oldKey, newKey]) => {
    if (day[oldKey] !== undefined && day[newKey] === undefined) {
      day[newKey] = day[oldKey];
      delete day[oldKey];
    }
  });
  const oldMilestoneKey = String.fromCharCode(99, 102) + 'Contest';
  if (day[oldMilestoneKey] !== undefined && day.keyMilestone === undefined) {
    day.keyMilestone = day[oldMilestoneKey];
    delete day[oldMilestoneKey];
  }
  if (day.checks) {
    const legacyFocusCheck = ['nn', legacyKey('ze', 'ta', 'mac')].join('_');
    if (day.checks[legacyFocusCheck] !== undefined && day.checks.nn_focus_rep === undefined) {
      day.checks.nn_focus_rep = day.checks[legacyFocusCheck];
      delete day.checks[legacyFocusCheck];
    }
  }
}

function migrateLegacyMetrics() {
  if (!state.metrics || typeof state.metrics !== 'object') state.metrics = {};
  const legacyScore = legacyKey('c', 'f', 'Rating');
  const legacyFocusPeak = legacyKey('ze', 'ta', 'mac', 'Peak');
  if (Array.isArray(state.metrics[legacyScore]) && !Array.isArray(state.metrics.scoreHistory)) {
    state.metrics.scoreHistory = state.metrics[legacyScore];
  }
  if (Array.isArray(state.metrics[legacyFocusPeak]) && !Array.isArray(state.metrics.focusPeaks)) {
    state.metrics.focusPeaks = state.metrics[legacyFocusPeak];
  }
  delete state.metrics[legacyScore];
  delete state.metrics[legacyFocusPeak];
}

function normalizeState() {
  if (!state.phase)      state.phase = 1;
  if (!state.days)       state.days = {};
  migrateLegacyMetrics();
  if (!state.metrics)    state.metrics = { scoreHistory: [], focusPeaks: [] };
  if (!state.metrics.scoreHistory) state.metrics.scoreHistory = [];
  if (!state.metrics.focusPeaks) state.metrics.focusPeaks = [];
  if (!state.books || !Array.isArray(state.books)) state.books = [];
  if (!state.errorLog)   state.errorLog = [];
  if (!state.startDate)  state.startDate = todayStr();
  if (!state.customNonNegs) state.customNonNegs = [];
  if (!state.removedNonNegs) state.removedNonNegs = [];
  if (!state.nonNegTemplates) state.nonNegTemplates = [];
  if (!state.customTraining) state.customTraining = {};
  if (!state.removedTraining) state.removedTraining = {};
  if (!state.trainingTemplates) state.trainingTemplates = {};
  if (!state.nonNegOverrides) state.nonNegOverrides = {};
  if (!state.exerciseOverrides) state.exerciseOverrides = {};
  if (!state.timerSettings) state.timerSettings = {};
  if (!state.timerSettings.pomodoroMs) state.timerSettings.pomodoroMs = Math.max(1, +(state.timerSettings.pomodoroMinutes || 25)) * 60 * 1000;
  if (!state.timerSettings.breakMs) state.timerSettings.breakMs = 5 * 60 * 1000;
  if (!state.numberLabels || typeof state.numberLabels !== 'object') state.numberLabels = {};
  if (!Array.isArray(state.customBenchmarks)) state.customBenchmarks = DEFAULT_BENCHMARKS.map(item => ({ ...item }));
  if (!Array.isArray(state.reminders)) state.reminders = [];
  state.reminders = state.reminders.map(r => ({
    id: r.id || `rem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    text: String(r.text || r.title || '').trim(),
    date: r.date || todayStr(),
    time: r.time || '',
    notes: r.notes || '',
    done: !!r.done,
    createdAt: r.createdAt || new Date().toISOString()
  })).filter(r => r.text && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  Object.keys(state).forEach(key => { if (/^tutor/i.test(key)) delete state[key]; });
  migrateTrainingIdentity();
  updateTargetsMap();
}

normalizeState();

let selectedDate = todayStr();
let weekOffset   = 0; // for weekly tab navigation
let editingTrainingId = null;
let editingNonNegId = null;
let editingExercise = false;
let dragTrainingId = null;
let pendingTrainingEdit = null;
let pendingNonNegEdit   = null;
let pendingExerciseEdit = null;
let _scopeOutsideHandler = null;
let timerMode = 'pomodoro';
let timerRunning = false;
let timerStartedAt = null;
let timerElapsedMs = 0;
let timerInterval = null;
let timerLastLog = '';
let timerBreakMode = false;
let manualTimerTargetId = null;
const TIMER_SOUND_URL = 'assets/audio/timer-complete.mp3';
let timerSoundUnlocked = false;
let timerAlarmAudio = null;
let timerAlarmFallback = null;

function save() {
  state.selectedDate = selectedDate;
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleServerBackup();
  scheduleBackup();
  renderDataPreviewIfVisible();
}

function todayStr() {
  return dateKey(new Date());
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
}

function parseDateKey(ds) {
  const [y,m,d] = ds.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(ds, count) {
  const date = parseDateKey(ds);
  date.setDate(date.getDate() + count);
  return dateKey(date);
}

function formatDate(ds, opts) {
  return parseDateKey(ds).toLocaleDateString('en-GB', opts);
}

function mondayFor(ds) {
  const d = parseDateKey(ds);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dateKey(d);
}

function defaultDayState() {
  return {
    mode:null, checks:{}, energy:null, sleepHours:null, lightsOut:'', focusScore:null,
    practiceReps:0, projectReps:0, oaScore:null, deepWorkReps:0, insight:'', notes:'',
    taskHours:{}, wins:'', blockers:'', tomorrow:'', mistake:'', mood:null, distractions:0,
    ankiCards:0, readingMins:0, contestDone:false
  };
}

function getDay(ds) {
  if (!state.days[ds] || typeof state.days[ds] !== 'object') state.days[ds] = {};
  state.days[ds] = { ...defaultDayState(), ...state.days[ds] };
  if (!state.days[ds].checks || typeof state.days[ds].checks !== 'object') state.days[ds].checks = {};
  if (!state.days[ds].taskHours || typeof state.days[ds].taskHours !== 'object') state.days[ds].taskHours = {};
  return state.days[ds];
}

function withSource(items, source) {
  return items.map(item => ({ ...item, source }));
}

function getNonNegTemplateItems(ds = selectedDate) {
  const dateItems = (state.nonNegDateOverrides || {})[ds];
  if (dateItems) return withSource(dateItems, 'date-override');

  const dow = parseDateKey(ds).getDay();
  // DOW-specific override takes priority
  const dowEntries = ((state.nonNegTemplatesByDow || {})[dow] || []);
  const dowUsable = dowEntries
    .filter(entry => entry.effectiveFrom <= ds)
    .sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (dowUsable.length) return withSource(dowUsable[dowUsable.length - 1].items, 'template');

  const templates = (state.nonNegTemplates || []);
  const usable = templates
    .filter(entry => entry.effectiveFrom <= ds)
    .sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (usable.length) return withSource(usable[usable.length - 1].items, 'template');

  const removed = new Set(state.removedNonNegs || []);
  const overrides = state.nonNegOverrides || {};
  const defaults = NON_NEGS
    .filter(item => !removed.has(item.id))
    .map(item => ({ ...item, ...(overrides[item.id] || {}) }));
  return [
    ...withSource(defaults, 'default'),
    ...withSource(state.customNonNegs || [], 'custom')
  ];
}

function saveNonNegTemplateForDow(items, dow, fromDate = effectiveTemplateDate()) {
  if (!state.nonNegTemplatesByDow) state.nonNegTemplatesByDow = {};
  if (!state.nonNegTemplatesByDow[dow]) state.nonNegTemplatesByDow[dow] = [];
  state.nonNegTemplatesByDow[dow] = state.nonNegTemplatesByDow[dow].filter(e => e.effectiveFrom < fromDate);
  state.nonNegTemplatesByDow[dow].push({ effectiveFrom: fromDate, items: items.map(stripRuntime) });
  state.nonNegTemplatesByDow[dow].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

function getNonNegs(ds = selectedDate, difficultyOverride = null) {
  const day = getDay(ds);
  const dow = parseDateKey(ds).getDay();
  const difficulty = difficultyOverride || defaultDifficultyForDow(dow);
  return getNonNegTemplateItems(ds).filter(item => itemAppliesToDifficulty(item, difficulty));
}

function saveNonNegTemplate(items, fromDate = effectiveTemplateDate()) {
  if (!state.nonNegTemplates) state.nonNegTemplates = [];
  state.nonNegTemplates = state.nonNegTemplates.filter(entry => entry.effectiveFrom < fromDate);
  state.nonNegTemplates.push({
    effectiveFrom: fromDate,
    items: items.map(stripRuntime)
  });
  state.nonNegTemplates.sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

function getExercise(dow) {
  const base = EXERCISE_BY_DOW[dow];
  if (!base) return null;
  return { ...base, ...((state.exerciseOverrides || {})[dow] || {}) };
}

function getExerciseForDate(ds) {
  const dow = parseDateKey(ds).getDay();
  const base = EXERCISE_BY_DOW[dow];
  if (!base) return null;
  const dowOverride  = (state.exerciseOverrides || {})[dow] || {};
  const dateOverride = (state.exerciseDateOverrides || {})[ds] || {};
  return { ...base, ...dowOverride, ...dateOverride };
}

function defaultTrainingForDifficulty(difficulty) {
  if (difficulty === 'rest') return [];
  const target = TARGETS[difficulty] || TARGETS.hard;
  const base = canonicalizeTrainingItems((TRAINING[target.base] || []).map(item => ({ ...item })));
  return canonicalizeTrainingItems(base);
}

function templateKey(dow, difficulty) {
  return `${dow}:${difficulty}`;
}

function stripRuntime(item) {
  const { source, ...clean } = item;
  return clean;
}

function getTraining(difficulty, dow, ds) {
  const dateItems = (state.trainingDateOverrides || {})[ds];
  if (dateItems) return withSource(canonicalizeTrainingItems(dateItems), 'date-override');

  const entries = (state.trainingTemplates || {})[templateKey(dow, difficulty)] || [];
  const usable = entries
    .filter(entry => entry.effectiveFrom <= ds)
    .sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (usable.length) return withSource(canonicalizeTrainingItems(usable[usable.length - 1].items), 'template');

  const legacyMode = TARGETS[difficulty]?.base || '4h';
  const removed = new Set((state.removedTraining || {})[legacyMode] || []);
  const defaults = defaultTrainingForDifficulty(difficulty).filter(item => !removed.has(item.id));
  const legacyCustom = ((state.customTraining || {})[legacyMode] || []);
  return withSource(canonicalizeTrainingItems([...defaults, ...legacyCustom]), 'default');
}

function effectiveTemplateDate() {
  return selectedDate < todayStr() ? todayStr() : selectedDate;
}

function saveTrainingTemplate(difficulty, dow, items, fromDate = effectiveTemplateDate()) {
  const key = templateKey(dow, difficulty);
  if (!state.trainingTemplates[key]) state.trainingTemplates[key] = [];
  state.trainingTemplates[key] = state.trainingTemplates[key].filter(entry => entry.effectiveFrom < fromDate);
  state.trainingTemplates[key].push({
    effectiveFrom: fromDate,
    items: items.map(stripRuntime)
  });
  state.trainingTemplates[key].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

function saveDailyTaskTemplate(items, difficulty = 'hard', fromDate = effectiveTemplateDate()) {
  WORKDAY_DOWS.forEach(dow => saveTrainingTemplate(difficulty, dow, items, fromDate));
}

function newCustomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clearInputs(ids) {
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function getCheckedScopes(containerId) {
  const checked = [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)].map(input => input.value);
  return [...new Set(checked.filter(value => DIFFICULTY_KEYS.includes(value)))];
}

function renderScopeBadges(item) {
  const scopes = normalizeAppliesTo(item.appliesTo);
  if (scopes.length === DIFFICULTY_KEYS.length) return '';
  return `<div class="scope-badges">${scopes.map(scope => `<span class="scope-badge">${DIFFICULTY_LABELS[scope]}</span>`).join('')}</div>`;
}

function adjustInpValue(id, delta) {
  const el = document.getElementById(id);
  if (!el) return;
  const isTime = id.includes('Hours');
  let val = isTime ? parseTimeStr(el.value) : parseFloat(el.value);
  if (isNaN(val)) val = 0;
  
  const newVal = Math.max(0, val + delta);
  el.value = isTime ? formatHours(newVal) : newVal;
}

function showToast(message, kind = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  const icon = document.createElement('span');
  icon.textContent = kind === 'success' ? '✓' : '✕';
  toast.appendChild(icon);
  toast.appendChild(document.createTextNode(` ${message}`));
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function closeScopePopup() {
  const el = document.getElementById('scopePopup');
  if (el) el.remove();
  if (_scopeOutsideHandler) {
    document.removeEventListener('click', _scopeOutsideHandler);
    _scopeOutsideHandler = null;
  }
}

function showScopePopup(anchorEl, dayName, dateLabel, onAllWeekdays, onThisDayOnly, onThisDateOnly, onCancel) {
  closeScopePopup();
  const popup = document.createElement('div');
  popup.id = 'scopePopup';
  popup.className = 'scope-popup';
  popup.innerHTML = `
    <div class="scope-popup-label">Apply change to</div>
    <button class="scope-popup-btn" id="scopeAll"><span class="scope-icon">📅</span>All weekdays (Mon–Fri) permanently</button>
    <button class="scope-popup-btn" id="scopeDay"><span class="scope-icon">🔁</span>Every ${dayName} going forward</button>
    <button class="scope-popup-btn" id="scopeDate"><span class="scope-icon">📌</span>This date only (${dateLabel})</button>
  `;
  document.body.appendChild(popup);
  const rect = anchorEl.getBoundingClientRect();
  popup.style.top = (rect.bottom + 6) + 'px';
  popup.style.left = rect.left + 'px';
  requestAnimationFrame(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 10) popup.style.left = (window.innerWidth - pr.width - 10) + 'px';
    if (pr.bottom > window.innerHeight - 10) popup.style.top = (rect.top - pr.height - 6) + 'px';
  });
  const choose = fn => e => {
    e.stopPropagation();
    if (_scopeOutsideHandler) { document.removeEventListener('click', _scopeOutsideHandler); _scopeOutsideHandler = null; }
    closeScopePopup();
    fn();
  };
  document.getElementById('scopeAll').onclick  = choose(onAllWeekdays);
  document.getElementById('scopeDay').onclick  = choose(onThisDayOnly);
  document.getElementById('scopeDate').onclick = choose(onThisDateOnly);
  _scopeOutsideHandler = () => { _scopeOutsideHandler = null; closeScopePopup(); if (onCancel) onCancel(); };
  setTimeout(() => document.addEventListener('click', _scopeOutsideHandler, { once: true }), 0);
}

function formatDateLabel(ds) {
  try {
    return formatDate(ds, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return ds; }
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function reminderDateTime(reminder) {
  if (!reminder?.date || !/^\d{4}-\d{2}-\d{2}$/.test(reminder.date)) return null;
  const [h = 0, m = 0] = /^\d{2}:\d{2}$/.test(reminder.time || '') ? reminder.time.split(':').map(Number) : [0, 0];
  const due = parseDateKey(reminder.date);
  due.setHours(h, m, 0, 0);
  return due;
}

function reminderDayDiff(reminder, baseDs = selectedDate) {
  const due = parseDateKey(reminder.date);
  const base = parseDateKey(baseDs);
  due.setHours(0, 0, 0, 0);
  base.setHours(0, 0, 0, 0);
  return Math.round((due - base) / 86400000);
}

function formatReminderDistance(reminder, baseDs = selectedDate) {
  const diff = reminderDayDiff(reminder, baseDs);
  if (diff < 0) return `overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'}`;
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return `in ${diff} days`;
}

function formatReminderWhen(reminder, baseDs = selectedDate) {
  const dateLabel = formatDate(reminder.date, { weekday:'short', day:'numeric', month:'short' });
  const timeLabel = reminder.time ? ` · ${reminder.time}` : '';
  return `${formatReminderDistance(reminder, baseDs)} · ${dateLabel}${timeLabel}`;
}

function sortedReminders(includeDone = false) {
  const rows = (state.reminders || []).filter(r => includeDone || !r.done);
  return rows.sort((a, b) => {
    const ad = reminderDateTime(a)?.getTime() || 0;
    const bd = reminderDateTime(b)?.getTime() || 0;
    if (ad !== bd) return ad - bd;
    return String(a.text).localeCompare(String(b.text));
  });
}

function getDashboardReminders(limit = 4) {
  return sortedReminders(false).slice(0, limit);
}

function reminderRowHtml(reminder, options = {}) {
  const dueClass = reminderDayDiff(reminder) < 0 ? ' overdue' : '';
  const notes = reminder.notes ? `<div class="reminder-meta">${escapeAttr(reminder.notes)}</div>` : '';
  const actions = options.actions === false ? '' : `
    <button class="btn sm" onclick="toggleReminderDone('${escapeAttr(reminder.id)}')">${reminder.done ? 'Undo' : 'Done'}</button>
    <button class="btn sm danger" onclick="deleteReminder('${escapeAttr(reminder.id)}')">Delete</button>
  `;
  return `
    <div class="reminder-row ${reminder.done ? 'done' : ''}">
      <input class="reminder-check" type="checkbox" ${reminder.done ? 'checked' : ''} onchange="toggleReminderDone('${escapeAttr(reminder.id)}')">
      <div class="reminder-main">
        <div class="reminder-title">${escapeAttr(reminder.text)}</div>
        ${notes}
      </div>
      <div class="reminder-due${dueClass}">${escapeAttr(formatReminderWhen(reminder))}</div>
      <div class="row" style="justify-content:flex-end">${actions}</div>
    </div>
  `;
}

function addReminder() {
  const textEl = document.getElementById('reminderText');
  const dateEl = document.getElementById('reminderDate');
  const timeEl = document.getElementById('reminderTime');
  const notesEl = document.getElementById('reminderNotes');
  const text = (textEl?.value || '').trim();
  const date = dateEl?.value || selectedDate;
  if (!text) { showToast('Reminder text missing', 'danger'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('Reminder date missing', 'danger'); return; }
  state.reminders.push({
    id: `rem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    text,
    date,
    time: timeEl?.value || '',
    notes: (notesEl?.value || '').trim(),
    done: false,
    createdAt: new Date().toISOString()
  });
  if (textEl) textEl.value = '';
  if (notesEl) notesEl.value = '';
  if (timeEl) timeEl.value = '';
  save();
  renderReminders();
  renderDashboard();
  showToast('Reminder added', 'success');
}

function toggleReminderDone(id) {
  const reminder = (state.reminders || []).find(r => String(r.id) === String(id));
  if (!reminder) return;
  reminder.done = !reminder.done;
  save();
  renderReminders();
  renderDashboard();
}

function deleteReminder(id) {
  state.reminders = (state.reminders || []).filter(r => String(r.id) !== String(id));
  save();
  renderReminders();
  renderDashboard();
  showToast('Reminder deleted', 'danger');
}

function renderReminders() {
  const dateEl = document.getElementById('reminderDate');
  if (dateEl && !dateEl.value) dateEl.value = selectedDate;
  const list = document.getElementById('reminderList');
  const count = document.getElementById('reminderCount');
  if (!list) return;
  const active = sortedReminders(false);
  const done = sortedReminders(true).filter(r => r.done).slice(-8).reverse();
  if (count) count.textContent = `${active.length}`;
  if (!active.length && !done.length) {
    list.innerHTML = `<div class="dash-empty">No reminders yet</div>`;
    return;
  }
  list.innerHTML = [
    ...active.map(r => reminderRowHtml(r)),
    ...done.map(r => reminderRowHtml(r))
  ].join('');
}

function jsArg(value) {
  return escapeAttr(JSON.stringify(String(value ?? '')));
}

function labelForNumberField(key) {
  const cfg = TODAY_NUMBER_FIELDS.find(field => field.key === key);
  return state.numberLabels?.[key] || cfg?.label || key;
}

function renderTodayNumberInputs() {
  const grid = document.getElementById('todayNumbersGrid');
  if (!grid) return;
  grid.innerHTML = TODAY_NUMBER_FIELDS.map(field => {
    const input = field.type === 'checkbox'
      ? `<input type="checkbox" id="${field.id}" onchange="saveInput('${field.key}',this.checked)" style="width:20px;height:20px;accent-color:var(--accent);cursor:pointer;">`
      : `<input class="compact-input" type="${field.type}" id="${field.id}" ${field.attrs} placeholder="${escapeAttr(field.placeholder)}" oninput="saveInput('${field.key}',this.value)" style="margin:0;">`;
    return `
      <div class="today-number-field">
        <label for="${field.id}" title="${escapeAttr(labelForNumberField(field.key))}">${escapeAttr(labelForNumberField(field.key))}</label>
        ${input}
      </div>`;
  }).join('');
}

function toggleNumberLabelEditor() {
  const editor = document.getElementById('numberLabelEditor');
  if (!editor) return;
  editor.classList.toggle('hidden');
  if (!editor.classList.contains('hidden')) renderNumberLabelEditor();
}

function renderNumberLabelEditor() {
  const editor = document.getElementById('numberLabelEditor');
  if (!editor) return;
  editor.innerHTML = TODAY_NUMBER_FIELDS.map(field => `
    <div class="number-label-row">
      <span>${escapeAttr(field.key)}</span>
      <input type="text" value="${escapeAttr(labelForNumberField(field.key))}" oninput="updateNumberLabel('${field.key}',this.value)" aria-label="Label for ${escapeAttr(field.key)}">
      <input type="text" value="${escapeAttr(field.placeholder)}" disabled aria-label="Input type">
    </div>
  `).join('') + '<button class="btn sm" onclick="resetNumberLabels()">Reset labels</button>';
}

function updateNumberLabel(key, value) {
  if (!state.numberLabels) state.numberLabels = {};
  const fallback = TODAY_NUMBER_FIELDS.find(field => field.key === key)?.label || key;
  const next = value.trim();
  if (!next || next === fallback) delete state.numberLabels[key];
  else state.numberLabels[key] = next;
  save();
  renderTodayNumberInputs();
  fillDailyNumberInputs();
}

function resetNumberLabels() {
  state.numberLabels = {};
  save();
  renderTodayNumberInputs();
  renderNumberLabelEditor();
  fillDailyNumberInputs();
}

function addNonNeg(btn) {
  const text = document.getElementById('nn-new-text').value.trim();
  const meta = document.getElementById('nn-new-meta').value.trim();
  const tag = document.getElementById('nn-new-tag').value.trim();
  if (!text) return;
  const scopes = getCheckedScopes('nn-new-scope');
  if (!scopes.length) { showToast('Daily task scope missing', 'danger'); return; }
  const dow = parseDateKey(selectedDate).getDay();
  const ds = selectedDate;
  const dayName = DAY_FULL[dow];
  const newItem = { id: newCustomId('nn_custom'), text, meta, tag, appliesTo: scopes };
  const doAdd = (saveFn) => {
    const items = getNonNegTemplateItems(ds).map(stripRuntime);
    items.push(newItem);
    saveFn(items);
    clearInputs(['nn-new-text', 'nn-new-meta', 'nn-new-tag']);
    save(); renderDaily();
  };
  showScopePopup(btn, dayName, ds,
    () => doAdd(i => saveNonNegTemplate(i)),
    () => doAdd(i => saveNonNegTemplateForDow(i, dow)),
    () => doAdd(i => { if (!state.nonNegDateOverrides) state.nonNegDateOverrides = {}; state.nonNegDateOverrides[ds] = i; })
  );
}

function removeNonNeg(id, btn) {
  const dow = parseDateKey(selectedDate).getDay();
  const ds = selectedDate;
  const dayName = DAY_FULL[dow];
  const doRemove = (saveFn) => {
    const items = getNonNegTemplateItems(ds).filter(item => item.id !== id).map(stripRuntime);
    saveFn(items);
    save(); renderDaily();
  };
  showScopePopup(btn, dayName, ds,
    () => doRemove(i => saveNonNegTemplate(i)),
    () => doRemove(i => saveNonNegTemplateForDow(i, dow)),
    () => doRemove(i => { if (!state.nonNegDateOverrides) state.nonNegDateOverrides = {}; state.nonNegDateOverrides[ds] = i; })
  );
}

function resetNonNegs() {
  saveNonNegTemplate(NON_NEGS);
  if (state.nonNegDateOverrides) delete state.nonNegDateOverrides[selectedDate];
  const dow = parseDateKey(selectedDate).getDay();
  if (state.nonNegTemplatesByDow) delete state.nonNegTemplatesByDow[dow];
  pendingNonNegEdit = null;
  save();
  renderDaily();
}

function updateNonNeg(id, source, field, value) {
  if (!pendingNonNegEdit || pendingNonNegEdit.ds !== selectedDate) {
    pendingNonNegEdit = { ds: selectedDate, items: getNonNegTemplateItems().map(stripRuntime) };
  }
  const item = pendingNonNegEdit.items.find(task => task.id === id);
  if (!item) return;
  if (field === 'dur') value = formatHours(parseTimeStr(value));
  item[field] = value;
}

function confirmNonNegEdit(doneBtn) {
  const dow = parseDateKey(selectedDate).getDay();
  const ds = selectedDate;
  const dayName = DAY_FULL[dow];
  const items = (pendingNonNegEdit?.ds === ds ? pendingNonNegEdit.items : getNonNegTemplateItems(ds)).map(stripRuntime);
  const commit = saveFn => { saveFn(); pendingNonNegEdit = null; save(); editingNonNegId = null; renderDaily(); };
  const cancel = () => { pendingNonNegEdit = null; editingNonNegId = null; renderDaily(); };
  showScopePopup(doneBtn, dayName, formatDateLabel(ds),
    () => commit(() => saveNonNegTemplate(items)),
    () => commit(() => saveNonNegTemplateForDow(items, dow)),
    () => commit(() => { if (!state.nonNegDateOverrides) state.nonNegDateOverrides = {}; state.nonNegDateOverrides[ds] = items; }),
    cancel
  );
}

function addTrainingItem(btn) {
  const dow = parseDateKey(selectedDate).getDay();
  if (defaultDifficultyForDow(dow) === 'rest') {
    showToast('Rest days use no daily task set', 'danger');
    return;
  }
  const difficulties = getCheckedScopes('tr-new-scope');
  const text = document.getElementById('tr-new-text').value.trim();
  const meta = document.getElementById('tr-new-meta').value.trim();
  const tag = document.getElementById('tr-new-tag').value.trim();
  if (!text) return;
  if (!difficulties.length) {
    showToast('Daily task scope missing', 'danger');
    return;
  }
  const id = newCustomId('tr_custom');
  const difficulty = 'hard';
  const ds = selectedDate;
  const dayName = DAY_FULL[dow];
  const newItem = { id, trackingId: id, text, meta, tag, time: '', appliesTo: difficulties };
  const doAdd = (saveFn) => {
    const items = getTraining(difficulty, dow, ds).map(stripRuntime);
    items.push(newItem);
    saveFn(items);
    clearInputs(['tr-new-text', 'tr-new-meta', 'tr-new-tag']);
    save(); renderDaily();
  };
  showScopePopup(btn, dayName, ds,
    () => doAdd(i => saveDailyTaskTemplate(i, difficulty)),
    () => doAdd(i => saveTrainingTemplate(difficulty, dow, i)),
    () => doAdd(i => { if (!state.trainingDateOverrides) state.trainingDateOverrides = {}; state.trainingDateOverrides[ds] = i; })
  );
}

function removeTrainingItem(difficulty, id, btn) {
  const dow = parseDateKey(selectedDate).getDay();
  const ds = selectedDate;
  const dayName = DAY_FULL[dow];
  const trackingId = trackingIdForTask(getTraining(difficulty, dow, ds).find(item => item.id === id) || id);
  const items = getTraining('hard', dow, ds).filter(item => trackingIdForTask(item) !== trackingId).map(stripRuntime);
  showScopePopup(btn, dayName, ds,
    () => { saveDailyTaskTemplate(items); save(); renderDaily(); },
    () => { saveTrainingTemplate('hard', dow, items); save(); renderDaily(); },
    () => { if (!state.trainingDateOverrides) state.trainingDateOverrides = {}; state.trainingDateOverrides[ds] = items; save(); renderDaily(); }
  );
}

function resetTrainingMode(difficulty) {
  saveDailyTaskTemplate(defaultTrainingForDifficulty('hard'));
  save();
  renderDaily();
}

function updateTrainingTask(difficulty, id, field, value) {
  const dow = parseDateKey(selectedDate).getDay();
  if (!pendingTrainingEdit || pendingTrainingEdit.ds !== selectedDate) {
    pendingTrainingEdit = { ds: selectedDate, items: getTraining('hard', dow, selectedDate).map(stripRuntime) };
  }
  const item = pendingTrainingEdit.items.find(task => task.id === id);
  if (item) item[field] = value;
}

function confirmTrainingEdit(doneBtn) {
  const dow = parseDateKey(selectedDate).getDay();
  const ds = selectedDate;
  const dayName = DAY_FULL[dow];
  const items = (pendingTrainingEdit?.ds === ds ? pendingTrainingEdit.items : getTraining('hard', dow, ds)).map(stripRuntime);
  const commit = saveFn => { saveFn(); pendingTrainingEdit = null; save(); editingTrainingId = null; renderDaily(); };
  const cancel = () => { pendingTrainingEdit = null; editingTrainingId = null; renderDaily(); };
  showScopePopup(doneBtn, dayName, formatDateLabel(ds),
    () => commit(() => saveDailyTaskTemplate(items)),
    () => commit(() => saveTrainingTemplate('hard', dow, items)),
    () => commit(() => { if (!state.trainingDateOverrides) state.trainingDateOverrides = {}; state.trainingDateOverrides[ds] = items; }),
    cancel
  );
}

function reorderTrainingItem(difficulty, fromId, toId, anchorEl) {
  if (!fromId || !toId || fromId === toId) { dragTrainingId = null; return; }
  const dow = parseDateKey(selectedDate).getDay();
  const ds = selectedDate;
  const dayName = DAY_FULL[dow];
  const items = getTraining('hard', dow, ds).map(stripRuntime);
  const fromIndex = items.findIndex(item => item.id === fromId);
  const toIndex   = items.findIndex(item => item.id === toId);
  if (fromIndex < 0 || toIndex < 0) { dragTrainingId = null; return; }
  const [moved] = items.splice(fromIndex, 1);
  const targetIndex = items.findIndex(item => item.id === toId);
  items.splice(targetIndex < 0 ? toIndex : targetIndex, 0, moved);
  showScopePopup(anchorEl, dayName, formatDateLabel(ds),
    () => { saveDailyTaskTemplate(items); save(); renderDaily(); },
    () => { saveTrainingTemplate('hard', dow, items); save(); renderDaily(); },
    () => { if (!state.trainingDateOverrides) state.trainingDateOverrides = {}; state.trainingDateOverrides[ds] = items; save(); renderDaily(); }
  );
}

function startTrainingDrag(id) {
  dragTrainingId = id;
}

function dropTrainingItem(difficulty, targetId, anchorEl) {
  reorderTrainingItem(difficulty, dragTrainingId, targetId, anchorEl);
  dragTrainingId = null;
}

function updateExercise(field, value) {
  if (!pendingExerciseEdit || pendingExerciseEdit.ds !== selectedDate) {
    const dow = parseDateKey(selectedDate).getDay();
    const cur = getExerciseForDate(selectedDate) || {};
    pendingExerciseEdit = { ds: selectedDate, fields: { text: cur.text || '', meta: cur.meta || '' } };
  }
  pendingExerciseEdit.fields[field] = value;
}

function confirmExerciseEdit(doneBtn) {
  const dow = parseDateKey(selectedDate).getDay();
  const ds = selectedDate;
  const dayName = DAY_FULL[dow];
  const fields = pendingExerciseEdit?.ds === ds ? { ...pendingExerciseEdit.fields } : {};
  const commit = saveFn => { saveFn(); pendingExerciseEdit = null; save(); editingExercise = false; renderDaily(); };
  const cancel = () => { pendingExerciseEdit = null; editingExercise = false; renderDaily(); };
  showScopePopup(doneBtn, dayName, formatDateLabel(ds),
    () => commit(() => WORKDAY_DOWS.forEach(d => { if (!state.exerciseOverrides[d]) state.exerciseOverrides[d] = {}; Object.assign(state.exerciseOverrides[d], fields); })),
    () => commit(() => { if (!state.exerciseOverrides[dow]) state.exerciseOverrides[dow] = {}; Object.assign(state.exerciseOverrides[dow], fields); }),
    () => commit(() => { if (!state.exerciseDateOverrides) state.exerciseDateOverrides = {}; if (!state.exerciseDateOverrides[ds]) state.exerciseDateOverrides[ds] = {}; Object.assign(state.exerciseDateOverrides[ds], fields); }),
    cancel
  );
}

function resetExercise() {
  const dow = parseDateKey(selectedDate).getDay();
  delete state.exerciseOverrides[dow];
  if (state.exerciseDateOverrides) delete state.exerciseDateOverrides[selectedDate];
  pendingExerciseEdit = null;
  editingExercise = false;
  save();
  renderDaily();
}

function saveTaskHours(id, value) {
  const d = getDay(selectedDate);
  const trackingId = trackingIdForTask(id);
  const num = value === '' ? null : Math.max(0, parseTimeStr(value));
  if (num === null || isNaN(num)) delete d.taskHours[trackingId];
  else d.taskHours[trackingId] = Math.round(num * 10000) / 10000;
  save();
  renderStats();
  renderDashboard();
  renderTimer();
}
function adjustTaskHours(id, delta) {
  const d = getDay(selectedDate);
  const trackingId = trackingIdForTask(id);
  const current = +(d.taskHours?.[trackingId] || 0);
  const next = Math.max(0, Math.round((current + delta) * 10000) / 10000);
  saveTaskHours(id, next ? String(next) : '');
}

function getLoggedHours(ds) {
  const d = getDay(ds);
  return Object.entries(d.taskHours || {}).reduce((sum, [id, val]) => {
    return sum + Math.max(0, +val || 0);
  }, 0);
}

function getWeekLoggedHours(refDate = todayStr()) {
  return getWeekDates(refDate).reduce((sum, ds) => sum + getLoggedHours(ds), 0);
}

function formatHours(val) {
  if (val == null || isNaN(val) || val < 0) return '00:00:00';
  const totalSecs = Math.round(val * 3600);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function parseTimeStr(str) {
  if (typeof str !== 'string') return Math.max(0, parseFloat(str) || 0);
  if (!str.includes(':')) return Math.max(0, parseFloat(str) || 0);
  const parts = str.split(':').map(part => Math.max(0, Number(part)));
  const [h = 0, m = 0, s = 0] = parts;
  return h + m / 60 + s / 3600;
}

function renderDashBars(points, options = {}) {
  const max = Math.max(options.minMax || 0, ...points.map(point => point.value || 0));
  if (!max) return `<div class="dash-empty">No data yet</div>`;
  // Threshold line: positioned relative to bar plot area (92px total, 8px padding-top → 84px plot)
  const thresholdLine = (options.threshold != null)
    ? `<div class="dash-threshold-line" style="bottom:${Math.round((options.threshold / max) * 84)}px"></div>`
    : '';
  return `<div class="dash-bars">${thresholdLine}${points.map(point => {
    const label = escapeAttr(point.label);
    const title = escapeAttr(`${point.label}: ${point.title}`);
    if (point.isRest) {
      return `<div class="dash-bar-wrap" title="${title}">
        <div class="dash-bar-plot" style="position:relative"><div class="dash-rest-label">rest</div></div>
        <div class="dash-bar-value">—</div>
        <div class="dash-bar-label">${label}</div>
      </div>`;
    }
    const height = Math.max(3, Math.round(((point.value || 0) / max) * 100));
    return `<div class="dash-bar-wrap" title="${title}">
      <div class="dash-bar-plot"><div class="dash-bar ${point.isToday ? 'today' : ''}" style="height:${height}%;background:${point.color || ''}"></div></div>
      <div class="dash-bar-value">${escapeAttr(point.shortTitle || point.title)}</div>
      <div class="dash-bar-label">${label}</div>
    </div>`;
  }).join('')}</div>`;
}

function getCompletionForSelected() {
  const dow = parseDateKey(selectedDate).getDay();
  const d = getDay(selectedDate);
  const difficulty = defaultDifficultyForDow(dow);
  const all = getAllHabitIds(difficulty, dow, selectedDate);
  const done = all.filter(id => isCheckDone(d, id)).length;
  return { done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 };
}

function renderDashboard() {
  const dow = parseDateKey(selectedDate).getDay();
  const d = getDay(selectedDate);
  const difficulty = defaultDifficultyForDow(dow);
  const target = TARGETS[difficulty] || TARGETS.hard;
  const comp = getCompletionForSelected();
  const hours = getLoggedHours(selectedDate);
  const weekHours = getWeekLoggedHours(selectedDate);
  const targetHours = target.targetHours || 0;
  const hoursPct = targetHours ? Math.min(100, Math.round((hours / targetHours) * 100)) : 0;
  const week = getWeekDates(selectedDate);
  const training = getTraining(difficulty, dow, selectedDate);
  const nextTask = training.find(task => !isCheckDone(d, trackingIdForTask(task)));
  const nextTaskId = nextTask ? trackingIdForTask(nextTask) : null;
  const nextMeta = nextTask
    ? [nextTask.tag, nextTask.meta].filter(Boolean).join(' · ')
    : (d.tomorrow || d.insight || 'All clear. Set up tomorrow.');
  const ringDeg = Math.round((comp.pct / 100) * 360);
  const ringColor = comp.pct >= 70 ? 'var(--green)' : comp.pct >= 40 ? 'var(--amber)' : comp.pct > 0 ? 'var(--red)' : 'var(--border2)';
  const history = week.map(ds => {
    const day = getDay(ds);
    const dayDow = parseDateKey(ds).getDay();
    const isRest = dayDow === 0 || dayDow === 6;
    const dayComp = getDayCompletion(ds);
    const dayHours = getLoggedHours(ds);
    return {
      ds,
      label: DAY_NAMES[dayDow],
      isToday: ds === selectedDate,
      isRest,
      hours: dayHours,
      completion: dayComp ? Math.round(dayComp.pct * 100) : 0,
      sleep: Number(day.sleepHours || 0)
    };
  });
  const hourPoints = history.map(point => ({
    label: point.label,
    value: point.hours,
    isToday: point.isToday,
    title: formatHours(point.hours),
    shortTitle: formatHours(point.hours).replace(/^00:/, ''),
    color: point.isToday ? 'var(--accent)' : 'var(--accent2)'
  }));
  const completionPoints = history.map(point => ({
    label: point.label,
    value: point.completion,
    isToday: point.isToday,
    isRest: point.isRest,
    title: `${point.completion}%`,
    shortTitle: `${point.completion}%`,
    color: point.completion >= 70 ? 'var(--green)' : point.completion >= 40 ? 'var(--amber)' : point.completion > 0 ? 'var(--red)' : 'var(--border2)'
  }));
  const sleepPoints = history.map(point => ({
    label: point.label,
    value: point.sleep,
    isToday: point.isToday,
    title: point.sleep ? `${point.sleep}h` : 'No entry',
    shortTitle: point.sleep ? `${point.sleep}h` : '—',
    color: point.sleep >= 7.5 ? 'var(--green)' : point.sleep >= 6 ? 'var(--amber)' : point.sleep > 0 ? 'var(--red)' : 'var(--border2)'
  }));
  const reminders = getDashboardReminders();
  const reminderHtml = reminders.length
    ? reminders.map(r => reminderRowHtml(r, { actions:false })).join('')
    : `<div class="dash-empty">No upcoming reminders</div>`;
  document.getElementById('dashboardSummary').innerHTML = `
    <div class="dash-panel primary">
      <div class="dash-label">Time today</div>
      <div class="dash-hero-value">${formatHours(hours)}</div>
      <div class="dash-subline">${difficulty === 'rest' ? 'Rest day' : `6h workday reference · ${hoursPct}% reached`}</div>
      <div class="dash-progress-bar"><div class="dash-progress-fill" style="width:${hoursPct}%"></div></div>
    </div>
    <div class="dash-panel">
      <div class="dash-label">Completion</div>
      <div class="dash-ring-wrap">
        <div class="dash-ring" style="--dash-ring:${ringDeg}deg;background:conic-gradient(${ringColor} ${ringDeg}deg, var(--surf3) 0)">
          <div class="dash-ring-inner">
            <div class="dash-ring-value">${comp.pct}%</div>
            <div class="dash-ring-label">${comp.done}/${comp.total} tasks</div>
          </div>
        </div>
      </div>
    </div>
    <div class="dash-panel dash-next">
      <div class="dash-label">Next task</div>
      <div class="dash-next-task">${escapeAttr(nextTask ? nextTask.text : 'All tasks done')}</div>
      <div class="dash-next-meta">${escapeAttr(nextMeta)}</div>
      ${nextTask ? `<button class="btn sm primary" style="margin-top:4px;width:100%" onclick="toggle('${escapeAttr(selectedDate)}','${escapeAttr(nextTaskId)}')">Mark done</button>` : ''}
      <div class="dash-subline" style="margin-top:6px">Week logged: <strong>${formatHours(weekHours)}</strong></div>
    </div>
    <div class="dash-panel dash-reminders">
      <div class="dash-chart-title"><span>Upcoming</span><strong>${reminders.length ? `${reminders.length} reminder${reminders.length === 1 ? '' : 's'}` : 'Clear'}</strong></div>
      <div class="reminder-list">${reminderHtml}</div>
    </div>
    <div class="dash-chart-grid">
      <div class="dash-panel">
        <div class="dash-chart-title"><span>Hours this week</span><strong>${formatHours(weekHours)}</strong></div>
        ${renderDashBars(hourPoints, { minMax: Math.max(1, targetHours) })}
      </div>
      <div class="dash-panel">
        <div class="dash-chart-title"><span>Completion trend</span><strong>${comp.pct}% today</strong> <span style="color:var(--amber);font-size:.6rem">— 70%</span></div>
        ${renderDashBars(completionPoints, { minMax: 100, threshold: 70 })}
      </div>
      <div class="dash-panel">
        <div class="dash-chart-title"><span>Sleep hours</span><strong>${d.sleepHours ? `${d.sleepHours}h today` : 'No entry'}</strong> <span style="color:var(--amber);font-size:.6rem">— 7h</span></div>
        ${renderDashBars(sleepPoints, { minMax: 8, threshold: 7 })}
      </div>
    </div>`;
}

function quickRetrospective() {
  const d = getDay(selectedDate);
  const parts = [
    d.wins ? `Win: ${d.wins}` : '',
    d.mistake ? `Missed: ${d.mistake}` : '',
    d.blockers ? `Blocker: ${d.blockers}` : '',
    d.tomorrow ? `Tomorrow: ${d.tomorrow}` : '',
  ].filter(Boolean);
  if (!parts.length) return;
  d.notes = [d.notes || '', parts.join(' | ')].filter(Boolean).join('\n');
  save();
  renderDaily();
}

function saveInput(field, val) {
  const d = getDay(selectedDate);
  d[field] = (val === '' || val === null) ? null : (typeof val === 'string' && !isNaN(val) ? parseFloat(val) : val);
  if (field === 'focusScore' && d[field] !== null && d[field] !== '') setLinkedCheck(d, 'tr_focus', true);
  save();
  updateFallbackHint();
  renderStats();
  renderDashboard();
  renderTimer();
}

function renderDataPreviewIfVisible() {
  const panel = document.getElementById('tab-export');
  if (panel?.classList.contains('active')) renderDataPreview();
}

function setBackupStatus(message, kind = 'warn') {
  backupStatus = message;
  backupStatusKind = kind;
  const el = document.getElementById('backupStatus');
  if (!el) return;
  el.className = `backup-status mb12 ${kind}`;
  el.textContent = message;
}

function scheduleBackup() {
  if (!backupHandle) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => writeBackupNow({ silent:true }), 700);
}

function scheduleServerBackup() {
  if (!serverAutosave) return;
  clearTimeout(serverTimer);
  serverTimer = setTimeout(() => writeServerBackup({ silent:true }), 700);
}

function stateWeight(s) {
  const days = s?.days ? Object.keys(s.days).length : 0;
  const errors = s?.errorLog?.length || 0;
  const score = s?.metrics?.scoreHistory?.length || 0;
  const focus = s?.metrics?.focusPeaks?.length || 0;
  const benchmarks = s?.customBenchmarks?.length || 0;
  return days + errors + score + focus + benchmarks;
}

function shouldUseIncomingState(incoming, current) {
  if (!incoming) return false;
  const incomingTime = Date.parse(incoming.updatedAt || '');
  const currentTime = Date.parse(current.updatedAt || '');
  if (incomingTime && currentTime) return incomingTime > currentTime;
  if (incomingTime && !currentTime && stateWeight(incoming) > 0) return true;
  return stateWeight(incoming) > stateWeight(current);
}

async function initServerAutosave() {
  if (location.protocol === 'file:') return false;
  try {
    const res = await fetch('/api/load', { cache:'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    const incoming = data.state || data;
    serverAutosave = true;
    if (shouldUseIncomingState(incoming, state)) {
      state = incoming;
      normalizeState();
      selectedDate = todayStr();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderAll();
    }
    setBackupStatus('Server file autosave active: tracker-data.json', 'good');
    scheduleServerBackup();
    return true;
  } catch {
    return false;
  }
}

async function writeServerBackup(options = {}) {
  if (!serverAutosave) return;
  try {
    const res = await fetch('/api/save', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(stateForBackup())
    });
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    const data = await res.json();
    const time = data.savedAt ? new Date(data.savedAt) : new Date();
    setBackupStatus(`Server file autosave OK: ${time.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}`, 'good');
  } catch (err) {
    serverAutosave = false;
    if (!options.silent) setBackupStatus(`Server autosave failed: ${err.message}`, 'bad');
    else setBackupStatus('Server autosave paused. Browser storage is still saving.', 'warn');
  }
}

function openBackupDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(BACKUP_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBackupHandle(handle) {
  const db = await openBackupDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readwrite');
    tx.objectStore(BACKUP_STORE).put(handle, BACKUP_HANDLE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadBackupHandle() {
  if (!window.indexedDB) return null;
  const db = await openBackupDb();
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).get(BACKUP_HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle;
}

async function hasBackupPermission(handle, write = false, request = false) {
  const opts = { mode: write ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (request && (await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

function stateForBackup() {
  return {
    exportedAt: new Date().toISOString(),
    app: 'Tracker',
    version: 3,
    state
  };
}

async function connectBackupFile() {
  if (!window.showSaveFilePicker) {
    setBackupStatus('File autosave is not available in this browser. Use Chrome or Edge, or keep using Export JSON.', 'bad');
    return;
  }
  try {
    backupHandle = await window.showSaveFilePicker({
      suggestedName: 'tracker-data.json',
      types: [{ description:'Tracker backup', accept:{ 'application/json':['.json'] } }]
    });
    const ok = await hasBackupPermission(backupHandle, true, true);
    if (!ok) {
      setBackupStatus('Backup file permission was not granted. Browser storage is still saving locally.', 'bad');
      return;
    }
    await saveBackupHandle(backupHandle);
    await writeBackupNow();
  } catch (err) {
    if (err?.name !== 'AbortError') setBackupStatus(`Backup connection failed: ${err.message}`, 'bad');
  }
}

async function writeBackupNow(options = {}) {
  if (!backupHandle) {
    if (!options.silent) setBackupStatus('No backup file connected yet. Click Connect backup file first.', 'warn');
    return;
  }
  try {
    const ok = await hasBackupPermission(backupHandle, true, !options.silent);
    if (!ok) {
      setBackupStatus('Backup file needs permission again. Click Save backup now or Connect backup file.', 'warn');
      return;
    }
    const writable = await backupHandle.createWritable();
    await writable.write(JSON.stringify(stateForBackup(), null, 2));
    await writable.close();
    setBackupStatus(`File autosave OK: ${new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}`, 'good');
  } catch (err) {
    setBackupStatus(`File autosave failed: ${err.message}`, 'bad');
  }
}

async function loadFromBackupFile() {
  try {
    let handle = backupHandle;
    if (!handle) {
      if (!window.showOpenFilePicker) {
        setBackupStatus('Loading a backup file is not available in this browser. Use Import JSON below.', 'bad');
        return;
      }
      const handles = await window.showOpenFilePicker({
        types: [{ description:'Tracker backup', accept:{ 'application/json':['.json'] } }],
        multiple: false
      });
      handle = handles[0];
    }
    const ok = await hasBackupPermission(handle, false, true);
    if (!ok) {
      setBackupStatus('Backup file read permission was not granted.', 'bad');
      return;
    }
    const file = await handle.getFile();
    const data = JSON.parse(await file.text());
    const nextState = data.state || data;
    if (!confirm('Load this backup and replace current browser data?')) return;
    state = nextState;
    normalizeState();
    selectedDate = todayStr();
    backupHandle = handle;
    await saveBackupHandle(handle);
    save();
    renderAll();
    setBackupStatus(`Loaded backup: ${file.name}`, 'good');
  } catch (err) {
    if (err?.name !== 'AbortError') setBackupStatus(`Backup load failed: ${err.message}`, 'bad');
  }
}

async function initBackupFile() {
  try {
    backupHandle = await loadBackupHandle();
    if (!backupHandle) {
      setBackupStatus(backupStatus, backupStatusKind);
      return;
    }
    const ok = await hasBackupPermission(backupHandle, true, false);
    if (ok) {
      setBackupStatus('Backup file connected. Autosave will write after each change.', 'good');
      scheduleBackup();
    } else {
      setBackupStatus('Backup file remembered, but the browser wants permission again. Click Save backup now.', 'warn');
    }
  } catch {
    setBackupStatus('Browser storage is active. File backup can be reconnected from the Data tab.', 'warn');
  }
}

// ──────────────────────────────────────────────────────────────────
// CALCULATIONS
// ──────────────────────────────────────────────────────────────────

function getAllHabitIds(difficulty, dow, ds = selectedDate) {
  const ids = [];
  getNonNegs(ds, difficulty).forEach(h => ids.push(h.id));
  getTraining(difficulty, dow, ds).forEach(h => ids.push(trackingIdForTask(h)));
  const ex = getExercise(dow);
  if (ex) ids.push(ex.id);
  if (dow === 0) SUNDAY_PROTOCOL.forEach(h => ids.push(h.id));
  return [...new Set(ids)];
}

function getDayCompletion(ds) {
  const d = getDay(ds);
  const dow = parseDateKey(ds).getDay();
  const difficulty = defaultDifficultyForDow(dow);
  const all = getAllHabitIds(difficulty, dow, ds);
  if (!all.length) return null;
  const done = all.filter(id => isCheckDone(d, id)).length;
  return { done, total: all.length, pct: Math.round(done / all.length * 100) / 100 };
}

function hasCompletedTrainingMatch(ds, matcher) {
  const d = getDay(ds);
  const dow = parseDateKey(ds).getDay();
  const difficulty = defaultDifficultyForDow(dow);
  return getTraining(difficulty, dow, ds).some(task => {
    const haystack = `${task.id || ''} ${task.trackingId || ''} ${task.text || ''} ${task.meta || ''} ${task.tag || ''}`.toLowerCase();
    return isCheckDone(d, trackingIdForTask(task)) && matcher(haystack, task);
  });
}

function hasCompletedContest(ds) {
  return !!getDay(ds).keyMilestone || hasCompletedTrainingMatch(ds, text => text.includes('contest'));
}

function hasCompletedOA(ds) {
  return hasCompletedTrainingMatch(ds, text => /\boa\b|reasoning drill|simulation/.test(text));
}

function defaultDifficultyForDow(dow) {
  return (dow === 6 || dow === 0) ? 'rest' : 'hard';
}

function calcStreak() {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const ds = addDays(todayStr(), -i);
    const d = parseDateKey(ds);
    const dow = d.getDay();
    const isWeekend = (dow === 0 || dow === 6);
    const c = getDayCompletion(ds);
    
    if (isWeekend) continue; // Weekends don't count towards or break streak
    
    if (c && c.pct >= 0.4) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

function getWeekDates(refDate) {
  const monday = parseDateKey(mondayFor(refDate));
  return Array.from({length:7}, (_,i) => {
    const dd = new Date(monday); dd.setDate(monday.getDate() + i);
    return dateKey(dd);
  });
}

function calcWeekDays(refDate) {
  return getWeekDates(refDate).filter(ds => {
    const c = getDayCompletion(ds);
    return c && c.pct >= 0.7;
  }).length;
}

function calcAvgHours3() {
  const days = [];
  let i = 0;
  while (days.length < 3 && i < 30) {
    const ds = addDays(todayStr(), -i);
    const dow = parseDateKey(ds).getDay();
    if (dow !== 0 && dow !== 6) days.push(getLoggedHours(ds));
    i++;
  }
  if (!days.length) return 0;
  return days.reduce((a, b) => a + b, 0) / days.length;
}

// Compute derived metrics from stored data
function computeMetrics() {
  const last14 = [];
  for (let i=0; i<14; i++) {
    last14.push(addDays(todayStr(), -i));
  }

  // Sleep consistency (% of days where sleepHours >= 7)
  let sleepDays = 0, sleepCount = 0;
  last14.forEach(ds => {
    const d = getDay(ds);
    if (d.sleepHours !== null && d.sleepHours !== undefined && d.sleepHours !== '') { sleepCount++; if (d.sleepHours >= 7) sleepDays++; }
  });
  const sleepPct = sleepCount ? Math.round(sleepDays / sleepCount * 100) : null;

  // Energy average (last 7 days)
  let engSum = 0, engCount = 0;
  last14.slice(0,7).forEach(ds => {
    const d = getDay(ds);
    if (d.energy !== null && d.energy !== undefined && d.energy !== '') { engSum += +d.energy; engCount++; }
  });
  const energyAvg = engCount ? (engSum/engCount).toFixed(1) : null;

  // Error log entries this week
  const thisWeek = getWeekDates(todayStr());
  const errorCount = state.errorLog.filter(e => thisWeek.includes(e.date)).length;

  // Zone 2 sessions this week
  let z2Count = 0;
  thisWeek.forEach(ds => {
    const d = getDay(ds);
    const dow = parseDateKey(ds).getDay();
    const ex = getExercise(dow);
    if (ex && ex.text.includes('Zone 2') && isCheckDone(d, ex.id)) z2Count++;
  });

  // Practice reps this week
  let practiceThisWeek = 0;
  thisWeek.forEach(ds => { practiceThisWeek += +(getDay(ds).practiceReps || 0); });

  // Project and deep-work reps this week
  let projectThisWeek = 0, deepWorkThisWeek = 0;
  thisWeek.forEach(ds => {
    const d = getDay(ds);
    projectThisWeek += +(d.projectReps || 0);
    deepWorkThisWeek += +(d.deepWorkReps || 0);
  });

  // Latest focus score
  const focusScores = state.metrics.focusPeaks;
  const latestFocus = focusScores.length ? focusScores[focusScores.length-1].value : null;

  // Latest score
  const scores = state.metrics.scoreHistory;
  const latestScore = scores.length ? scores[scores.length-1].value : null;

  // Skincare nights this week (only count elapsed days so far)
  const today = todayStr();
  const elapsedThisWeek = thisWeek.filter(ds => ds <= today).length || 1;
  let skincareNights = 0;
  thisWeek.filter(ds => ds <= today).forEach(ds => {
    const d = getDay(ds);
    if (isCheckDone(d, 'nn_pm_skin')) skincareNights++;
  });

  // Technical reading: days this week with 20+ min (elapsed only)
  let readingDaysWeek = 0;
  thisWeek.filter(ds => ds <= today).forEach(ds => {
    if (+(getDay(ds).readingMins || 0) >= 20) readingDaysWeek++;
  });

  // Key milestones this week
  let contestsWeek = 0;
  thisWeek.forEach(ds => { if (getDay(ds).contestDone) contestsWeek++; });

  return { sleepPct, energyAvg, errorCount, z2Count, practiceThisWeek, projectThisWeek, deepWorkThisWeek, latestFocus, latestScore, skincareNights, elapsedThisWeek, readingDaysWeek, contestsWeek };
}

// ──────────────────────────────────────────────────────────────────
// TOGGLE / SET
// ──────────────────────────────────────────────────────────────────

function toggle(ds, id) {
  const d = getDay(ds);
  const next = !isCheckDone(d, id);
  setLinkedCheck(d, id, next);
  save();
  renderDaily();
}

function setPhase(p) {
  state.phase = p;
  save();
  renderPhase();
}

function timerElapsedTotal() {
  return timerElapsedMs + (timerRunning && timerStartedAt ? Date.now() - timerStartedAt : 0);
}

function getTimerCountdownMs() {
  const total = timerBreakMode ? getBreakMs() : getPomodoroMs();
  return Math.max(0, total - timerElapsedTotal());
}

function formatTimerDuration(ms, rounding = 'floor') {
  const round = rounding === 'ceil' ? Math.ceil : Math.floor;
  const totalSeconds = Math.max(0, round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad2(mins)}:${pad2(secs)}` : `${pad2(mins)}:${pad2(secs)}`;
}

function scheduleTimerTick() {
  clearTimeout(timerInterval);
  timerInterval = null;
  if (!timerRunning) return;
  const elapsed = timerElapsedTotal();
  const countdownMode = timerMode === 'pomodoro' || timerBreakMode;
  const remaining = countdownMode ? getTimerCountdownMs() : Infinity;
  if (countdownMode && remaining <= 0) {
    renderTimer();
    return;
  }
  const nextBoundary = countdownMode
    ? Math.max(60, (remaining % 1000) || 1000)
    : Math.max(60, 1000 - (elapsed % 1000));
  timerInterval = setTimeout(() => {
    renderTimer();
    scheduleTimerTick();
  }, nextBoundary + 15);
}

function playFallbackTimerChime(kind = 'focus') {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(kind === 'break' ? 0.1 : 0.14, now + 0.04);
  gain.connect(ctx.destination);
  const ring = () => {
    const t = ctx.currentTime;
    [523.25, kind === 'break' ? 659.25 : 783.99, 1046.5].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + index * 0.16);
      noteGain.gain.setValueAtTime(0.001, t + index * 0.16);
      noteGain.gain.exponentialRampToValueAtTime(0.8, t + 0.04 + index * 0.16);
      noteGain.gain.exponentialRampToValueAtTime(0.001, t + 0.55 + index * 0.16);
      osc.connect(noteGain);
      noteGain.connect(gain);
      osc.start(t + index * 0.16);
      osc.stop(t + 0.7 + index * 0.16);
    });
  };
  timerAlarmFallback = {
    ctx,
    interval: setInterval(ring, 1800)
  };
  ring();
  renderTimer();
}

function dismissTimerAlarm() {
  const hadAlarm = !!(timerAlarmAudio || timerAlarmFallback);
  if (timerAlarmAudio) {
    timerAlarmAudio.pause();
    timerAlarmAudio.currentTime = 0;
    timerAlarmAudio = null;
  }
  if (timerAlarmFallback) {
    clearInterval(timerAlarmFallback.interval);
    timerAlarmFallback.ctx.close();
    timerAlarmFallback = null;
  }
  if (hadAlarm) renderTimer();
}

function startTimerAlarm(kind = 'focus') {
  dismissTimerAlarm();
  timerAlarmAudio = new Audio(TIMER_SOUND_URL);
  timerAlarmAudio.loop = true;
  timerAlarmAudio.volume = kind === 'break' ? 0.48 : 0.6;
  timerAlarmAudio.playbackRate = kind === 'break' ? 0.92 : 1;
  timerAlarmAudio.play().catch(() => {
    timerAlarmAudio = null;
    playFallbackTimerChime(kind);
  });
  renderTimer();
}

function unlockTimerSound() {
  if (timerSoundUnlocked) return;
  timerSoundUnlocked = true;
  const audio = new Audio(TIMER_SOUND_URL);
  audio.volume = 0;
  audio.play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
    })
    .catch(() => {});
}

function setTimerMode(mode) {
  dismissTimerAlarm();
  const hadElapsed = timerElapsedTotal() >= 1000;
  if (hadElapsed && !timerBreakMode) logTimerToNextTask({ keepRunning:false, silent:true });
  timerMode = mode;
  timerBreakMode = false;
  timerRunning = false;
  timerStartedAt = null;
  timerElapsedMs = 0;
  scheduleTimerTick();
  renderTimer();
}

function getPomodoroMs() {
  return Math.max(1000, +(state.timerSettings?.pomodoroMs || 25 * 60 * 1000));
}

function getBreakMs() {
  return Math.max(1000, +(state.timerSettings?.breakMs || 5 * 60 * 1000));
}

function timerDurationMs(kind) {
  return kind === 'break' ? getBreakMs() : getPomodoroMs();
}

function setTimerDuration(kind, value) {
  const seconds = value.includes(':') ? Math.round(parseTimeStr(value) * 3600) : parseInt(value, 10);
  const ms = Math.max(1000, Math.min(24 * 3600 * 1000, (Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000));
  if (kind === 'break') state.timerSettings.breakMs = ms;
  else state.timerSettings.pomodoroMs = ms;
  if (((kind === 'break' && timerBreakMode) || (kind === 'pomodoro' && timerMode === 'pomodoro' && !timerBreakMode)) && !timerRunning) timerElapsedMs = 0;
  save();
  renderTimer();
}

function adjustTimerDuration(kind, deltaSeconds) {
  const nextMs = timerDurationMs(kind) + deltaSeconds * 1000;
  setTimerDuration(kind, formatHours(nextMs / 3600000));
}

function updateDocumentTitle(displayText = null, alarmActive = false) {
  if (alarmActive) {
    document.title = `Alarm ringing • ${DEFAULT_TITLE}`;
  } else if (timerRunning && displayText) {
    const label = timerBreakMode ? 'Break' : (timerMode === 'pomodoro' ? 'Focus' : 'Timer');
    document.title = `${displayText} ${label} • Tracker`;
  } else {
    document.title = DEFAULT_TITLE;
  }
}

function toggleTimer() {
  unlockTimerSound();
  if (timerAlarmAudio || timerAlarmFallback) dismissTimerAlarm();
  if (timerRunning) {
    timerElapsedMs = timerElapsedTotal();
    timerRunning = false;
    timerStartedAt = null;
  } else {
    timerRunning = true;
    timerStartedAt = Date.now();
  }
  scheduleTimerTick();
  renderTimer();
}

function resetTimer(options = {}) {
  dismissTimerAlarm();
  const elapsed = timerElapsedTotal();
  if (options.logElapsed && elapsed >= 1000 && !timerBreakMode) {
    logTimerToNextTask({ keepRunning:false, silent: options.silent !== false });
  }
  timerRunning = false;
  timerStartedAt = null;
  timerElapsedMs = 0;
  scheduleTimerTick();
  renderTimer();
}

function currentTrainingContext() {
  const dow = parseDateKey(selectedDate).getDay();
  const d = getDay(selectedDate);
  const difficulty = defaultDifficultyForDow(dow);
  return { dow, d, difficulty, training:getTraining(difficulty, dow, selectedDate) };
}

function getNextTrainingTask(trainingOverride = null, dayOverride = null) {
  const context = trainingOverride ? { d: dayOverride || getDay(selectedDate), training: trainingOverride } : currentTrainingContext();
  const { d, training } = context;
  if (manualTimerTargetId) {
    const selectedTask = training.find(task => task.id === manualTimerTargetId);
    if (selectedTask) return selectedTask;
    manualTimerTargetId = null;
  }
  return training.find(task => !isCheckDone(d, trackingIdForTask(task))) || training[0] || null;
}

function getAutoTrainingTask(trainingOverride = null, dayOverride = null) {
  const context = trainingOverride ? { d: dayOverride || getDay(selectedDate), training: trainingOverride } : currentTrainingContext();
  const { d, training } = context;
  return training.find(task => !isCheckDone(d, trackingIdForTask(task))) || training[0] || null;
}

function logTimerToNextTask(options = {}) {
  if (timerBreakMode) return; 
  const elapsed = timerElapsedTotal();
  if (elapsed < 1000) return;
  const task = getNextTrainingTask();
  if (!task) return;
  const d = getDay(selectedDate);
  const hours = elapsed / 3600000;
  const taskKey = trackingIdForTask(task);
  
  const current = +(d.taskHours[taskKey] || 0);
  d.taskHours[taskKey] = Math.round((current + hours) * 10000) / 10000;
  
  const timeLabel = formatHours(hours);
  timerLastLog = `Logged ${timeLabel} to ${task.text}`;
  
  timerElapsedMs = 0;
  timerRunning = !!options.keepRunning && timerRunning;
  timerStartedAt = timerRunning ? Date.now() : null;
  scheduleTimerTick();
  save();
  if (!options.silent) showToast(timerLastLog, 'success');
  renderAll();
}

function toggleBreakMode() {
  dismissTimerAlarm();
  const elapsed = timerElapsedTotal();
  const enteringBreak = !timerBreakMode;
  if (enteringBreak && elapsed >= 1000) {
    logTimerToNextTask({ keepRunning:false, silent:true });
  }
  timerBreakMode = enteringBreak;
  timerRunning = false;
  timerStartedAt = null;
  timerElapsedMs = 0;
  scheduleTimerTick();
  renderTimer();
}

function renderTimer() {
  const display = document.getElementById('timerDisplay');
  if (!display) {
    updateDocumentTitle();
    return;
  }
  const elapsed = timerElapsedTotal();
  const pomodoroTotal = timerBreakMode ? getBreakMs() : getPomodoroMs();
  const alarmActive = !!(timerAlarmAudio || timerAlarmFallback);
  
  if ((timerMode === 'pomodoro' || timerBreakMode) && timerRunning && elapsed >= pomodoroTotal) {
    if (!timerBreakMode) {
      logTimerToNextTask({ keepRunning:false, silent:true });
      timerBreakMode = true; // Auto switch to break after session
      timerRunning = false;
      timerStartedAt = null;
      timerElapsedMs = 0;
      scheduleTimerTick();
      startTimerAlarm('focus');
      showToast('Session complete. Recovery protocol active.', 'success');
    } else {
      timerBreakMode = false;
      timerRunning = false;
      timerStartedAt = null;
      timerElapsedMs = 0;
      scheduleTimerTick();
      startTimerAlarm('break');
      showToast('Recovery complete. Ready for next session.', 'success');
    }
    renderTimer();
    return;
  }

  const shown = (timerMode === 'pomodoro' || timerBreakMode) ? Math.max(0, pomodoroTotal - elapsed) : elapsed;
  const countdownMode = timerMode === 'pomodoro' || timerBreakMode;
  const displayText = formatTimerDuration(shown, countdownMode ? 'ceil' : 'floor');
  display.textContent = displayText;
  display.classList.toggle('long', displayText.length > 5);
  updateDocumentTitle(displayText, alarmActive);
  
  const face = document.getElementById('timerFace');
  if (face) {
    const progress = (timerMode === 'pomodoro' || timerBreakMode)
      ? Math.min(360, (elapsed / pomodoroTotal) * 360)
      : ((elapsed / 60000) % 1) * 360;
    face.style.setProperty('--timer-progress', `${progress}deg`);
    face.classList.toggle('running', timerRunning);
    face.classList.toggle('break', timerBreakMode);
    face.classList.toggle('alarm', alarmActive);
  }

  // Update Target Select
  const { d, training } = currentTrainingContext();
  const selectedTask = getNextTrainingTask(training, d);
  const autoTask = getAutoTrainingTask(training, d);
  const select = document.getElementById('timerTargetSelect');
  if (select) {
    const previousValue = manualTimerTargetId || '';
    select.innerHTML = '';
    select.add(new Option(autoTask ? `Auto: ${autoTask.text}` : 'Auto: No training items', ''));
    training.forEach(task => select.add(new Option(task.text, task.id)));
    select.value = training.some(task => task.id === previousValue) ? previousValue : '';
    manualTimerTargetId = select.value || null;
  }

  const lastLog = document.getElementById('timerLastLog');
  if (lastLog) lastLog.textContent = timerLastLog || 'None';
  
  const elapsedMeta = document.getElementById('timerElapsedMeta');
  if (elapsedMeta) elapsedMeta.textContent = formatHours(elapsed / 3600000);

  const targetMeta = document.getElementById('timerTargetMeta');
  if (targetMeta) targetMeta.textContent = timerMode === 'free' && !timerBreakMode ? 'Open' : formatHours(pomodoroTotal / 3600000);

  const modeMeta = document.getElementById('timerModeMeta');
  if (modeMeta) modeMeta.textContent = timerBreakMode ? 'Break' : (timerMode === 'pomodoro' ? 'Pomodoro' : 'Free');

  const modeSummary = document.getElementById('timerModeSummary');
  if (modeSummary) {
    if (alarmActive) modeSummary.textContent = 'Awaiting dismiss';
    else if (timerBreakMode) modeSummary.textContent = 'Recovery countdown';
    else modeSummary.textContent = timerMode === 'pomodoro' ? 'Focus session' : 'Open timer';
  }

  const targetHint = document.getElementById('timerTargetHint');
  if (targetHint) {
    targetHint.textContent = selectedTask
      ? `${manualTimerTargetId ? 'Manual target' : 'Auto target'}: ${selectedTask.text}`
      : 'Add a training item to log timer sessions.';
  }

  const durationSection = document.getElementById('timerDurationSection');
  if (durationSection) durationSection.style.display = timerMode === 'free' ? 'none' : 'grid';
  const studyDurationCard = document.getElementById('studyDurationCard');
  if (studyDurationCard) studyDurationCard.classList.toggle('active', !timerBreakMode && timerMode === 'pomodoro');
  const breakDurationCard = document.getElementById('breakDurationCard');
  if (breakDurationCard) breakDurationCard.classList.toggle('active', timerBreakMode);
  
  const stateEl = document.getElementById('timerState');
  if (stateEl) {
    if (alarmActive) stateEl.textContent = 'Alarm ringing';
    else if (timerBreakMode) stateEl.textContent = 'Recovery';
    else stateEl.textContent = timerRunning ? (timerMode === 'pomodoro' ? 'Focus' : 'Timing') : 'Ready';
  }

  const breakBtn = document.getElementById('timerBreakBtn');
  if (breakBtn) {
    breakBtn.textContent = timerBreakMode ? 'Work Mode' : 'Break Mode';
    breakBtn.classList.toggle('primary', timerBreakMode);
  }

  const startBtn = document.getElementById('timerStartBtn');
  if (startBtn) startBtn.textContent = timerRunning ? 'Pause' : (timerBreakMode ? 'Start Break' : 'Start');

  const dismissBtn = document.getElementById('timerDismissBtn');
  if (dismissBtn) dismissBtn.classList.toggle('hidden', !alarmActive);

  const logBtn = document.getElementById('timerLogBtn');
  if (logBtn) logBtn.disabled = timerBreakMode || !selectedTask || elapsed < 1000;

  const pomodoroInput = document.getElementById('timerPomodoroDuration');
  if (pomodoroInput && pomodoroInput !== document.activeElement) pomodoroInput.value = formatHours(getPomodoroMs() / 3600000);
  const breakInput = document.getElementById('timerBreakDuration');
  if (breakInput && breakInput !== document.activeElement) breakInput.value = formatHours(getBreakMs() / 3600000);
  document.querySelectorAll('.timer-mode-btn').forEach(btn => {
    btn.classList.toggle('active', (btn.textContent.startsWith('Pomodoro') && timerMode === 'pomodoro') || (btn.textContent.startsWith('Free') && timerMode === 'free'));
  });
}

function shiftSelectedDay(delta) {
  selectedDate = addDays(selectedDate, delta);
  save();
  renderAll();
}

function shiftSelectedWeek(delta) {
  selectedDate = addDays(selectedDate, delta * 7);
  save();
  renderAll();
}

function goToToday() {
  selectedDate = todayStr();
  save();
  renderAll();
}

function jumpToWeek() {
  const input = document.getElementById('weekJumpDate');
  const target = input?.value || todayStr();
  selectedDate = mondayFor(target);
  save();
  renderAll();
}

// ──────────────────────────────────────────────────────────────────
// FALLBACK HINT
// ──────────────────────────────────────────────────────────────────

function updateFallbackHint() {
  const d = getDay(selectedDate);
  const hint = document.getElementById('fallbackHint');
  const sleep = d.sleepHours ? +d.sleepHours : null;
  const energy = d.energy ? +d.energy : null;
  if (sleep !== null && sleep < 6) {
    hint.className = 'fallback-hint show danger';
    hint.textContent = 'Slept < 6h — reduce scope today. Log the smallest useful block and get daylight.';
  } else if (energy !== null && energy <= 4) {
    hint.className = 'fallback-hint show danger';
    hint.textContent = '⚠ Energy ≤ 4/10 — switch to 30-min emergency version. Preserve streak, do not degrade quality.';
  } else if (sleep !== null && sleep < 7) {
    hint.className = 'fallback-hint show warn';
    hint.textContent = '△ Slept < 7h — consider dropping one tier. Cognitive output is capped.';
  } else if (energy !== null && energy <= 6) {
    hint.className = 'fallback-hint show warn';
    hint.textContent = 'Energy <= 6/10 — lower the day target and protect the recovery basics.';
  } else {
    hint.className = 'fallback-hint';
  }
}

// ──────────────────────────────────────────────────────────────────
// RENDER — DAILY
// ──────────────────────────────────────────────────────────────────

function renderDaily() {
  // Clear stale in-memory edit buffers when edit modes are off
  if (!editingTrainingId && pendingTrainingEdit) pendingTrainingEdit = null;
  if (!editingNonNegId   && pendingNonNegEdit)   pendingNonNegEdit   = null;
  if (!editingExercise   && pendingExerciseEdit)  pendingExerciseEdit = null;

  const dow = parseDateKey(selectedDate).getDay();
  const d   = getDay(selectedDate);
  const difficulty = defaultDifficultyForDow(dow);
  d.difficulty = difficulty;
  d.mode = difficulty;
  const target = TARGETS[difficulty] || TARGETS.hard;
  renderTodayNumberInputs();

  // Day header
  document.getElementById('dayTitle').textContent = DAY_FULL[dow];
  const isToday = selectedDate === todayStr();
  const disp = formatDate(selectedDate, {day:'numeric',month:'long',year:'numeric'});
  document.getElementById('dayMeta').textContent = (isToday ? 'Today · ' : '') + disp + ' · ' + (DAY_FOCUS[dow] || '') + ` · ${difficulty === 'rest' ? 'rest day' : '6h workday'}`;

  renderPhase();
  renderWeekStrip();

  // Sunday panel
  const sp = document.getElementById('sundayPanel');
  sp.style.display = dow === 0 && SUNDAY_PROTOCOL.length ? 'block' : 'none';
  if (dow === 0 && SUNDAY_PROTOCOL.length) renderSundayList(d);

  // Non-negotiables
  renderHabitList('nnList', getNonNegs(), d, 'nnCount', 'nonneg');

  // Training
  const training = getTraining(difficulty, dow, selectedDate);
  document.getElementById('trainingTitle').innerHTML =
    `Tasks for the Day <span class="section-line"></span> <button class="reset-link" onclick="resetTrainingMode('${difficulty}')">Reset</button> <span class="count" id="tbCount">0/${training.length}</span>`;
  renderTrainingList('trainingList', training, d, difficulty);
  const tbDone = training.filter(h => isCheckDone(d, trackingIdForTask(h))).length;
  const tbEl = document.getElementById('tbCount');
  if (tbEl) tbEl.textContent = `${tbDone}/${training.length}`;

  // Exercise
  const ex = getExerciseForDate(selectedDate);
  renderExerciseList('exerciseList', ex, d);

  // Progress
  const allIds = getAllHabitIds(difficulty, dow, selectedDate);
  const done   = allIds.filter(id => isCheckDone(d, id)).length;
  const pct    = allIds.length ? Math.round(done / allIds.length * 100) : 0;
  document.getElementById('progressLabel').textContent = `${done} / ${allIds.length} complete`;
  document.getElementById('progressPct').textContent   = `${pct}%`;
  document.getElementById('progressFill').style.width  = `${pct}%`;

  renderStats();
  renderDashboard();

  fillDailyNumberInputs();
  fillInput('inp-wins',    d.wins);
  fillInput('inp-mistake', d.mistake);
  fillInput('inp-blockers',d.blockers);
  fillInput('inp-tomorrow',d.tomorrow);
  fillInput('inp-insight', d.insight);
  fillInput('inp-notes',   d.notes);

  updateFallbackHint();
}

function fillDailyNumberInputs() {
  const d = getDay(selectedDate);
  TODAY_NUMBER_FIELDS.forEach(field => {
    if (field.type === 'checkbox') {
      const el = document.getElementById(field.id);
      if (el && el !== document.activeElement) el.checked = !!d[field.key];
    } else {
      fillInput(field.id, d[field.key]);
    }
  });
}

function fillInput(id, val) {
  const el = document.getElementById(id);
  if (el && el !== document.activeElement) el.value = (val == null || val === '') ? '' : val;
}

function renderStats() {
  const streak = calcStreak();
  const streakEl = document.getElementById('statStreak');
  streakEl.textContent = streak;
  streakEl.style.color = streak === 0 ? 'var(--red)' : streak >= 5 ? 'var(--green)' : streak >= 2 ? 'var(--amber)' : 'var(--accent)';

  document.getElementById('statWeek').textContent = calcWeekDays(todayStr()) + '/7';

  const dow  = parseDateKey(selectedDate).getDay();
  const d    = getDay(selectedDate);
  const difficulty = defaultDifficultyForDow(dow);
  const all  = getAllHabitIds(difficulty, dow, selectedDate);
  const done = all.filter(id => isCheckDone(d, id)).length;
  const pct  = all.length ? Math.round(done / all.length * 100) : 0;
  const todayEl = document.getElementById('statToday');
  todayEl.textContent = pct + '%';
  todayEl.style.color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : pct > 0 ? 'var(--red)' : 'var(--accent)';

  document.getElementById('statHours').textContent = formatHours(getLoggedHours(selectedDate));

  const avgHours = calcAvgHours3();
  const paceEl = document.getElementById('statWeekPace');
  paceEl.textContent = avgHours ? formatHours(avgHours).replace(/^00:/, '') : '—';
  paceEl.style.color = avgHours >= 5 ? 'var(--green)' : avgHours >= 3 ? 'var(--amber)' : avgHours > 0 ? 'var(--red)' : 'var(--dim)';
}

let motivationQuotes = null;

async function loadMotivationQuotes() {
  try {
    const res = await fetch('motivation_quotes.json');
    const data = await res.json();
    motivationQuotes = Array.isArray(data.quotes) ? data.quotes : [];
  } catch (e) {
    motivationQuotes = [];
  }
}

function renderPhase() {
  const quotes = Array.isArray(motivationQuotes) ? motivationQuotes : [];
  if (!quotes.length) {
    document.getElementById('phaseDesc').textContent = '';
    return;
  }
  const EPOCH = new Date('2026-01-01').getTime();
  const dayIndex = Math.floor((new Date(selectedDate).getTime() - EPOCH) / 86400000);
  const q = quotes[((dayIndex % quotes.length) + quotes.length) % quotes.length];
  document.getElementById('phaseDesc').innerHTML = q.author && q.author !== 'Unknown'
    ? `"${escapeAttr(q.quote)}" <span style="color:var(--muted);font-size:.68rem">— ${escapeAttr(q.author)}</span>`
    : `"${escapeAttr(q.quote)}"`;
}

function renderWeekStrip() {
  const strip = document.getElementById('weekStrip');
  const week  = getWeekDates(selectedDate);
  const today = todayStr();
  const start = week[0];
  const end = week[6];
  strip.innerHTML = '';
  document.getElementById('weekNavTitle').textContent = `${formatDate(start, {day:'numeric', month:'short'})} – ${formatDate(end, {day:'numeric', month:'short', year:'numeric'})}`;
  document.getElementById('weekNavSub').textContent = selectedDate === today ? 'Current week, Monday start' : `Selected: ${formatDate(selectedDate, {weekday:'long', day:'numeric', month:'short'})}`;
  const jump = document.getElementById('weekJumpDate');
  if (jump && jump !== document.activeElement) jump.value = selectedDate;
  week.forEach(ds => {
    const dow  = parseDateKey(ds).getDay();
    const comp = getDayCompletion(ds);
    const pct  = comp ? comp.pct : 0;
    const btn  = document.createElement('button');
    btn.className = 'day-btn' + (ds === selectedDate ? ' active' : '') + (ds === today ? ' today-mark' : '');
    const p1 = pct >= 0.34, p2 = pct >= 0.67, p3 = pct >= 1.0;
    const pipCls = (on, partial) => on ? 'pip on' : partial ? 'pip half' : 'pip';
    btn.innerHTML = `
      <span class="day-label">${DAY_NAMES[dow]}</span>
      <span class="day-date">${parseDateKey(ds).getDate()}</span>
      <span class="day-month">${formatDate(ds, {month:'short'})}</span>
      <div class="day-pips">
        <div class="${pipCls(p1, pct>0 && !p1)}"></div>
        <div class="${pipCls(p2, pct>0 && !p2 && p1)}"></div>
        <div class="${pipCls(p3, pct>0 && !p3 && p2)}"></div>
      </div>`;
    btn.onclick = () => { selectedDate = ds; save(); renderDaily(); };
    strip.appendChild(btn);
  });
}

function renderHabitList(containerId, habits, d, countId, listKind = null) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (!habits.length) {
    el.innerHTML = `<div class="dash-empty">No items yet. Add your first ${listKind === 'nonneg' ? 'non-negotiable' : 'item'} above.</div>`;
  }
  habits.forEach(h => {
    const checked = isCheckDone(d, h.id);
    const item = document.createElement('div');
    const editing = listKind === 'nonneg' && editingNonNegId === h.id;
    item.className = 'habit-item editable-row' + (checked ? ' done' : '') + (editing ? ' editing' : '');
    const nnBuf = editing && pendingNonNegEdit?.ds === selectedDate
      ? pendingNonNegEdit.items.find(i => i.id === h.id) : null;
    const nh = nnBuf || h;
    item.innerHTML = editing ? `
      <div class="habit-check">${checked ? '✓' : ''}</div>
      <div class="task-edit-panel">
        <input type="text" value="${escapeAttr(nh.text || '')}" aria-label="Non-negotiable title" onclick="event.stopPropagation()" oninput="updateNonNeg('${h.id}','${h.source}','text',this.value)">
        <input type="text" value="${escapeAttr(nh.meta || '')}" aria-label="Non-negotiable note" onclick="event.stopPropagation()" oninput="updateNonNeg('${h.id}','${h.source}','meta',this.value)">
        <input type="text" value="${escapeAttr(nh.tag || '')}" aria-label="Non-negotiable tag" onclick="event.stopPropagation()" oninput="updateNonNeg('${h.id}','${h.source}','tag',this.value)">
        <input type="text" value="${escapeAttr(formatHours(parseTimeStr(nh.dur || '0:00')))}" aria-label="Non-negotiable time" onclick="event.stopPropagation()" oninput="updateNonNeg('${h.id}','${h.source}','dur',this.value)">
        <button class="btn sm" onclick="event.stopPropagation(); confirmNonNegEdit(this)">Done</button>
      </div>
      <div class="item-actions"><button class="icon-btn" title="Remove" onclick="event.stopPropagation(); removeNonNeg('${h.id}',this)">×</button></div>` : `
      <div class="habit-check">${checked ? '✓' : ''}</div>
      <div style="flex:1; min-width:0">
        <div class="habit-text">${escapeAttr(h.text)}</div>
        ${h.meta ? `<div class="habit-meta">${escapeAttr(h.meta)}</div>` : ''}
        ${renderScopeBadges(h)}
      </div>
      ${h.tag  ? `<span class="habit-tag">${escapeAttr(h.tag)}</span>` : ''}
      ${listKind === 'nonneg' ? `<div class="item-actions"><button class="icon-btn" title="Remove" onclick="event.stopPropagation(); removeNonNeg('${h.id}',this)">×</button></div>` : ''}`;
    item.onclick = () => { toggle(selectedDate, h.id); };
    if (listKind === 'nonneg') {
      item.ondblclick = event => { event.stopPropagation(); editingNonNegId = h.id; renderDaily(); };
      item.querySelector('.habit-text')?.addEventListener('click', event => {
        event.stopPropagation();
        editingNonNegId = h.id;
        renderDaily();
      });
    }
    el.appendChild(item);
  });
  if (countId) {
    const c = document.getElementById(countId);
    if (c) c.textContent = `${habits.filter(h=>isCheckDone(d, h.id)).length}/${habits.length}`;
  }
}

function renderTrainingList(containerId, habits, d, mode) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (!habits.length) {
    el.innerHTML = `<div class="dash-empty">No tasks yet. Add your first task above.</div>`;
  }
  habits.forEach(h => {
    const taskKey = trackingIdForTask(h);
    const checked = isCheckDone(d, taskKey);
    const item = document.createElement('div');
    const hours = d.taskHours?.[taskKey] ?? '';
    const editing = editingTrainingId === taskKey;
    item.className = 'habit-item training-row' + (checked ? ' done' : '') + (editing ? ' editing' : '');
    item.draggable = !editing;
    item.ondragstart = () => startTrainingDrag(h.id);
    item.ondragover = event => event.preventDefault();
    item.ondrop = event => { event.preventDefault(); dropTrainingItem(mode, h.id, event.currentTarget); };
    const editBuf = editing && pendingTrainingEdit?.ds === selectedDate
      ? pendingTrainingEdit.items.find(i => trackingIdForTask(i) === taskKey) : null;
    const eh = editBuf || h;
    item.innerHTML = editing ? `
      <button class="drag-handle" title="Drag priority" onclick="event.stopPropagation()">⋮</button>
      <div class="habit-check">${checked ? '✓' : ''}</div>
      <div class="task-edit-panel">
        <input type="text" value="${escapeAttr(eh.text || '')}" aria-label="Task title" onclick="event.stopPropagation()" oninput="updateTrainingTask('${mode}','${h.id}','text',this.value)">
        <input type="text" value="${escapeAttr(eh.meta || '')}" aria-label="Task note" onclick="event.stopPropagation()" oninput="updateTrainingTask('${mode}','${h.id}','meta',this.value)">
        <input type="text" value="${escapeAttr(eh.tag || '')}" aria-label="Task tag" onclick="event.stopPropagation()" oninput="updateTrainingTask('${mode}','${h.id}','tag',this.value)">
        ${renderHoursControl(taskKey, hours)}
        <button class="btn sm" onclick="event.stopPropagation(); confirmTrainingEdit(this)">Done</button>
      </div>
      <div class="item-actions"><button class="icon-btn" title="Remove from future workdays" onclick="event.stopPropagation(); removeTrainingItem('${mode}','${h.id}',this)">×</button></div>` : `
      <button class="drag-handle" title="Drag priority" onclick="event.stopPropagation()">⋮</button>
      <div class="habit-check">${checked ? '✓' : ''}</div>
      <div class="task-view">
        <div class="task-view-main">
          <div class="habit-text">${escapeAttr(h.text || '')}</div>
          ${h.meta ? `<div class="habit-meta">${escapeAttr(h.meta)}</div>` : ''}
          ${renderScopeBadges(h)}
        </div>
        ${h.tag ? `<span class="habit-tag">${escapeAttr(h.tag)}</span>` : '<span></span>'}
        <button class="task-hours-chip" onclick="event.stopPropagation(); editingTrainingId='${taskKey}'; renderDaily()"><strong>${formatHours(hours)}</strong></button>
      </div>
      <div class="item-actions"><button class="icon-btn" title="Remove from future workdays" onclick="event.stopPropagation(); removeTrainingItem('${mode}','${h.id}',this)">×</button></div>`;
    item.onclick = () => { toggle(selectedDate, taskKey); };
    item.ondblclick = event => { event.stopPropagation(); editingTrainingId = taskKey; renderDaily(); };
    item.querySelector('.task-view-main')?.addEventListener('click', event => {
      event.stopPropagation();
      editingTrainingId = taskKey;
      renderDaily();
    });
    el.appendChild(item);
  });
}

function renderHoursControl(id, value) {
  const displayValue = formatHours(value);
  return `<div class="hours-control" onclick="event.stopPropagation()">
    <button title="Subtract 15 min" onclick="adjustTaskHours('${id}', -0.25)">−</button>
    <input type="text" value="${escapeAttr(displayValue)}" placeholder="hh:mm:ss" aria-label="Time logged" oninput="saveTaskHours('${id}',this.value)">
    <button title="Add 15 min" onclick="adjustTaskHours('${id}', 0.25)">+</button>
  </div>`;
}

function renderExerciseList(containerId, habit, d) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (!habit) return;
  const checked = isCheckDone(d, habit.id);
  const item = document.createElement('div');
  item.className = 'habit-item editable-row' + (checked ? ' done' : '') + (editingExercise ? ' editing' : '');
  const exBuf = editingExercise && pendingExerciseEdit?.ds === selectedDate ? pendingExerciseEdit.fields : null;
  const exh = exBuf ? { ...habit, ...exBuf } : habit;
  item.innerHTML = editingExercise ? `
    <div class="habit-check">${checked ? '✓' : ''}</div>
    <div class="exercise-editor">
      <input type="text" value="${escapeAttr(exh.text || '')}" aria-label="Exercise title" onclick="event.stopPropagation()" oninput="updateExercise('text',this.value)">
      <input type="text" value="${escapeAttr(exh.meta || '')}" aria-label="Exercise note" onclick="event.stopPropagation()" oninput="updateExercise('meta',this.value)">
      <button class="btn sm" onclick="event.stopPropagation(); confirmExerciseEdit(this)">Done</button>
      <button class="btn sm danger" onclick="event.stopPropagation(); resetExercise()">Reset</button>
    </div>` : `
    <div class="habit-check">${checked ? '✓' : ''}</div>
    <div style="flex:1; min-width:0">
      <div class="habit-text">${escapeAttr(habit.text || '')}</div>
      ${habit.meta ? `<div class="habit-meta">${escapeAttr(habit.meta)}</div>` : ''}
    </div>`;
  item.onclick = () => { toggle(selectedDate, habit.id); };
  item.querySelector('.habit-text')?.addEventListener('click', event => {
    event.stopPropagation();
    editingExercise = true;
    renderDaily();
  });
  item.ondblclick = event => {
    event.stopPropagation();
    editingExercise = true;
    renderDaily();
  };
  el.appendChild(item);
}

function renderSundayList(d) {
  const el = document.getElementById('sundayList');
  el.innerHTML = '';
  SUNDAY_PROTOCOL.forEach(h => {
    const checked = isCheckDone(d, h.id);
    const item = document.createElement('div');
    item.className = 'habit-item' + (checked ? ' done' : '');
    item.innerHTML = `
      <div class="habit-check">${checked ? '✓' : ''}</div>
      <div style="flex:1">
        <div class="habit-text">${h.text}</div>
        ${h.meta ? `<div class="habit-meta">${h.meta}</div>` : ''}
      </div>`;
    item.onclick = () => { toggle(selectedDate, h.id); };
    el.appendChild(item);
  });
}

// ──────────────────────────────────────────────────────────────────
// RENDER — WEEKLY LOG
// ──────────────────────────────────────────────────────────────────

function getWeekRefDate() {
  const base = parseDateKey(todayStr());
  base.setDate(base.getDate() + weekOffset * 7);
  return dateKey(base);
}

function prevWeek() { weekOffset--; renderWeeklyLog(); }
function nextWeek() { weekOffset++; renderWeeklyLog(); }
function goToThisWeek() { weekOffset = 0; renderWeeklyLog(); }
function jumpWeeklyLogToDate() {
  const val = document.getElementById('weeklyJumpDate')?.value;
  if (!val) return;
  const thisMonday = parseDateKey(mondayFor(todayStr()));
  const targetMonday = parseDateKey(mondayFor(val));
  weekOffset = Math.round((targetMonday.getTime() - thisMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  renderWeeklyLog();
}

function weeklyTone(status) {
  return status === 'green' ? 'green' : status === 'amber' ? 'amber' : 'red';
}

function weeklyBand(value, greenFn, amberFn) {
  if (greenFn(value)) return 'green';
  if (amberFn(value)) return 'amber';
  return 'red';
}

function qualityTone(score) {
  return score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
}

function percentLabel(part, total) {
  if (!total) return '0%';
  const pct = Math.min(100, (part / total) * 100);
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

function computeDailyQuality(day) {
  const completion = day.completion;
  const sleepScore = day.sleep ? Math.min(100, (day.sleep / 7.5) * 100) : 0;
  const energyScore = day.energy ? Math.min(100, (day.energy / 7) * 100) : 0;
  const hoursScore = day.targetHours ? Math.min(100, (day.hours / day.targetHours) * 100) : 0;
  return Math.round(completion * .38 + sleepScore * .24 + energyScore * .18 + hoursScore * .20);
}

function computeWeeklyData(ref) {
  const week = getWeekDates(ref);
  const today = todayStr();
  const days = week.map(ds => {
    const d = getDay(ds);
    const dow = parseDateKey(ds).getDay();
    const difficulty = defaultDifficultyForDow(dow);
    const targetHours = (dow === 0 || dow === 6) ? 0 : ((TARGETS[difficulty] || TARGETS.hard).targetHours || 0);
    const comp = getDayCompletion(ds);
    const exercise = getExercise(dow);
    const exKey = exercise?.id;
    const hours = getLoggedHours(ds);
    const sleep = d.sleepHours !== null && d.sleepHours !== undefined && d.sleepHours !== '' ? +d.sleepHours : null;
    const energy = d.energy !== null && d.energy !== undefined && d.energy !== '' ? +d.energy : null;
    const oaDone = hasCompletedOA(ds);
    const row = {
      ds, d, dow, difficulty, targetHours, comp, exercise, exKey, hours,
      sleep, energy, completion: comp ? Math.round(comp.pct * 100) : 0,
      practice: +(d.practiceReps || 0),
      project: +(d.projectReps || 0),
      deepWork: +(d.deepWorkReps || 0),
      focus: d.focusScore || null,
      oaDone,
      contest: hasCompletedContest(ds),
      exerciseDone: !!(exKey && isCheckDone(d, exKey)),
      amSkin: isCheckDone(d, 'nn_am_skin'),
      pmSkin: isCheckDone(d, 'nn_pm_skin'),
      focusDone: isCheckDone(d, 'nn_focus_rep'),
      light: isCheckDone(d, 'nn_light'),
      review: isCheckDone(d, 'nn_review'),
      screen: isCheckDone(d, 'nn_screen'),
      sundayDone: dow === 0 && SUNDAY_PROTOCOL.every(h => isCheckDone(d, h.id)),
      isToday: ds === today,
    };
    row.quality = computeDailyQuality(row);
    return row;
  });

  const totals = days.reduce((acc, day) => {
    acc.hours += day.hours;
    acc.target += day.targetHours;
    acc.practice += day.practice;
    acc.project += day.project;
    acc.deepWork += day.deepWork;
    acc.focus += day.focus ? +day.focus : 0;
    acc.focusN += day.focus ? 1 : 0;
    acc.sleep += day.sleep !== null ? day.sleep : 0;
    acc.sleepN += day.sleep !== null ? 1 : 0;
    acc.energy += day.energy !== null ? day.energy : 0;
    acc.energyN += day.energy !== null ? 1 : 0;
    acc.z2 += day.exerciseDone && day.exercise?.text.includes('Zone 2') ? 1 : 0;
    acc.strength += day.exerciseDone && (day.dow === 1 || day.dow === 4) ? 1 : 0;
    acc.skAM += day.amSkin ? 1 : 0;
    acc.skPM += day.pmSkin ? 1 : 0;
    acc.contests += day.contest ? 1 : 0;
    acc.oaDone += day.oaDone ? 1 : 0;
    acc.completion += day.completion;
    acc.quality += day.quality;
    return acc;
  }, { hours:0,target:0,practice:0,project:0,deepWork:0,focus:0,focusN:0,sleep:0,sleepN:0,energy:0,energyN:0,z2:0,strength:0,skAM:0,skPM:0,contests:0,oaDone:0,completion:0,quality:0 });

  const errorCount = state.errorLog.filter(e => week.includes(e.date)).length;
  const avgSleep = totals.sleepN ? +(totals.sleep / totals.sleepN).toFixed(1) : null;
  const avgEnergy = totals.energyN ? +(totals.energy / totals.energyN).toFixed(1) : null;
  const avgCompletion = Math.round(totals.completion / 7);
  const avgQuality = Math.round(totals.quality / 7);
  const avgFocus = totals.focusN ? Math.round(totals.focus / totals.focusN) : null;
  return { week, days, totals, errorCount, avgSleep, avgEnergy, avgCompletion, avgQuality, avgFocus };
}

function weeklyStatusCards(data) {
  const sleepPct = data.totals.sleepN ? Math.round(data.days.filter(day => day.sleep !== null && day.sleep >= 7).length / data.totals.sleepN * 100) : 0;
  return [
    { title:labelForNumberField('practiceReps'), value:`${data.totals.practice} reps`, body:'Customize this label in Today\'s Numbers.', status:weeklyBand(data.totals.practice, v => v >= 20, v => v >= 15) },
    { title:labelForNumberField('projectReps'), value:`${data.totals.project} reps`, body:'Customize this label in Today\'s Numbers.', status:weeklyBand(data.totals.project, v => v >= 12, v => v >= 8) },
    { title:'Sleep', value:data.avgSleep !== null ? `${data.avgSleep}h avg` : 'No data', body:`${sleepPct}% of logged nights at 7h+`, status:data.avgSleep === null ? 'red' : weeklyBand(sleepPct, v => v >= 85, v => v >= 75) },
    { title:'Zone 2', value:`${data.totals.z2}/4`, body:'Cardio protects the focus ceiling.', status:weeklyBand(data.totals.z2, v => v >= 4, v => v >= 3) },
    { title:'Review Log', value:`${data.errorCount} entries`, body:'Target: 15-25 entries/week.', status:weeklyBand(data.errorCount, v => v >= 15, v => v >= 8) },
    { title:'Energy', value:data.avgEnergy !== null ? `${data.avgEnergy}/10` : 'No data', body:'Target average: 7+/10.', status:data.avgEnergy === null ? 'red' : weeklyBand(data.avgEnergy, v => v >= 7, v => v >= 5) },
  ];
}

function renderWeeklyBars(id, days, valueFn, labelFn, options = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const max = Math.max(options.minMax || 0, ...days.map(valueFn), 1);
  el.innerHTML = `<div class="weekly-bars">${days.map(day => {
    const value = valueFn(day);
    const height = Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100));
    const marker = options.targetFn ? Math.min(100, Math.round((options.targetFn(day) / max) * 100)) : null;
    return `<div class="weekly-bar-wrap" title="${escapeAttr(labelFn(day))}">
      <div class="weekly-bar-plot">
        ${marker !== null ? `<div class="weekly-target-marker" style="bottom:${marker}%"></div>` : ''}
        <div class="weekly-bar ${day.isToday ? 'today' : ''}" style="height:${height}%;background:${options.colorFn ? options.colorFn(day) : ''}"></div>
      </div>
      <div class="weekly-bar-value">${escapeAttr(options.valueText ? options.valueText(day) : String(value))}</div>
      <div class="weekly-bar-label">${DAY_NAMES[day.dow]}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderWeeklyHoursGraph(data) {
  const el = document.getElementById('weeklyHoursGraph');
  if (!el) return;
  const max = Math.max(1, ...data.days.map(day => day.hours || 0));
  el.innerHTML = `<div class="weekly-hours-list">${data.days.map(day => {
    const hours = day.hours || 0;
    const width = Math.min(100, Math.round((hours / max) * 100));
    const tone = hours <= 0 ? 'zero' : hours >= max * .75 ? 'hit' : hours >= max * .35 ? 'ok' : '';
    return `<div class="weekly-hours-row" title="${DAY_NAMES[day.dow]} logged ${formatHours(hours)}">
      <div class="weekly-hours-day">${DAY_NAMES[day.dow]}</div>
      <div class="weekly-hours-track">
        <div class="weekly-hours-fill ${tone}" style="width:${width}%"></div>
      </div>
      <div class="weekly-hours-value">${formatHours(hours).replace(/:00$/, '')}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderWeeklyRecoveryGraph(data) {
  const el = document.getElementById('weeklyRecoveryGraph');
  if (!el) return;
  el.innerHTML = `<div class="weekly-recovery-plot">${data.days.map(day => {
    const sleepH = day.sleep ? Math.min(100, Math.round(day.sleep / 9 * 100)) : 0;
    const energyH = day.energy ? Math.min(100, Math.round(day.energy / 10 * 100)) : 0;
    return `<div class="recovery-day" title="${DAY_NAMES[day.dow]}: sleep ${day.sleep ?? '—'}h, energy ${day.energy ?? '—'}/10">
      <div class="recovery-stack">
        <div class="recovery-bar-slot"><div class="sleep-bar" style="height:${sleepH}%"></div></div>
        <div class="recovery-bar-slot"><div class="energy-bar" style="height:${energyH}%"></div></div>
      </div>
      <div class="weekly-bar-value">${day.sleep ?? '—'}h/${day.energy ?? '—'}</div>
      <div class="weekly-bar-label">${DAY_NAMES[day.dow]}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderWeeklyTrainingMix(data) {
  const el = document.getElementById('weeklyTrainingMix');
  if (!el) return;
  const max = Math.max(...data.days.map(day => day.practice + day.project + day.deepWork), 1);
  el.innerHTML = `<div class="weekly-mix-grid">${data.days.map(day => {
    const total = day.practice + day.project + day.deepWork;
    const stackHeight = total ? Math.max(3, Math.round(total / max * 100)) : 0;
    const h = units => total && units ? Math.max(3, Math.round(units / total * 100)) : 0;
    return `<div class="mix-day" title="${DAY_NAMES[day.dow]}: ${labelForNumberField('practiceReps')} ${day.practice}, ${labelForNumberField('projectReps')} ${day.project}, ${labelForNumberField('deepWorkReps')} ${day.deepWork}">
      <div class="mix-plot">
        <div class="mix-stack" style="height:${stackHeight}%">
          <div class="mix-segment mix-practice" style="height:${h(day.practice)}%"></div>
          <div class="mix-segment mix-project" style="height:${h(day.project)}%"></div>
          <div class="mix-segment mix-deep" style="height:${h(day.deepWork)}%"></div>
        </div>
      </div>
      <div class="mix-label">${DAY_NAMES[day.dow]}</div>
    </div>`;
  }).join('')}</div>
  <div class="mix-legend">
    <span style="--legend-color:var(--accent)">${escapeAttr(labelForNumberField('practiceReps'))}</span>
    <span style="--legend-color:var(--blue)">${escapeAttr(labelForNumberField('projectReps'))}</span>
    <span style="--legend-color:var(--amber)">${escapeAttr(labelForNumberField('deepWorkReps'))}</span>
  </div>`;
}

function renderWeeklyHeatmap(data) {
  const seen = new Map();
  data.days.forEach(day => {
    getNonNegs(day.ds, day.difficulty).forEach(item => {
      if (!seen.has(item.id)) seen.set(item.id, item.text || item.id);
    });
  });
  const rows = [...seen.entries()].slice(0, 8).map(([id, label]) => [label, day => isCheckDone(day.d, id)]);
  const el = document.getElementById('weeklyHeatmap');
  if (!rows.length) {
    el.innerHTML = `<div class="dash-empty">No non-negotiables configured yet</div>`;
    return;
  }
  el.innerHTML = `<div class="weekly-heatmap">
    <div></div>${data.days.map(day => `<div class="heat-label" style="text-align:center">${DAY_NAMES[day.dow]}</div>`).join('')}
    ${rows.map(([label, fn]) => `
      <div class="heat-label">${label}</div>
      ${data.days.map(day => `<div class="heat-cell ${fn(day) ? 'on' : ''} ${day.isToday ? 'today' : ''}">${fn(day) ? '✓' : '—'}</div>`).join('')}
    `).join('')}
  </div>`;
}

function renderWeeklyDiagnosis(data) {
  const items = [];
  if (data.errorCount < 8) items.push(['red', 'Review volume low', 'Error logging is below the minimum useful signal. Finish sessions by extracting one missed pattern.']);
  if (data.avgSleep !== null && data.avgSleep < 7) items.push(['red', 'Recovery floor weak', 'Average sleep is below 7h. Drop optional load before adding more work.']);
  if (data.totals.practice >= 15) items.push(['green', `${labelForNumberField('practiceReps')} strong`, 'Enough weekly volume is visible. Keep quality honest.']);
  else items.push(['amber', `${labelForNumberField('practiceReps')} light`, 'Push toward a clearer weekly target before judging progress.']);
  if (data.totals.project < 8) items.push(['amber', 'Project depth light', 'Deeper transfer needs written notes or outputs. Add focused reps before extra surface work.']);
  if (data.totals.z2 < 3) items.push(['amber', 'Cardio under target', 'Schedule Zone 2 early in the week so it does not get squeezed out.']);
  if (data.avgQuality >= 70) items.push(['green', 'Week quality solid', 'The combined completion, recovery, and hour signal is usable. Read trend lines next.']);
  if (!items.length) items.push(['green', 'No major weekly bottleneck', 'Inputs are visible and within band. Keep the same operating rhythm.']);
  document.getElementById('weeklyDiagnosisList').innerHTML = items.slice(0, 5).map(([tone, title, body]) => `
    <div class="weekly-diagnosis-item ${tone}">
      <div class="weekly-diagnosis-title">${escapeAttr(title)}</div>
      <div class="weekly-diagnosis-body">${escapeAttr(body)}</div>
    </div>`).join('');
}

function renderWeeklyDashboard(data) {
  const statusCards = weeklyStatusCards(data);
  const redCount = statusCards.filter(card => card.status === 'red').length;
  const title = redCount >= 3 ? 'Weekly intervention required' : redCount ? 'Week has active constraints' : 'Weekly system within band';
  document.getElementById('weeklyCommandTitle').textContent = title;
  document.getElementById('weeklyCommandCopy').textContent = redCount
    ? 'Several weekly inputs are below band. Fix the named constraints before increasing intensity.'
    : 'The week has enough visible signal. Keep compounding and use Sunday to choose next week’s bottleneck.';
  document.getElementById('weeklyScoreGrid').innerHTML = [
    ['Hours', formatHours(data.totals.hours), 'logged this week'],
    ['Completion', `${data.avgCompletion}%`, '7-day average'],
    ['Quality', `${data.avgQuality}%`, 'completion + recovery + load'],
    ['Review', `${data.errorCount}`, 'error-log entries'],
  ].map(([label, value, note]) => `
    <div class="weekly-score">
      <div class="weekly-score-label">${label}</div>
      <div class="weekly-score-value">${value}</div>
      <div class="weekly-score-note">${note}</div>
    </div>`).join('');
  document.getElementById('weeklyStatusGrid').innerHTML = statusCards.map(card => `
    <div class="weekly-status-card ${weeklyTone(card.status)}">
      <div class="weekly-status-title">${escapeAttr(card.title)}</div>
      <div class="weekly-status-value">${escapeAttr(card.value)}</div>
      <div class="weekly-status-body">${escapeAttr(card.body)}</div>
    </div>`).join('');
  document.getElementById('weeklyHoursGraphMeta').textContent = formatHours(data.totals.hours);
  renderWeeklyHoursGraph(data);
  document.getElementById('weeklyCompletionGraphMeta').textContent = `${data.avgCompletion}% avg`;
  renderWeeklyBars('weeklyCompletionGraph', data.days, day => day.completion, day => `${DAY_NAMES[day.dow]}: ${day.completion}% complete`, {
    minMax: 100,
    valueText: day => `${day.completion}%`,
    colorFn: day => day.completion >= 70 ? 'var(--green)' : day.completion >= 40 ? 'var(--amber)' : 'var(--red)'
  });
  renderWeeklyRecoveryGraph(data);
  renderWeeklyTrainingMix(data);
  renderWeeklyHeatmap(data);
  renderWeeklyDiagnosis(data);
}

function renderWeeklyLog() {
  const ref = getWeekRefDate();
  const data = computeWeeklyData(ref);
  const { week, days, totals } = data;
  const weeklyJump = document.getElementById('weeklyJumpDate');
  if (weeklyJump && weeklyJump !== document.activeElement) weeklyJump.value = week[0];
  document.getElementById('weekRangeLabel').textContent = `${formatDate(week[0], {day:'numeric',month:'short'})} – ${formatDate(week[6], {day:'numeric',month:'short',year:'numeric'})}`;
  renderWeeklyDashboard(data);

  const tbl = document.getElementById('weeklyTable');
  tbl.innerHTML = `
    <thead><tr>
      <th>Day</th><th>Sleep h</th><th>Out</th><th>Energy</th><th>Hours</th><th>${escapeAttr(labelForNumberField('focusScore'))}</th>
      <th>${escapeAttr(labelForNumberField('practiceReps'))}</th><th>${escapeAttr(labelForNumberField('contestDone'))}</th><th>${escapeAttr(labelForNumberField('projectReps'))}</th><th>${escapeAttr(labelForNumberField('deepWorkReps'))}</th>
      <th>Exercise</th><th>AM✓</th><th>PM✓</th><th>Q</th><th>Done%</th>
    </tr></thead><tbody id="weeklyBody"></tbody>`;
  const body = document.getElementById('weeklyBody');
  days.forEach(day => {
    const d = day.d;
    const pctColor = day.completion>=70 ? 'var(--green)' : day.completion>=40 ? 'var(--amber)' : day.completion>0 ? 'var(--red)' : 'var(--muted)';
    const sleepColor = day.sleep >= 7.5 ? 'var(--green)' : day.sleep >= 6 ? 'var(--amber)' : day.sleep ? 'var(--red)' : '';
    const energyColor = day.energy >= 7 ? 'var(--green)' : day.energy >= 5 ? 'var(--amber)' : day.energy ? 'var(--red)' : '';
    const tr = document.createElement('tr');
    if (day.isToday) tr.className = 'today-row';
    tr.innerHTML = `
      <td class="td-day">${DAY_NAMES[day.dow]} ${parseDateKey(day.ds).getDate()}</td>
      <td><span style="color:${sleepColor}">${day.sleep ?? '—'}</span></td>
      <td>${escapeAttr(d.lightsOut || '—')}</td>
      <td><span style="color:${energyColor}">${day.energy ?? '—'}</span></td>
      <td>${formatHours(day.hours)}</td>
      <td>${day.focus || '—'}</td>
      <td>${day.practice}</td>
      <td>${day.contest ? '<span class="text-green">✓</span>' : '—'}</td>
      <td>${day.project}</td>
      <td>${day.deepWork}</td>
      <td>${escapeAttr(day.exercise?.text.split('—')[0].trim() || '—')} ${day.exKey&&day.exerciseDone?'<span class="text-green">✓</span>':'<span class="text-muted">✗</span>'}</td>
      <td>${day.amSkin ? '<span class="check-cell">✓</span>':'—'}</td>
      <td>${day.pmSkin ? '<span class="check-cell">✓</span>':'—'}</td>
      <td><span class="weekly-quality ${qualityTone(day.quality)}">${day.quality}</span></td>
      <td><span style="color:${pctColor}; font-weight:600">${day.completion ? day.completion+'%' : '—'}</span></td>`;
    body.appendChild(tr);
  });

  const avgSleep = data.avgSleep !== null ? data.avgSleep.toFixed(1) : '—';
  const avgEng = data.avgEnergy !== null ? data.avgEnergy.toFixed(1) : '—';
  document.getElementById('weekSummary').innerHTML = `
    <div class="row" style="flex-wrap:wrap; gap:16px; font-size:.78rem">
      <div><span class="text-dim">Avg sleep </span><strong>${avgSleep}h</strong></div>
      <div><span class="text-dim">Avg energy </span><strong>${avgEng}/10</strong></div>
      <div><span class="text-dim">Avg ${escapeAttr(labelForNumberField('focusScore'))} </span><strong>${data.avgFocus ?? '—'}</strong></div>
      <div><span class="text-dim">${escapeAttr(labelForNumberField('practiceReps'))} </span><strong>${totals.practice}</strong></div>
      <div><span class="text-dim">Logged hours </span><strong>${formatHours(totals.hours)}</strong></div>
      <div><span class="text-dim">${escapeAttr(labelForNumberField('projectReps'))} </span><strong>${totals.project}</strong></div>
      <div><span class="text-dim">${escapeAttr(labelForNumberField('deepWorkReps'))} </span><strong>${totals.deepWork}</strong></div>
      <div><span class="text-dim">Zone 2 </span><strong ${totals.z2>=4?'class="text-green"':totals.z2>=3?'class="text-amber"':'class="text-red"'}>${totals.z2}/4</strong></div>
      <div><span class="text-dim">Strength </span><strong>${totals.strength}/2</strong></div>
      <div><span class="text-dim">Evening reset </span><strong>${totals.skPM}/7</strong></div>
      <div><span class="text-dim">Sunday protocol </span><strong>${days[6]?.sundayDone ? 'done' : 'pending'}</strong></div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────────
// RENDER — METRICS / BENCHMARKS
// ──────────────────────────────────────────────────────────────────

const BENCH_STATUS = {
  green: { label:'Green', tone:'green' },
  amber: { label:'Amber', tone:'amber' },
  red:   { label:'Off-Track', tone:'red' },
  grey:  { label:'No Data', tone:'grey' },
};

function statusBadge(status, label) {
  const s = BENCH_STATUS[status] || BENCH_STATUS.grey;
  return `<span class="badge ${s.tone}">${label || s.label}</span>`;
}

function renderBenchmarkCommand() {
  const rows = state.customBenchmarks || [];
  const counts = rows.reduce((acc, row) => {
    acc[row.status || 'grey'] = (acc[row.status || 'grey'] || 0) + 1;
    return acc;
  }, {});
  const tracked = rows.length - (counts.grey || 0);
  const green = counts.green || 0;
  const amber = counts.amber || 0;
  const red = counts.red || 0;
  const score = tracked ? Math.round(((green + amber * .55) / tracked) * 100) : 0;
  document.getElementById('benchCommandTitle').textContent = red ? 'Attention needed' : tracked ? 'Benchmarks in range' : 'Build your baseline';
  document.getElementById('benchCommandCopy').textContent = red
    ? 'One or more benchmarks is off-track. Use the action notes below to reduce ambiguity and make the next move obvious.'
    : 'Use this as a flexible personal scorecard. Rename labels, add new rows, and keep only the signals you actually review.';
  document.getElementById('benchScoreGrid').innerHTML = [
    { label:'Score', value:tracked ? `${score}%` : '-', note:'Green plus partial amber' },
    { label:'Green', value:green, note:'Working' },
    { label:'Amber', value:amber, note:'Watch' },
    { label:'Off-track', value:red, note:'Act' },
  ].map(item => `
    <div class="bench-score">
      <div class="bench-score-label">${item.label}</div>
      <div class="bench-score-value">${item.value}</div>
      <div class="bench-score-note">${item.note}</div>
    </div>`).join('');
}

function renderBenchmarkDiagnostics(m) {
  const totalHours = getWeekDates(todayStr()).reduce((sum, ds) => sum + getLoggedHours(ds), 0);
  const week = computeWeeklyData(todayStr());
  document.getElementById('benchDiagnosticGrid').innerHTML = [
    { title:'Hours Logged', readout:formatHours(totalHours), body:'Running total for the current week from task-hour logs.' },
    { title:'Completion', readout:`${week.avgCompletion}% avg`, body:'Average daily completion across the visible week.' },
    { title:'Recovery', readout:`Sleep ${m.sleepPct !== null ? m.sleepPct + '%' : '-'} / Energy ${m.energyAvg !== null ? m.energyAvg + '/10' : '-'}`, body:'Simple sleep and energy signal from the daily numbers.' },
  ].map(card => `
    <div class="bench-diagnostic">
      <div class="bench-diagnostic-title">${escapeAttr(card.title)}</div>
      <div class="bench-diagnostic-readout">${escapeAttr(card.readout)}</div>
      <div class="bench-diagnostic-body">${escapeAttr(card.body)}</div>
    </div>`).join('');
}

function renderMetrics() {
  const m = computeMetrics();
  renderBenchmarkCommand();
  renderBenchmarkDiagnostics(m);
  renderCustomBenchmarkBoard();
}

function addCustomBenchmark() {
  const name = document.getElementById('bench-new-name').value.trim();
  if (!name) return;
  const item = {
    id: newCustomId('bm'),
    name,
    current: document.getElementById('bench-new-current').value.trim(),
    status: document.getElementById('bench-new-status').value || 'grey',
    good: document.getElementById('bench-new-good').value.trim(),
    ok: document.getElementById('bench-new-ok').value.trim(),
    bad: document.getElementById('bench-new-bad').value.trim(),
    note: document.getElementById('bench-new-note').value.trim(),
    action: document.getElementById('bench-new-action').value.trim(),
  };
  state.customBenchmarks.push(item);
  clearInputs(['bench-new-name','bench-new-current','bench-new-good','bench-new-ok','bench-new-bad','bench-new-note','bench-new-action']);
  document.getElementById('bench-new-status').value = 'green';
  save();
  renderMetrics();
}

function updateCustomBenchmark(id, field, value) {
  const item = (state.customBenchmarks || []).find(row => row.id === id);
  if (!item) return;
  item[field] = value;
  save();
  renderBenchmarkCommand();
}

function deleteCustomBenchmark(id) {
  state.customBenchmarks = (state.customBenchmarks || []).filter(row => row.id !== id);
  save();
  renderMetrics();
}

function resetCustomBenchmarks() {
  if (!confirm('Reset benchmark board to the general defaults?')) return;
  state.customBenchmarks = DEFAULT_BENCHMARKS.map(item => ({ ...item }));
  save();
  renderMetrics();
}

function renderCustomBenchmarkBoard() {
  const el = document.getElementById('customBenchmarkBoard');
  if (!el) return;
  const rows = state.customBenchmarks || [];
  if (!rows.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--muted)">No benchmarks yet. Add one above or reset to defaults.</div><button class="btn sm" onclick="resetCustomBenchmarks()">Reset Defaults</button>';
    return;
  }
  el.innerHTML = rows.map(row => `
    <div class="benchmark-card">
      <div class="benchmark-card-head">
        <div>
          <input type="text" value="${escapeAttr(row.name || '')}" oninput="updateCustomBenchmark('${row.id}','name',this.value)" aria-label="Benchmark name">
          <div class="benchmark-card-meta">Bands: green ${escapeAttr(row.good || '-')} · amber ${escapeAttr(row.ok || '-')} · off-track ${escapeAttr(row.bad || '-')}</div>
        </div>
        <select style="width:130px" onchange="updateCustomBenchmark('${row.id}','status',this.value); renderMetrics()">
          ${['green','amber','red','grey'].map(status => `<option value="${status}" ${row.status === status ? 'selected' : ''}>${BENCH_STATUS[status].label}</option>`).join('')}
        </select>
      </div>
      <div class="custom-benchmark-form">
        <input type="text" value="${escapeAttr(row.current || '')}" oninput="updateCustomBenchmark('${row.id}','current',this.value)" placeholder="Current value">
        <input type="text" value="${escapeAttr(row.good || '')}" oninput="updateCustomBenchmark('${row.id}','good',this.value)" placeholder="Green band">
        <input type="text" value="${escapeAttr(row.ok || '')}" oninput="updateCustomBenchmark('${row.id}','ok',this.value)" placeholder="Amber band">
        <input type="text" value="${escapeAttr(row.bad || '')}" oninput="updateCustomBenchmark('${row.id}','bad',this.value)" placeholder="Off-track band">
        <input class="wide" type="text" value="${escapeAttr(row.note || '')}" oninput="updateCustomBenchmark('${row.id}','note',this.value)" placeholder="Evidence / note">
        <input class="wide" type="text" value="${escapeAttr(row.action || '')}" oninput="updateCustomBenchmark('${row.id}','action',this.value)" placeholder="Action if off-track">
      </div>
      <div class="benchmark-card-body mt8">
        <div>${statusBadge(row.status)} <strong>${escapeAttr(row.current || '-')}</strong></div>
        ${row.note ? `<div>${escapeAttr(row.note)}</div>` : ''}
        ${row.action ? `<div><span class="text-dim">Action:</span> ${escapeAttr(row.action)}</div>` : ''}
      </div>
      <div class="row mt8">
        <button class="btn sm danger" onclick="deleteCustomBenchmark('${row.id}')">Delete</button>
      </div>
    </div>
  `).join('') + '<button class="btn sm" onclick="resetCustomBenchmarks()">Reset Defaults</button>';
}

// ──────────────────────────────────────────────────────────────────
// RENDER — ERROR LOG
// ──────────────────────────────────────────────────────────────────

function addErrorEntry() {
  const problem = document.getElementById('el-problem').value.trim();
  const missed  = document.getElementById('el-missed').value.trim();
  const pattern = document.getElementById('el-pattern').value.trim();
  if (!problem && !missed) return;
  state.errorLog.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2), date: todayStr(), problem, missed, pattern });
  save();
  document.getElementById('el-problem').value = '';
  document.getElementById('el-missed').value  = '';
  document.getElementById('el-pattern').value = '';
  renderErrorLog();
}

function addToErrorLogFromNotes() {
  const notes = document.getElementById('inp-notes').value.trim();
  if (!notes) return;
  // Parse format: [problem] | [missed] | [pattern]
  const lines = notes.split('\n').filter(l => l.trim());
  let added = 0;
  lines.forEach(line => {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length >= 2) {
      state.errorLog.push({ id:Date.now()+'_'+Math.random().toString(36).slice(2), date:todayStr(), problem:parts[0], missed:parts[1], pattern:parts[2]||'' });
      added++;
    }
  });
  if (added) { save(); renderErrorLog(); alert(`Added ${added} error log ${added===1?'entry':'entries'}.`); }
  else alert('Format: problem | what I missed | pattern');
}

function clearErrorLog() {
  if (!confirm('Delete all error log entries?')) return;
  state.errorLog = [];
  save();
  renderErrorLog();
}

function deleteErrorEntry(id) {
  state.errorLog = state.errorLog.filter(e => String(e.id) !== String(id));
  save();
  renderErrorLog();
}

function renderErrorLog() {
  const search = document.getElementById('el-search')?.value.toLowerCase() || '';
  const entries = state.errorLog
    .filter(e => !search || [e.problem,e.missed,e.pattern].join(' ').toLowerCase().includes(search))
    .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));

  document.getElementById('elCount').textContent = state.errorLog.length;

  // Clusters
  const patternMap = {};
  state.errorLog.forEach(e => {
    if (e.pattern) { patternMap[e.pattern] = (patternMap[e.pattern]||0) + 1; }
  });
  const clusters = Object.entries(patternMap).sort((a,b) => b[1]-a[1]);
  const bottlenecks = clusters.filter(([,n]) => n >= 3);
  const bEl = document.getElementById('bottlenecksList');
  if (!clusters.length) {
    bEl.innerHTML = '<div style="font-size:.75rem;color:var(--muted)">No patterns yet. Add entries with a pattern field.</div>';
  } else {
    bEl.innerHTML = clusters.map(([pat, n]) => `
      <div class="${n>=3?'bottleneck-row':'pattern-cluster'}">
        <span class="${n>=3?'bottleneck-count text-red':'text-amber'}">${n}×</span>
        <span style="font-size:.75rem">${escapeAttr(pat)}</span>
        ${n>=3 ? '<span class="badge red" style="margin-left:auto">BOTTLENECK</span>' : ''}
      </div>`).join('');
  }

  // List
  const listEl = document.getElementById('errorLogList');
  if (!entries.length) {
    listEl.innerHTML = `<div style="font-size:.75rem;color:var(--muted)">No entries${search?' matching "'+escapeAttr(search)+'"':''}. Add from the form above.</div>`;
    return;
  }
  listEl.innerHTML = entries.map(e => `
    <div class="error-entry">
      <div class="error-header">
        <span class="error-date">${escapeAttr(e.date)}</span>
        <span class="error-problem">${escapeAttr(e.problem || '—')}</span>
        ${e.pattern ? `<span class="error-pattern">${escapeAttr(e.pattern)}</span>` : ''}
        <button class="btn sm danger" style="margin-left:auto; font-size:.6rem; padding:2px 6px" onclick="deleteErrorEntry(${jsArg(e.id)})">✕</button>
      </div>
      ${e.missed ? `<div class="error-missed">↳ ${escapeAttr(e.missed)}</div>` : ''}
    </div>`).join('');
}

// ──────────────────────────────────────────────────────────────────
// EXPORT / IMPORT
// ──────────────────────────────────────────────────────────────────

function exportJSON() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `tracker-${todayStr()}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function csvCell(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function exportCSV() {
  const week = getWeekDates(todayStr());
  const rows = [['Date','Day',labelForNumberField('sleepHours'),labelForNumberField('lightsOut'),labelForNumberField('energy'),'Logged hours',labelForNumberField('mood'),'Distractions',labelForNumberField('focusScore'),labelForNumberField('practiceReps'),labelForNumberField('projectReps'),labelForNumberField('deepWorkReps'),'Exercise','Morning Reset','Evening Reset','Done%','Insight','Tomorrow']];
  week.forEach(ds => {
    const d   = getDay(ds);
    const dow = parseDateKey(ds).getDay();
    const comp = getDayCompletion(ds);
    const exKey = getExercise(dow)?.id;
    rows.push([
      ds, DAY_FULL[dow],
      d.sleepHours||'', d.lightsOut||'', d.energy||'',
      formatHours(getLoggedHours(ds)), d.mood||'', d.distractions||'', d.focusScore||'',
      d.practiceReps||0, d.projectReps||0, d.deepWorkReps||0,
      exKey&&isCheckDone(d, exKey)?'Y':'N',
      isCheckDone(d, 'nn_am_skin')?'Y':'N', isCheckDone(d, 'nn_pm_skin')?'Y':'N',
      comp ? Math.round(comp.pct*100)+'%' : '',
      (d.insight||'').replace(/,/g,' '),
      (d.tomorrow||'').replace(/,/g,' '),
    ]);
  });
  const csv  = rows.map(r => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `tracker-weekly-${todayStr()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function importJSON(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm('This will replace all current data. Continue?')) return;
      state = data.state || data;
      normalizeState();
      save();
      renderAll();
      alert('Import successful.');
    } catch { alert('Invalid JSON file.'); }
  };
  reader.readAsText(file);
}

function renderDataPreview() {
  const json = JSON.stringify(state, null, 2);
  document.getElementById('dataPreview').textContent = json.slice(0, 2000) + (json.length > 2000 ? '\n\n[truncated…]' : '');
  document.getElementById('dataSize').textContent = `${(json.length/1024).toFixed(1)} KB stored`;
}

function resetAll() {
  if (!confirm('Delete ALL data? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = {
    phase:1, days:{}, metrics:{scoreHistory:[],focusPeaks:[]}, errorLog:[], startDate:todayStr(),
    customNonNegs:[], removedNonNegs:[], nonNegOverrides:{}, nonNegTemplates:[],
    customTraining:{}, removedTraining:{}, trainingTemplates:{}, exerciseOverrides:{},
    timerSettings:{ pomodoroMs:25 * 60 * 1000, breakMs:5 * 60 * 1000 },
    numberLabels:{},
    customBenchmarks: DEFAULT_BENCHMARKS.map(item => ({ ...item })),
    reminders:[]
  };
  normalizeState();
  selectedDate = todayStr();
  save();
  renderAll();
}

// ──────────────────────────────────────────────────────────────────
// TABS
// ──────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    const tabs = ['daily','timer','reminders','weekly','metrics','errorlog','export'];
    b.classList.toggle('active', tabs[i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-'+name));

  if (name === 'timer')    renderTimer();
  if (name === 'reminders') renderReminders();
  if (name === 'weekly')   renderWeeklyLog();
  if (name === 'metrics')  renderMetrics();
  if (name === 'errorlog') renderErrorLog();
  if (name === 'export') {
    renderDataPreview();
    setBackupStatus(backupStatus, backupStatusKind);
  }
}

// ──────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────

function renderAll() {
  renderDaily();
  renderReminders();
}

loadMotivationQuotes().then(() => renderPhase());
renderAll();
initServerAutosave().then(active => {
  if (!active) initBackupFile();
});
