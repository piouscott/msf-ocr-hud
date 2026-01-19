const ext = typeof browser !== "undefined" ? browser : chrome;

async function sendToAllFrames(tabId, message) {
  // Recupere la liste des frames
  const frames = await ext.webNavigation.getAllFrames({ tabId });

  // Filtre uniquement les frames du jeu
  const targets = frames.filter(f => (f.url || "").includes("webplayable.m3.scopelypv.com"));

  // Envoie le message a chaque frame ciblee
  await Promise.all(
    targets.map(f =>
      ext.tabs.sendMessage(tabId, message, { frameId: f.frameId }).catch(() => null)
    )
  );
}

// Handler pour les messages du popup
ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "MSF_ANALYZE_REQUEST") {
    handleAnalyzeRequest().then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true; // Reponse asynchrone
  }

  if (msg.type === "MSF_START_CALIBRATOR") {
    handleStartCalibrator(msg).then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  }
});

async function handleAnalyzeRequest() {
  // 1. Recuperer l'onglet actif
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    throw new Error("Aucun onglet actif");
  }

  // 2. Capturer screenshot
  const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: "png" });

  console.log("[BG] Screenshot capture, envoi au content script...");

  // 3. Envoyer au content script pour extraction
  try {
    const result = await ext.tabs.sendMessage(tab.id, {
      type: "MSF_EXTRACT",
      dataUrl
    });

    console.log("[BG] Resultat recu:", result);
    return result;
  } catch (e) {
    // Si erreur, essayer les frames MSF
    const frames = await ext.webNavigation.getAllFrames({ tabId: tab.id });
    const targets = frames.filter(f => (f.url || "").includes("webplayable.m3.scopelypv.com"));

    if (targets.length > 0) {
      const result = await ext.tabs.sendMessage(tab.id, {
        type: "MSF_EXTRACT",
        dataUrl
      }, { frameId: targets[0].frameId });
      return result;
    }

    throw new Error("Content script non accessible: " + e.message);
  }
}

async function handleStartCalibrator(msg) {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    throw new Error("Aucun onglet actif");
  }

  await ext.tabs.sendMessage(tab.id, {
    action: "startCalibrator",
    label: msg.label || "CROP",
    showGrid: msg.showGrid || false
  });

  return { success: true };
}

// Ancien handler pour clic direct (backup si pas de popup)
ext.browserAction.onClicked.addListener(async (tab) => {
  try {
    const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: "png" });

    await sendToAllFrames(tab.id, { type: "MSF_SCREENSHOT", dataUrl });

    console.log("[BG] Screenshot envoye a toutes les frames");
  } catch (e) {
    console.error("[BG] Erreur:", e);
  }
});