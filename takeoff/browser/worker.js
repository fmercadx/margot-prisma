// Runs Python off the main thread, so the page stays responsive while a heavy
// sheet is read (one test sheet has 150,000 strokes).
//
// Everything is fetched from this origin: the Pyodide runtime and its numpy,
// cryptography and charset-normalizer wheels sit in ./pyodide/, and
// takeoff.zip holds pdfminer, pdfplumber, openpyxl and the takeoff modules.
// A drawing set never leaves the machine, and neither does the fact that
// someone opened one.

import { loadPyodide } from "./pyodide/pyodide.mjs";

let engine = null;

const ready = (async () => {
  const py = await loadPyodide({ indexURL: new URL("./pyodide/", import.meta.url).href });
  await py.loadPackage(["numpy", "cryptography", "charset-normalizer"], { messageCallback: () => {} });
  const zip = await (await fetch(new URL("./takeoff.zip", import.meta.url))).arrayBuffer();
  py.unpackArchive(zip, "zip", { extractDir: "/lib/takeoff" });
  py.runPython("import sys; sys.path.insert(0, '/lib/takeoff')");
  engine = py.pyimport("engine");
})();

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    await ready;
    let result = engine[op](...(args || []));
    if (result && typeof result.toJs === "function") {
      const js = result.toJs();      // bytes -> Uint8Array
      result.destroy();
      result = js;
    }
    self.postMessage({ id, result }, result instanceof Uint8Array ? [result.buffer] : []);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};

ready.then(
  () => self.postMessage({ id: 0, result: "ready" }),
  (err) => self.postMessage({ id: 0, error: String(err && err.message || err) }),
);
