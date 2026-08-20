/* The browser implementation of the host shell.
 *
 * `app.js` runs unchanged on the web and inside the mobile app. Everything
 * that differs between the two — how a report gets to the user, whether there
 * is a subscription gate, whether past reports are kept — lives behind this
 * one object, and each host provides its own version of it.
 *
 * On the web there is no gate: the page is a public demo, findings are the
 * findings, and there is nothing to unlock. Deliverables are blob downloads,
 * and nothing is retained after the tab closes. That last part is the product,
 * so this file stays as boring as it looks.
 */

window.Shell = (() => {
  let blobUrls = [];

  function revoke() {
    blobUrls.forEach(URL.revokeObjectURL);
    blobUrls = [];
  }

  return {
    isNative: false,

    /** Nothing to unlock on the public page. */
    async start() { return true; },

    /** Wire the download buttons to blob URLs. */
    async offerDeliverables({ ref, html, json }) {
      revoke();
      const hUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const jUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      blobUrls.push(hUrl, jUrl);

      const report = document.getElementById('dlReport');
      report.href = hUrl;
      report.download = `${ref}.html`;
      document.getElementById('openReport').href = hUrl;

      const findings = document.getElementById('dlJson');
      findings.href = jUrl;
      findings.download = `${ref}-findings.json`;
    },

    /** Called on reset, and before each new run. */
    release() { revoke(); },
  };
})();
