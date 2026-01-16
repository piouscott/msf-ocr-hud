async function mustFetch(url, label) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
    return `${label}: OK (${r.status})`;
  } catch (e) {
    return `${label}: FAIL (${e && e.message ? e.message : e})`;
  }
}
async function toBlobURL(url, mime) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch fail ${url}: ${r.status}`);
  const b = await r.blob();
  return URL.createObjectURL(new Blob([b], { type: mime || b.type }));
}


window.addEventListener("MSF_OCR_START", async (e) => {
  try {
    const cfg = window.__MSF_OCR_CONFIG__;
    // Convertit en blob: pour éviter les soucis moz-extension:// dans Worker
const workerBlob = await toBlobURL(cfg.workerPath, "text/javascript");
const coreWasmBlob = await toBlobURL(cfg.corePath + "tesseract-core.wasm", "application/wasm");
const coreJsBlob = await toBlobURL(cfg.corePath + "tesseract-core.wasm.js", "text/javascript");
const langBlob = await toBlobURL(cfg.langPath + "eng.traineddata", "application/octet-stream");

// Debug HUD
window.dispatchEvent(new CustomEvent("MSF_OCR_RESULT", {
  detail: "BLOBS OK\nworker=" + workerBlob + "\ncore.js=" + coreJsBlob + "\ncore.wasm=" + coreWasmBlob + "\nlang=" + langBlob
}));

    if (!cfg) throw new Error("OCR config manquante côté page (window.__MSF_OCR_CONFIG__).");
    if (!window.Tesseract) throw new Error("Tesseract non chargé dans la page.");

const checks = [];
checks.push(await mustFetch(cfg.workerPath, "workerPath"));
checks.push(await mustFetch(cfg.langPath + "eng.traineddata", "lang eng.traineddata"));

// Core: teste toutes les variantes susceptibles d'être chargées
const coreFiles = [
  "tesseract-core.wasm",
  "tesseract-core-simd.wasm",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm",
  // et les wrappers JS
  "tesseract-core.wasm.js",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js"
];

for (const f of coreFiles) {
  checks.push(await mustFetch(cfg.corePath + f, "core " + f));
}

window.dispatchEvent(new CustomEvent("MSF_OCR_RESULT", {
  detail: "PREFLIGHT\n" + checks.join("\n")
}));

if (checks.some(line => line.includes("FAIL"))) {
  throw new Error("Préflight FAIL: au moins une ressource core est inaccessible (voir HUD).");
}


    const dataUrl = e.detail;

    //const img = new Image();
    //img.src = dataUrl;
    //await img.decode();
    const img = new Image();

    const loaded = new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (err) => reject(new Error("Image load failed (onerror)"));
    });

    // Important: éviter decode(), utiliser onload (plus fiable Firefox)
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      throw new Error("dataUrl invalide (pas un data:image/...)");
    }
    img.src = dataUrl;
    await loaded;

    // sanity check
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error("Image loaded but has 0 size");
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(img.width * 0.35);
    canvas.height = Math.floor(img.height * 0.25);
    canvas.getContext("2d").drawImage(
      img,
      Math.floor(img.width * 0.65), 0,
      canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );

    const worker = await Tesseract.createWorker({
      workerPath: ext.runtime.getURL("lib/tesseract/worker.min.js"),
      langPath: ext.runtime.getURL("lib/tesseract/lang/"),

      // 🔥 v4: corePath = le FICHIER wasm.js (pas un dossier)
      corePath: ext.runtime.getURL("lib/tesseract/core/tesseract-core-simd.wasm.js"),
      // si jamais SIMD pose souci sur ta machine, essaye:
      // corePath: ext.runtime.getURL("lib/tesseract/core/tesseract-core.wasm.js"),

      workerBlobURL: false,
      logger: (m) => console.log("[tesseract]", m)
});

await worker.loadLanguage("eng");
await worker.initialize("eng");



    const { data: { text } } = await worker.recognize(canvas);
    await worker.terminate();

    window.dispatchEvent(new CustomEvent("MSF_OCR_RESULT", { detail: text }));
  } catch (err) {
    console.error("OCR ERROR", err);
    window.dispatchEvent(
      new CustomEvent("MSF_OCR_RESULT", { detail: "OCR ERROR: " + (err?.message || err) })
    );
  }
});
