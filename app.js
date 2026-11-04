
'use strict';

const KEY = 'iegh-scribe-v1';
const CONFIG_KEY = 'iegh-scribe-sync-v1';

const DEFAULT_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbzi5VdWMvB88liutjklNiKYfN8osJYie3bilomTVXxBiv2-a3KlxvXsRrmk_MLP6wjR/exec';

const ROSTER = [
  'Andy', 'Cassidy', 'Chris', 'Jessica', 'Keisha',
  'Lordess', 'Matt', 'Michael', 'Sharon', 'Tiffany'
];

const TYPES = [
  'EVP / Voice',
  'Sound / Noise',
  'Visual',
  'Movement',
  'Physical Sensation',
  'Equipment Response',
  'Temperature Change',
  'Environment',
  'Investigator Movement',
  'Experiment / Activity',
  'Question Asked',
  'General Note'
];

const $ = id => document.getElementById(id);

const esc = x => String(x ?? '').replace(
  /[&<>"']/g,
  c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c])
);

const now = () => new Date().toISOString();

const fmt = t => t
  ? new Date(t).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    })
  : '';

let data = {
  locations: [],
  visits: [],
  activeId: null,
  draft: null
};

let config = {
  endpoint: DEFAULT_ENDPOINT,
  apiKey: ''
};

let view = 'home';
let reportId = null;
let syncing = false;
let notice = '';

try {
  const raw = localStorage.getItem(KEY);
  if (raw) data = { ...data, ...JSON.parse(raw) };
} catch (e) {
  notice = 'Stored records could not be read. Do not clear website data.';
}

try {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (raw) config = { ...config, ...JSON.parse(raw) };
} catch (e) {
  notice = 'Connection settings could not be read.';
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    notice = 'Storage unavailable or full. Do not close this page.';
    return false;
  }
}

function saveConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch (e) {
    notice = 'Could not save connection settings.';
    return false;
  }
}

function current() {
  return data.visits.find(v => v.id === data.activeId);
}

function uniquePrefix(name) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  let prefix = letters.slice(0, 4).padEnd(4, 'X');

  const taken = data.locations
    .filter(l => l.name.toLowerCase() !== name.toLowerCase())
    .map(l => l.prefix);

  if (!taken.includes(prefix)) return prefix;

  for (let i = 0; i < 26; i++) {
    const candidate =
      prefix.slice(0, 3) + String.fromCharCode(65 + i);

    if (!taken.includes(candidate)) return candidate;
  }

  return prefix + Date.now().toString(36).slice(-3).toUpperCase();
}

function btn(label, fn, cls = '') {
  return `<button class="${cls}" onclick="${fn}">${esc(label)}</button>`;
}

function status(v) {
  if (!v.end) return 'In progress';

  if (
    v.sync &&
    v.sync.syncedVersion === v.sync.version
  ) {
    return 'Confirmed in Google Drive';
  }

  if (v.sync && v.sync.error) return 'Waiting to retry';

  return 'Waiting to sync';
}

