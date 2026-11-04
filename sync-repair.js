
'use strict';

/*
  IEGH Scribe synchronization repair v3

  Uses an HTML form POST instead of fetch/sendBeacon.
  Keeps the existing Google Apps Script JSON doPost format.
  Requires the existing app.js and Code.gs.

  Does not clear localStorage or delete investigations.
*/

const scribeWait = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function scribeTransport(payload) {
  return new Promise((resolve, reject) => {
    const requestId = 'scribe_upload_' +
      Math.random().toString(36).slice(2);

    const iframe = document.createElement('iframe');
    iframe.name = requestId;
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = config.endpoint;
    form.target = requestId;
    form.enctype = 'text/plain';
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';

    /*
      A text/plain form sends:

        fieldName=fieldValue

      Construct a JSON object where the inserted "="
      becomes the value of an unused padding property.

      Apps Script can then parse e.postData.contents
      with JSON.parse, just as before.
    */

    const field = document.createElement('input');
    field.type = 'hidden';

    const json = JSON.stringify(payload);

    if (!json.endsWith('}')) {
      reject(new Error('Invalid upload payload'));
      return;
    }

    field.name = json.slice(0, -1) +
      ',"transportPadding":"';

    field.value = '"}';

    form.appendChild(field);

    let finished = false;

    const cleanup = () => {
      setTimeout(() => {
        form.remove();
        iframe.remove();
      }, 30000);
    };

    const finish = (error) => {
      if (finished) return;
      finished = true;

      if (error) {
        cleanup();
        reject(error);
      } else {
        cleanup();
        resolve('form POST submitted');
      }
    };

    document.body.appendChild(iframe);
    document.body.appendChild(form);

    try {
      form.submit();

      /*
        Cross-origin iframe contents cannot be read.
        Submission is NOT proof of success.

        The existing receipt system checks whether
        Google actually processed the investigation.
      */

      setTimeout(() => finish(null), 1200);

    } catch (error) {
      finish(error);
    }
  });
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

  pending.transport = await scribeTransport(payload);

  save();
};

syncOne = async function (id, manual = false) {
  const visit = data.visits.find(v => v.id === id);

  if (!visit || !visit.end) return false;

  if (!config.apiKey || !navigator.onLine) {
    if (manual) {
      alert(
        'Google Drive is not configured or the device is offline. ' +
        'Your investigation remains saved locally.'
      );
    }
    return false;
  }

  if (syncing) {
    if (manual) alert('A sync is already running.');
    return false;
  }

  syncing = true;

  const s = ensureSync(visit);

  try {
    if (s.syncedVersion === s.version) {
      if (manual) {
        alert('This investigation is already confirmed in Google Drive.');
      }
      return true;
    }

    const pending = getPending(visit);

    let receipt = null;

    // First check whether an earlier upload succeeded.
    if (pending.attempted) {
      try {
        receipt = await checkReceipt(pending);
      } catch (_) {
        // No receipt yet.
      }
    }

    if (!receipt || !receipt.ok) {
      s.error = 'Submitting investigation to Google...';

      save();
      render();

      await sendUpload(visit, pending);

      // Wait for Google to process the submission.
      for (let attempt = 0; attempt < 8; attempt++) {
        await scribeWait(1500 + attempt * 700);

        try {
          receipt = await checkReceipt(pending);

          if (receipt && receipt.ok) break;

          if (receipt && receipt.error) {
            throw new Error(receipt.error);
          }

        } catch (error) {
          if (receipt && receipt.error) {
            throw error;
          }
        }
      }
    }

    if (
      receipt &&
      receipt.ok &&
      receipt.uid === visit.id &&
      s.version === pending.version
    ) {
      s.syncedVersion = s.version;
      s.docUrl = receipt.docUrl;
      s.sheetUrl = receipt.sheetUrl;
      s.error = '';
      s.pending = null;

      notice = 'Google Drive confirmed this investigation.';

      save();

      if (manual) alert(notice);

      return true;
    }

    s.error =
      'Google has not confirmed this upload. ' +
      'Check Apps Script Executions for doPost. ' +
      'Your investigation is still saved on this device.';

    save();

    if (manual) alert(s.error);

    return false;

  } catch (error) {
    s.error = 'Upload failed: ' +
      (error && error.message ? error.message : String(error));

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
    if (manual) {
      alert('Your private Google Drive API key is not saved.');
    }
    return;
  }

  if (!navigator.onLine) {
    if (manual) {
      alert('You are offline. Your records remain saved locally.');
    }
    return;
  }

  if (syncing) {
    if (manual) alert('A sync is already running.');
    return;
  }

  const pending = data.visits.filter(v =>
    v.end &&
    (!v.sync || v.sync.syncedVersion !== v.sync.version)
  );

  if (!pending.length) {
    if (manual) {
      alert('No completed investigations are waiting to sync.');
    }
    return;
  }

  let confirmed = 0;

  for (const visit of pending) {
    if (await syncOne(visit.id, false)) {
      confirmed++;
    }
  }

  notice =
    confirmed + ' of ' + pending.length +
    ' investigation(s) confirmed to Google Drive.';

  render();

  if (manual) {
    alert(
      notice +
      (confirmed === pending.length
        ? ''
        : ' Check the individual report for its upload status.')
    );
  }
};

// Improve the status wording without modifying stored data.

const scribeOriginalRender = render;

render = function () {
  scribeOriginalRender();

  const localBadge =
    document.querySelector('body > .row .status');

  if (localBadge) {
    localBadge.textContent = 'DEVICE STORAGE';
  }

  if (view === 'home') {
    const paragraphs =
      document.querySelectorAll('#app p.muted');

    for (const p of paragraphs) {
      if (
        p.textContent.includes(
          'Google Drive connection configured'
        )
      ) {
        p.textContent =
          'Google Drive settings saved. ' +
          'Uploads require confirmation from Google. ' +
          (navigator.onLine
            ? 'Internet available.'
            : 'Device offline.');
      }
    }
  }
};

render();
