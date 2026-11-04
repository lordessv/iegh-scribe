
'use strict';

/*
 * IEGH Scribe: Direct Google Upload
 *
 * This replaces the failed background upload and
 * receipt polling with a visible Google response.
 *
 * Does not delete or alter saved investigations.
 */

(function () {
  // Always use the known Apps Script deployment.
  config.endpoint = DEFAULT_ENDPOINT;
  saveConfig();

  // Disable automatic background attempts.
  // Uploads now require a deliberate button tap.
  syncAll = async function () {
    return false;
  };

  function submitInvestigation(visit) {
    const pending = getPending(visit);

    const payload = {
      action: 'syncInvestigation',
      apiKey: config.apiKey,
      requestId: pending.requestId,
      receiptToken: pending.receiptToken,
      investigation: visit
    };

    const json = JSON.stringify(payload);

    /*
     * text/plain forms serialize as:
     * fieldName=fieldValue
     *
     * The padding field absorbs the equals sign
     * so the resulting request body is valid JSON.
     */

    const form = document.createElement('form');

    form.method = 'POST';
    form.action = DEFAULT_ENDPOINT;
    form.target = '_blank';
    form.enctype = 'text/plain';
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';

    const field = document.createElement('input');

    field.type = 'hidden';
    field.name =
      json.slice(0, -1) + ',"transportPadding":"';
    field.value = '"}';

    form.appendChild(field);
    document.body.appendChild(form);

    pending.attempted = true;
    pending.lastAttempt = new Date().toISOString();
    save();

    try {
      form.submit();
    } finally {
      form.remove();
    }
  }

  syncOne = function (id, manual = false) {
    const visit = data.visits.find(v => v.id === id);

    if (!visit || !visit.end) {
      alert('This investigation must be completed first.');
      return false;
    }

    if (!config.apiKey) {
      alert(
        'Your Google Drive API key is missing. ' +
        'Open Google Drive Settings.'
      );
      return false;
    }

    if (!navigator.onLine) {
      alert(
        'You are offline. Your investigation is still saved.'
      );
      return false;
    }

    try {
      submitInvestigation(visit);

      notice =
        'Upload submitted. Read the Google response ' +
        'in the newly opened tab.';

      render();
      return true;

    } catch (error) {
      alert(
        'Could not submit upload: ' +
        String(error.message || error)
      );
      return false;
    }
  };

  const originalRender = render;

  render = function () {
    originalRender();

    // Explain that a visible response is required.
    if (view === 'report') {
      const buttons =
        document.querySelectorAll('#app button');

      for (const button of buttons) {
        if (
          button.textContent.trim() ===
          'Sync This Investigation'
        ) {
          button.textContent =
            'Upload to Google Drive (Show Result)';
        }
      }
    }
  };

  render();
})();