function render() {
  const v = current() || (
    data.editVisitId
      ? data.visits.find(x => x.id === data.editVisitId)
      : null
  );

  let html = '';

  if (view === 'home') {
    html = `
      <div class="panel">
        <h2>${v ? 'Active investigation' : 'Ready for investigation'}</h2>
        ${
          v
            ? `
              <p>${esc(v.location)} · ${esc(v.code)}</p>
              <p class="muted">Started ${fmt(v.start)}</p>
              ${btn('Resume Investigation', "go('log')", 'primary')}
            `
            : btn('Start New Investigation', "go('setup')", 'primary')
        }
      </div>

      ${btn('Previous Investigations', "go('history')", 'ghost')}
      ${btn('Google Drive Settings', "go('settings')", 'ghost')}

      <p class="muted">
        ${
          config.apiKey
            ? 'Google Drive connection configured'
            : 'Google Drive connection not configured'
        }
        · ${navigator.onLine ? 'Online' : 'Offline'}
      </p>
    `;
  }

  if (view === 'settings') {
    html = `
      <h2>Google Drive Connection</h2>

      <div class="panel">
        <p class="muted">
          Your key is stored only in this device's browser storage.
          Never put it in GitHub or share it.
        </p>

        <label>Apps Script Web App URL</label>
        <input
          id="endpoint"
          value="${esc(config.endpoint)}"
          autocapitalize="off"
          spellcheck="false"
        >

        <label>Private API key</label>
        <input
          id="apiKey"
          type="password"
          placeholder="${
            config.apiKey
              ? 'Key saved; leave blank to keep it'
              : 'Paste your private key'
          }"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        >

        ${btn('Save Connection', 'saveConnection()', 'primary')}
        ${btn('Sync Completed Investigations', 'syncAll(true)')}
        ${btn('Back', "go('home')", 'ghost')}
      </div>

      <p class="muted">
        Sync requires this app to be open and online.
        A receipt is required before an upload is marked confirmed.
      </p>
    `;
  }

  if (view === 'setup') {
    html = `
      <h2>New Investigation</h2>

      <label>Location</label>
      <select id="locationSelect">
        <option value="">New location</option>
        ${
          data.locations.map(l =>
            `<option value="${esc(l.name)}">${esc(l.name)}</option>`
          ).join('')
        }
      </select>

      <label>New location name (if needed)</label>
      <input id="newLocation" placeholder="Location name">

      <h2>Attending investigators</h2>
      <div class="grid">
        ${
          ROSTER.map(n => `
            <button
              class="att"
              data-name="${esc(n)}"
              onclick="this.classList.toggle('selected')"
            >${esc(n)}</button>
          `).join('')
        }
      </div>

      <h2>Optional baseline readings</h2>

      <label>Outside ambient temperature (°F)</label>
      <input id="outside" type="number" inputmode="decimal">

      <label>Weather</label>
      <input id="weather">

      <label>Indoor baseline temperature (°F)</label>
      <input id="inside" type="number" inputmode="decimal">

      <label>Indoor baseline location</label>
      <input id="insidePlace" placeholder="Room or area">

      ${btn('Begin Investigation', 'startVisit()', 'primary')}
      ${btn('Back', "go('home')", 'ghost')}
    `;
  }

  if (view === 'log' && v) {
    html = `
      <div class="panel">
        <div class="row">
          <strong>${esc(v.location)}</strong>
          <span class="status">ACTIVE</span>
        </div>

        <div class="muted">
          ${esc(v.code)} · ${fmt(v.start)}
        </div>
      </div>

      <h2>Tap to timestamp</h2>

      <div class="grid">
        ${
          TYPES.map(t =>
            btn(
              t,
              `pick(${JSON.stringify(t).replace(/"/g, '&quot;')})`
            )
          ).join('')
        }
      </div>

      <div class="row" style="margin-top:12px">
        ${btn('Undo Last Event', 'undoLast()', 'ghost')}
        ${btn('End Investigation', 'endVisit()', 'ghost')}
      </div>

      <h2>Recent events</h2>
      ${events(v)}
    `;
  }

  if (view === 'event' && v && data.draft) {
    const d = data.draft;

    html = `
      <div class="panel">
        <strong>${esc(d.type)}</strong>
        <div class="muted">
          ${fmt(d.time)} · Timestamp preserved
        </div>
      </div>

      <h2>Investigators</h2>

      <div class="grid">
        ${
          v.attendees.map(n => `
            <button
              class="witness ${d.people.includes(n) ? 'selected' : ''}"
              data-name="${esc(n)}"
              onclick="togglePerson(this)"
            >${esc(n)}</button>
          `).join('')
        }
      </div>

      <p class="muted">No selection = Unknown / Skip</p>

      ${
        d.type === 'Equipment Response'
          ? `
            <label>Equipment</label>
            <select id="equipment">
              <option value="">Select</option>
              ${
                ['K2', 'REM Pod', 'Other'].map(x =>
                  `<option ${d.equipment === x ? 'selected' : ''}>${x}</option>`
                ).join('')
              }
            </select>
          `
          : ''
      }

      ${
        d.type === 'Temperature Change'
          ? `
            <label>Temperature (°F)</label>
            <input
              id="reading"
              type="number"
              inputmode="decimal"
              value="${esc(d.reading)}"
            >
          `
          : ''
      }

      ${
        d.type === 'Question Asked'
          ? `
            <label>Preset question</label>

            <div class="grid">
              ${
                [
                  'Is anyone here?',
                  'What is your name?',
                  'Can you hear us?',
                  'Can you make a sound?'
                ].map(q =>
                  btn(
                    q,
                    `setQuestion(${JSON.stringify(q).replace(/"/g, '&quot;')})`
                  )
                ).join('')
              }
            </div>

            <input
              id="question"
              placeholder="Question asked"
              value="${esc(d.question)}"
            >
          `
          : ''
      }

      <label>Location (optional)</label>

      <div class="grid">
        ${
          ['Outside', 'Inside', 'Upstairs'].map(p =>
            btn(
              p,
              `setPlace(${JSON.stringify(p).replace(/"/g, '&quot;')})`
            )
          ).join('')
        }
      </div>

      <input
        id="place"
        placeholder="Or custom location"
        value="${esc(d.place)}"
      >

      <label>Optional description</label>
      <textarea
        id="description"
        rows="3"
        placeholder="What happened?"
      >${esc(d.description)}</textarea>

      ${
        btn(
          d.editId ? 'Save Corrections' : 'LOG EVENT',
          'logEvent()',
          'primary'
        )
      }

      ${btn('Back (keep draft)', "go('log')", 'ghost')}
    `;
  }

  if (view === 'history') {
    html = '<h2>Previous Investigations</h2>' +
      data.visits.slice().reverse().map(r => `
        <div class="event">
          <strong>${esc(r.location)} · ${esc(r.code)}</strong>

          <p class="muted">
            ${fmt(r.start)}
            ${r.end ? ' to ' + fmt(r.end) : ' · In progress'}
          </p>

          <p class="muted">${esc(status(r))}</p>

          ${
            btn(
              'View Report',
              `report(${JSON.stringify(r.id).replace(/"/g, '&quot;')})`
            )
          }
        </div>
      `).join('') +
      btn('Back', "go('home')", 'ghost');
  }

  if (view === 'report') {
    const r = data.visits.find(x => x.id === reportId);

    html = r ? `
      <h2>${esc(r.location)} · ${esc(r.code)}</h2>

      <div class="panel">
        <p>Start: ${fmt(r.start)}</p>
        <p>End: ${r.end ? fmt(r.end) : 'In progress'}</p>
        <p>Investigators: ${esc(r.attendees.join(', '))}</p>
        <p>Outside: ${esc(r.outside || 'Not recorded')} °F</p>
        <p>
          Indoor: ${esc(r.inside || 'Not recorded')} °F
          ${esc(r.insidePlace)}
        </p>
        <p>Weather: ${esc(r.weather || 'Not recorded')}</p>

        <p class="status">${esc(status(r))}</p>

        ${
          r.sync && r.sync.error
            ? `<p class="muted">${esc(r.sync.error)}</p>`
            : ''
        }

        ${
          r.sync && r.sync.docUrl
            ? `
              <p>
                <a href="${esc(r.sync.docUrl)}"
                   target="_blank" rel="noopener">Google Doc</a>
                ·
                <a href="${esc(r.sync.sheetUrl)}"
                   target="_blank" rel="noopener">Google Sheet</a>
              </p>
            `
            : ''
        }
      </div>

      <label>General notes</label>
      <textarea id="notes" rows="3">${esc(r.notes || '')}</textarea>

      ${btn('Save Notes', 'saveNotes()', 'primary')}

      ${
        r.end
          ? btn(
              'Sync This Investigation',
              `syncOne(${JSON.stringify(r.id).replace(/"/g, '&quot;')},true)`
            )
          : ''
      }

      <h2>Chronological events</h2>
      ${events(r, true)}

      ${btn('Back', "go('history')", 'ghost')}
    ` : '';
  }

  $('notice').textContent = notice;
  $('app').innerHTML = html;
}

function events(v, ascending = false) {
  const a = [...v.events].sort((x, y) =>
    ascending
      ? x.time.localeCompare(y.time)
      : y.time.localeCompare(x.time)
  );

  if (!a.length) {
    return '<p class="muted">No events logged yet.</p>';
  }

  return a.map(e => `
    <div class="event" onclick="editEvent('${e.id}')">
      <div class="row">
        <strong>${esc(e.type)}</strong>
        <span class="muted">${fmt(e.time)}</span>
      </div>

      <div class="muted">
        ${esc(e.people.join(', '))}
        ${e.place ? ' · ' + esc(e.place) : ''}
      </div>

      ${
        e.equipment
          ? `<p>Equipment: ${esc(e.equipment)}</p>`
          : ''
      }

      ${
        e.reading
          ? `<p>Reading: ${esc(e.reading)}</p>`
          : ''
      }

      ${
        e.question
          ? `<p>Question: ${esc(e.question)}</p>`
          : ''
      }

      ${
        e.description
          ? `<p>${esc(e.description)}</p>`
          : ''
      }
    </div>
  `).join('');
}

function go(p) {
  if (view === 'event') preserveDraft();
  view = p;
  render();
}

function startVisit() {
  const name = (
    $('locationSelect').value ||
    $('newLocation').value
  ).trim();

  if (!name) {
    return alert('Choose or enter a location.');
  }

  let loc = data.locations.find(
    l => l.name.toLowerCase() === name.toLowerCase()
  );

  if (!loc) {
    loc = {
      name,
      prefix: uniquePrefix(name)
    };

    data.locations.push(loc);
  }

  const number =
    data.visits.filter(v => v.location === loc.name).length + 1;

  const v = {
    id: crypto.randomUUID(),
    location: loc.name,
    code: `${loc.prefix}-V${String(number).padStart(4, '0')}`,
    start: now(),
    end: null,
    attendees: [
      ...document.querySelectorAll('.att.selected')
    ].map(x => x.dataset.name).sort(),
    outside: $('outside').value,
    inside: $('inside').value,
    insidePlace: $('insidePlace').value,
    weather: $('weather').value,
    notes: '',
    events: []
  };

  data.visits.push(v);
  data.activeId = v.id;

  save();
  go('log');
}

function pick(type) {
  data.draft = {
    id: crypto.randomUUID(),
    type,
    time: now(),
    people: [],
    place: '',
    description: '',
    equipment: '',
    reading: '',
    question: '',
    editId: null
  };

  save();
  go('event');
}

function preserveDraft() {
  if (view !== 'event' || !data.draft) return;

  const d = data.draft;

  for (const key of [
    'description',
    'place',
    'equipment',
    'reading',
    'question'
  ]) {
    const el = $(key);
    if (el) d[key] = el.value;
  }

  save();
}

function togglePerson(el) {
  el.classList.toggle('selected');

  data.draft.people = [
    ...document.querySelectorAll('.witness.selected')
  ].map(x => x.dataset.name);

  save();
}

function setPlace(s) {
  $('place').value = s;
  preserveDraft();
}

function setQuestion(s) {
  $('question').value = s;
  preserveDraft();
}

function changed(v) {
  if (!v.end) return;

  v.sync = v.sync || {
    version: 0,
    syncedVersion: -1
  };

  v.sync.version = (v.sync.version || 0) + 1;
  v.sync.error = '';
  v.sync.pending = null;
}

function logEvent() {
  preserveDraft();

  const d = data.draft;

  const v = current() ||
    data.visits.find(x => x.id === data.editVisitId);

  if (!d || !v) return;

  const e = {
    ...d,
    people: d.people.length ? d.people : ['Unknown']
  };

  delete e.editId;

  const idx = v.events.findIndex(x => x.id === e.id);

  if (idx >= 0) {
    v.events[idx] = e;
  } else {
    v.events.push(e);
  }

  changed(v);

  data.draft = null;
  data.editVisitId = null;

  save();

  if (v.end) {
    reportId = v.id;
    go('report');
    syncAll();
  } else {
    go('log');
  }
}

function editEvent(id) {
  const v = current() ||
    data.visits.find(
      x => x.events.some(e => e.id === id)
    );

  if (!v) return;

  const e = v.events.find(x => x.id === id);

  data.editVisitId = v.id;

  data.draft = {
    ...e,
    editId: id,
    people: e.people.filter(n => n !== 'Unknown')
  };

  save();
  go('event');
}

function undoLast() {
  const v = current();

  if (!v || !v.events.length) return;

  if (confirm('Remove the last logged event?')) {
    v.events.pop();
    save();
    render();
  }
}

function endVisit() {
  const v = current();

  if (!v) return;

  if (!confirm(
    'End investigation now and record the current time?'
  )) return;

  v.end = now();
  data.activeId = null;

  changed(v);
  save();

  reportId = v.id;
  go('report');

  syncAll();
}

function report(id) {
  reportId = id;
  go('report');
}

function saveNotes() {
  const v = data.visits.find(x => x.id === reportId);

  if (!v) return;

  v.notes = $('notes').value;

  changed(v);
  save();

  notice = 'Notes saved on this device.';

  render();
  syncAll();
}

function saveConnection() {
  const endpoint = $('endpoint').value.trim();

  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(endpoint)) {
    return alert('Enter a valid Apps Script /exec URL.');
  }

  config.endpoint = endpoint;

  const key = $('apiKey').value.trim();

  if (key) config.apiKey = key;

  if (!saveConfig()) return;

  notice = 'Connection saved on this device.';

  go('home');
  syncAll();
}

function ensureSync(v) {
  if (!v.sync) {
    v.sync = {
      version: 1,
      syncedVersion: 0,
      error: '',
      pending: null
    };
  }

  return v.sync;
}

function newToken() {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return [...bytes]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getPending(v) {
  const s = ensureSync(v);

  if (!s.pending || s.pending.version !== s.version) {
    s.pending = {
      requestId: crypto.randomUUID(),
      receiptToken: newToken(),
      version: s.version,
      attempted: false,
      created: Date.now()
    };

    save();
  }

  return s.pending;
}

function checkReceipt(p) {
  return new Promise((resolve, reject) => {
    const callback =
      'scribeReceipt' + Math.random().toString(36).slice(2);

    const script = document.createElement('script');

    let finished = false;

    const finish = (err, result) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      delete window[callback];
      script.remove();

      err ? reject(err) : resolve(result);
    };

    const timeout = setTimeout(
      () => finish(new Error('Receipt lookup timed out')),
      15000
    );

    window[callback] = result => finish(null, result);

    const url = new URL(config.endpoint);

    url.searchParams.set('action', 'receipt');
    url.searchParams.set('requestId', p.requestId);
    url.searchParams.set('receiptToken', p.receiptToken);
    url.searchParams.set('callback', callback);

    script.src = url.toString();

    script.onerror = () =>
      finish(new Error('Receipt lookup failed'));

    document.head.appendChild(script);
  });
}

async function sendUpload(v, p) {
  const payload = {
    action: 'syncInvestigation',
    apiKey: config.apiKey,
    requestId: p.requestId,
    receiptToken: p.receiptToken,
    investigation: v
  };

  await fetch(config.endpoint, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8'
    },
    body: JSON.stringify(payload)
  });

  p.attempted = true;
  save();
}

async function syncOne(id, manual = false) {
  const v = data.visits.find(x => x.id === id);

  if (!v || !v.end) return;

  if (!config.apiKey || !navigator.onLine) {
    if (manual) {
      alert(
        'Save your private key in Google Drive Settings ' +
        'and connect to the internet first.'
      );
    }
    return;
  }

  if (syncing) {
    if (manual) alert('A sync is already running.');
    return;
  }

  syncing = true;

  try {
    const s = ensureSync(v);

    if (s.syncedVersion === s.version) {
      if (manual) {
        alert('This investigation is already confirmed in Google Drive.');
      }
      return;
    }

    const p = getPending(v);

    let receipt = null;

    if (p.attempted) {
      try {
        receipt = await checkReceipt(p);
      } catch (_) {}
    }

    if (!receipt || !receipt.ok) {
      await sendUpload(v, p);

      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(r =>
          setTimeout(r, 1200 + attempt * 700)
        );

        try {
          receipt = await checkReceipt(p);

          if (receipt.ok) break;
        } catch (_) {}
      }
    }

    if (
      receipt &&
      receipt.ok &&
      receipt.uid === v.id
    ) {
      if (s.version === p.version) {
        s.syncedVersion = s.version;
        s.docUrl = receipt.docUrl;
        s.sheetUrl = receipt.sheetUrl;
        s.error = '';
        s.pending = null;

        save();

        notice = 'Google Drive upload confirmed.';
      } else {
        s.error = 'Changed during upload; will retry.';
        save();
      }
    } else {
      s.error =
        'Upload not confirmed. Your local record is safe; ' +
        'retry when online.';

      save();

      if (manual) alert(s.error);
    }
  } catch (e) {
    const s = ensureSync(v);

    s.error = 'Could not confirm upload: ' + e.message;

    save();

    if (manual) alert(s.error);
  } finally {
    syncing = false;
    render();
  }
}

async function syncAll(manual = false) {
  if (!config.apiKey) {
    if (manual) {
      alert('Enter your private API key in Google Drive Settings first.');
    }
    return;
  }

  if (!navigator.onLine) {
    if (manual) {
      alert('You are offline. Records remain saved on this device.');
    }
    return;
  }

  if (syncing) return;

  const pending = data.visits.filter(
    v => v.end &&
      (!v.sync || v.sync.syncedVersion !== v.sync.version)
  );

  if (!pending.length) {
    if (manual) {
      alert('No completed investigations are waiting to sync.');
    }
    return;
  }

  for (const v of pending) {
    await syncOne(v.id, false);
  }

  if (manual) {
    alert(
      'Sync attempt finished. ' +
      'Check each report for its confirmation status.'
    );
  }
}

document.addEventListener('input', e => {
  if (
    view === 'event' &&
    [
      'description',
      'place',
      'equipment',
      'reading',
      'question'
    ].includes(e.target.id)
  ) {
    preserveDraft();
  }
});

window.addEventListener('online', () => syncAll());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

if (current()) {
  view = data.draft ? 'event' : 'log';
}

render();

setTimeout(() => syncAll(), 1800);
