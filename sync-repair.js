'use strict';
/* IEGH Scribe sync transport and status repair.
   Load AFTER app.js. Does not change or clear stored investigations. */

const scribeWait = ms => new Promise(resolve => setTimeout(resolve, ms));

function scribeTransport(payload) {
  const body = JSON.stringify(payload);
  // sendBeacon uses a simple cross-origin POST, without a CORS response requirement.
  if (typeof navigator.sendBeacon === 'function') {
    try {
      const queued = navigator.sendBeacon(
        config.endpoint,
        new Blob([body], { type: 'text/plain;charset=UTF-8' })
      );
      if (queued) return Promise.resolve('beacon queued');
    } catch (_) { /* Try fetch below. */ }
  }
  return fetch(config.endpoint, {
    method: 'POST',
    mode: 'no-cors',
    credentials: 'omit',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body
  }).then(() => 'fetch dispatched');
}

sendUpload = async function (visit, pending) {
  const payload = {
    action: 'syncInvestigation',
    apiKey: config.apiKey,
    requestId: pending.requestId,
    receiptToken: pending.receiptToken,
    investigation: visit
  };
  pending.attempted = true;
  pending.lastAttempt = new Date().toISOString();
  save();
  const transport = await scribeTransport(payload);
  pending.transport = transport;
  save();
};

syncOne = async function (id, manual = false) {
  const visit = data.visits.find(v => v.id === id);
  if (!visit || !visit.end) return false;
  if (!config.apiKey || !navigator.onLine) {
    if (manual) alert('Google Drive is not configured or the device is offline. Your records are safe.');
    return false;
  }
  if (syncing) {
    if (manual) alert('A sync is already in progress.');
    return false;
  }
  syncing = true;
  const s = ensureSync(visit);
  try {
    if (s.syncedVersion === s.version) {
      if (manual) alert('This investigation is already confirmed in Google Drive.');
      return true;
    }
    const p = getPending(visit);
    let receipt = null;
    // Check for a receipt from a previous attempt before resending.
    if (p.attempted) {
      try { receipt = await checkReceipt(p); } catch (_) { /* Retry upload. */ }
    }
    if (!receipt || !receipt.ok) {
      s.error = 'Sending investigation to Google Drive...';
      save(); render();
      await sendUpload(visit, p);
      for (let i = 0; i < 6; i++) {
        await scribeWait(1200 + i * 700);
        try {
          receipt = await checkReceipt(p);
          if (receipt && receipt.ok) break;
          if (receipt && receipt.error) {
            throw new Error(receipt.error);
          }
        } catch (err) {
          if (receipt && receipt.error) throw err;
        }
      }
    }
    if (receipt && receipt.ok && receipt.uid === visit.id && s.version === p.version) {
      s.syncedVersion = s.version;
      s.docUrl = receipt.docUrl;
      s.sheetUrl = receipt.sheetUrl;
      s.error = '';
      s.pending = null;
      notice = 'Google Drive confirmed this investigation. Google Doc and Sheet links are available in its report.';
      save();
      if (manual) alert(notice);
      return true;
    }
    s.error = receipt && receipt.error
      ? 'Google Drive rejected the upload: ' + receipt.error
      : 'Upload was sent, but Google did not return a confirmation receipt. Check Apps Script Executions for doPost. Your local investigation is safe.';
    save();
    if (manual) alert(s.error);
    return false;
  } catch (err) {
    s.error = 'Upload failed: ' + (err && err.message ? err.message : String(err));
    save();
    if (manual) alert(s.error);
    return false;
  } finally {
    syncing = false;
    render();
  }
};

syncAll = async function (manual = false) {
  if (!config.apiKey) {
    if (manual) alert('Your private API key is not saved on this device.');
    return;
  }
  if (!navigator.onLine) {
    if (manual) alert('Offline. Your investigation records remain on this device.');
    return;
  }
  if (syncing) {
    if (manual) alert('A sync is already in progress.');
    return;
  }
  const pending = data.visits.filter(v => v.end &&
    (!v.sync || v.sync.syncedVersion !== v.sync.version));
  if (!pending.length) {
    if (manual) alert('No completed investigations are waiting to sync.');
    return;
  }
  let confirmed = 0;
  for (const v of pending) {
    if (await syncOne(v.id, false)) confirmed++;
  }
  notice = `${confirmed} of ${pending.length} investigation(s) confirmed in Google Drive.`;
  render();
  if (manual) {
    alert(confirmed === pending.length
      ? notice
      : notice + ' Open Previous Investigations, then View Report to see the error for each unconfirmed investigation.');
  }
};

// Replace the ambiguous connection copy without changing local data.
const scribeOriginalRender = render;
render = function () {
  scribeOriginalRender();
  const localBadge = document.querySelector('body > .row .status');
  if (localBadge) localBadge.textContent = '● DEVICE STORAGE';
  if (view === 'home') {
    const paragraphs = document.querySelectorAll('#app p.muted');
    for (const p of paragraphs) {
      if (p.textContent.includes('Google Drive connection configured')) {
        p.textContent = 'Google Drive settings saved. Uploads are only confirmed when a completed report says "Confirmed in Google Drive". ' +
          (navigator.onLine ? 'Internet available.' : 'Device offline.');
      }
    }
  }
};
render();
