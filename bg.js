const ext = typeof browser !== "undefined" ? browser : chrome;

// ============================================
// AUTO-CAPTURE DU TOKEN MSF
// ============================================

// Intercepter les requêtes vers l'API MSF pour capturer le token Bearer
ext.webRequest.onBeforeSendHeaders.addListener(
  async (details) => {
    const authHeader = details.requestHeaders.find(
      h => h.name.toLowerCase() === "authorization"
    );

    if (authHeader && authHeader.value.startsWith("Bearer ")) {
      const token = authHeader.value;

      // Récupérer le token actuel pour comparer
      const stored = await ext.storage.local.get(["msfApiToken", "msfTokenCapturedAt"]);

      // Ne sauvegarder que si c'est un nouveau token
      if (stored.msfApiToken !== token) {
        await ext.storage.local.set({
          msfApiToken: token,
          msfTokenCapturedAt: new Date().toISOString(),
          msfTokenAutoCapture: true
        });
        console.log("[BG] Token MSF auto-capturé!");
      }
    }
  },
  { urls: ["*://api.marvelstrikeforce.com/*"] },
  ["requestHeaders", "extraHeaders"]
);

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

  if (msg.type === "MSF_SYNC_COUNTERS") {
    handleSyncCounters(msg.url).then(sendResponse).catch(e => {
      sendResponse({ success: false, message: e.message });
    });
    return true;
  }

  if (msg.type === "MSF_START_PORTRAIT_CAPTURE") {
    handlePortraitCapture(msg.count || 5).then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  }

  // Relayer les portraits captures du content script vers le popup
  if (msg.type === "MSF_PORTRAITS_CAPTURED") {
    // Broadcast to all extension pages (popup)
    ext.runtime.sendMessage(msg);
    sendResponse({ relayed: true });
    return true;
  }

  // Capture l'onglet visible pour le scan barracks
  if (msg.type === "MSF_CAPTURE_TAB") {
    handleCaptureTab().then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  }

  // Lancer la calibration barracks
  if (msg.type === "MSF_CALIBRATE_BARRACKS") {
    handleBarracksCommand("MSF_CALIBRATE_BARRACKS").then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  }

  // Afficher les boutons de scan barracks
  if (msg.type === "MSF_SHOW_BARRACKS_SCAN") {
    handleBarracksCommand("MSF_SHOW_BARRACKS_SCAN").then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  }

  // Mode scan par clic
  if (msg.type === "MSF_START_CLICK_SCAN") {
    handleBarracksCommand("MSF_START_CLICK_SCAN").then(sendResponse).catch(e => {
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

/**
 * Lance la capture de portraits en guerre
 */
async function handlePortraitCapture(count) {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    throw new Error("Aucun onglet actif");
  }

  // Capturer le screenshot
  const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: "png" });

  // Envoyer au content script pour lancer le mode de selection
  await ext.tabs.sendMessage(tab.id, {
    action: "startPortraitCapture",
    dataUrl: dataUrl,
    count: count
  });

  return { success: true };
}

/**
 * Synchronise les counters depuis une URL distante
 */
async function handleSyncCounters(url) {
  try {
    const response = await fetch(url, {
      cache: "no-cache",
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Valider le format
    if (!data.counters || typeof data.counters !== "object") {
      throw new Error("Format invalide: 'counters' manquant");
    }

    // Sauvegarder avec metadata
    const remoteData = {
      counters: data.counters,
      version: data.version || 1,
      syncedAt: new Date().toISOString(),
      sourceUrl: url
    };

    await ext.storage.local.set({ msfRemoteCounters: remoteData });

    const teamCount = Object.keys(data.counters).length;
    console.log(`[BG] Sync remote: ${teamCount} equipes depuis ${url}`);

    return {
      success: true,
      message: `${teamCount} equipes synchronisees`,
      count: teamCount
    };
  } catch (e) {
    console.error("[BG] Erreur sync remote:", e);
    return {
      success: false,
      message: e.message,
      count: 0
    };
  }
}

/**
 * Capture l'onglet visible et retourne le dataUrl
 */
async function handleCaptureTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    throw new Error("Aucun onglet actif");
  }

  const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { dataUrl };
}

/**
 * Envoie une commande barracks au content script
 */
async function handleBarracksCommand(type) {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    throw new Error("Aucun onglet actif");
  }

  await ext.tabs.sendMessage(tab.id, { type });
  return { success: true };
}