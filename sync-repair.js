'use strict';

/*
  IEGH Scribe Sync Repair v4

  - Corrects the saved Apps Script endpoint
  - Preserves the private API key
  - Preserves all investigation records
  - Uses a cross-origin HTML form for uploads
  - Requires a Google receipt to confirm success
  - Reports upload failures accurately

  Works with the existing app.js and Code.gs.
*/

(function () {
  const ENDPOINT = DEFAULT_ENDPOINT;

  // Correct any previously saved or mistyped endpoint.
  if (config.endpoint !== ENDPOINT) {
    config.endpoint = ENDPOINT;
    saveConfig();
  }

  let transportError = '';

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /*
    The Apps Script backend expects raw JSON in
    e.postData.contents.

    A text/plain HTML form normally sends name=value.
    We construct the name and value so that the complete
    body is valid JSON, including the inserted equals sign.
  */

  function submitForm(payload) {
    return new Promise((resolve, reject) => {
      const target = 'scribe_' +
        crypto.randomUUID().replace(/-/g, '');

      const frame = document.createElement('iframe');
      frame.name = target;
      frame.style.display = 'none';
      frame.setAttribute('aria-hidden', 'true');

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = ENDPOINT;
      form.target = target;
      form.enctype = 'text/plain';
      form.acceptCharset = 'UTF-8';
      form.style.display = 'none';

      const input = document.createElement('input');
      input.type = 'hidden';

      const json = JSON.stringify(payload);

      if (!json.endsWith('}')) {
        reject(new Error('Could not serialize investigation'));
        return;
      }

      input.name =
        json.slice(0, -1) + ',"transportPadding":"';

      input.value = '"}';

      form.appendChild(input);

      document.body.appendChild(frame);
      document.body.appendChild(form);

      let submitted = false;

      try {
        form.submit();
        submitted = true;
      } catch (error) {
        transportError = String(error.message || error);
      }

      form.remove();

      // Keep the iframe available while Google processes POST.
      setTimeout(() => frame.remove(), 60000);

      if (!submitted) {
        reject(new Error(
          'Browser could not submit upload: ' + transportError
        ));
        return;
      }

      /*
        Submission does not prove Google received it.
        The separate receipt lookup is authoritative.
      */

      resolve();
    });
  }

  // Replace the original opaque fetch upload.
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

    await submitForm(payload);
  };

  // Replace the old sync routine with accurate confirmation.
  syncOne = async function (id, manual = false) {
    const visit = data.visits.find(v => v.id === id);

    if (!visit || !visit.end) return false;

    if (!config.apiKey) {
      if (manual) {
        alert('Google Drive API key is not configured.');
      }
      return false;
    }

    if (!navigator.onLine) {
      if (manual) {
        alert(
          'Your device is offline. ' +
          'The investigation remains saved locally.'
        );
      }
      return false;
    }

    if (syncing) {
      if (manual) {
        alert('An upload is already running.');
      }
      return false;
    }

    syncing = true;

    const s = ensureSync(visit);

    try {
      if (s.syncedVersion === s.version) {
        if (manual) {
          alert(
            'This investigation is already confirmed in Google Drive.'
          );
        }
        return true;
      }

      const pending = getPending(visit);

      let receipt = null;
      let lookupError = '';

      // Check for confirmation from an earlier attempt.
      if (pending.attempted) {
        try {
          receipt = await checkReceipt(pending);
        } catch (error) {
          lookupError = String(error.message || error);
        }
      }

      if (!receipt || !receipt.ok) {
        s.error = 'Submitting investigation to Google...';
        save();
        render();

        await sendUpload(visit, pending);

        // Poll for the backend's processing receipt.
        for (let attempt = 0; attempt < 8; attempt++) {
          await wait(1800 + attempt * 600);

          try {
            receipt = await checkReceipt(pending);

            if (receipt && receipt.ok) {
              break;
            }

            if (receipt && receipt.error) {
              lookupError = String(receipt.error);
            }

          } catch (error) {
            lookupError = String(error.message || error);
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

        save();

        notice = 'Google Drive confirmed this investigation.';

        if (manual) alert(notice);

        return true;
      }

      s.error =
        'Google did not confirm this upload. ' +
        'The investigation is safe on this device.' +
        (lookupError
          ? ' Receipt check: ' + lookupError
          : ' No confirmation receipt was returned.');

      save();

      if (manual) alert(s.error);

      return false;

    } catch (error) {
      s.error =
        'Upload error: ' +
        String(error.message || error);

      save();

      if (manual) alert(s.error);

      return false;

    } finally {
      syncing = false;
      render();
    }
  };

  // Count only investigations actually confirmed by Google.
  syncAll = async function (manual = false) {
    if (!config.apiKey) {
      if (manual) {
        alert('Save your private API key first.');
      }
      return;
    }

    if (!navigator.onLine) {
      if (manual) {
        alert('Offline. Your investigations remain saved locally.');
      }
      return;
    }

    if (syncing) {
      if (manual) {
        alert('An upload is already running.');
      }
      return;
    }

    const visits = data.visits.filter(v =>
      v.end &&
      (!v.sync ||
        v.sync.syncedVersion !== v.sync.version)
    );

    if (!visits.length) {
      if (manual) {
        alert('No investigations are waiting to sync.');
      }
      return;
    }

    let confirmed = 0;

    for (const visit of visits) {
      if (await syncOne(visit.id, false)) {
        confirmed++;
      }
    }

    notice =
      confirmed + ' of ' + visits.length +
      ' pending investigation(s) confirmed in Google Drive.';

    render();

    if (manual) {
      alert(notice);
    }
  };

  // Fix the misleading home-screen connection label.
  const originalRender = render;

  render = function () {
    originalRender();

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
          (navigator.onLine
            ? 'Internet available.'
            : 'Currently offline.') +
          ' Uploads require Google confirmation.';
      }
    }
  };

  render();

  console.info(
    'IEGH Scribe Sync Repair v4 loaded. ' +
    'Endpoint: ' + ENDPOINT
  );
})();
