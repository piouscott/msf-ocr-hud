const ext = typeof browser !== "undefined" ? browser : chrome;
const isFirefox = typeof browser !== "undefined";

// ============================================
// CONFIGURATION OAUTH MSF
// ============================================

const MSF_OAUTH = {
  clientId: "6ff39dae-e1ec-46f0-bcff-c8f2a9d50b4f",
  clientSecret: "zJ~2rov.SnpRkGnDWhFUqFM-u0",
  tokenUrl: "https://hydra-public.prod.m3.scopelypv.com/oauth2/token",
  apiKey: "17wMKJLRxy3pYDCKG5ciP7VSU45OVumB2biCzzgw"
};

/**
 * Rafraîchit le token OAuth en utilisant le refresh_token
 */
async function refreshOAuthToken() {
  const stored = await ext.storage.local.get(["msfRefreshToken"]);

  if (!stored.msfRefreshToken) {
    throw new Error("Pas de refresh token disponible");
  }

  const credentials = btoa(`${MSF_OAUTH.clientId}:${MSF_OAUTH.clientSecret}`);

  const response = await fetch(MSF_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(stored.msfRefreshToken)}`
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error_description || `Erreur refresh: ${response.status}`);
  }

  const data = await response.json();

  // Sauvegarder les nouveaux tokens
  await ext.storage.local.set({
    msfApiToken: data.access_token,
    msfRefreshToken: data.refresh_token,
    msfTokenType: "oauth",
    msfTokenExpiresAt: Date.now() + (data.expires_in * 1000),
    msfTokenRefreshedAt: new Date().toISOString()
  });

  console.log("[BG] Token OAuth rafraîchi avec succès");
  return data.access_token;
}

/**
 * Obtient un token valide (rafraîchit si nécessaire)
 */
async function getValidToken() {
  const stored = await ext.storage.local.get([
    "msfApiToken",
    "msfTokenType",
    "msfTokenExpiresAt",
    "msfRefreshToken"
  ]);

  // Si on a un token OAuth, vérifier s'il est expiré
  if (stored.msfTokenType === "oauth" && stored.msfRefreshToken) {
    const expiresAt = stored.msfTokenExpiresAt || 0;
    const now = Date.now();

    // Rafraîchir si expiré ou expire dans moins de 5 minutes
    if (now >= expiresAt - 300000) {
      console.log("[BG] Token OAuth expiré, rafraîchissement...");
      try {
        return await refreshOAuthToken();
      } catch (e) {
        console.error("[BG] Erreur refresh token:", e);
        throw new Error("Token expiré. Reconnectez-vous via OAuth.");
      }
    }
  }

  if (!stored.msfApiToken) {
    throw new Error("Pas de token disponible");
  }

  return stored.msfApiToken;
}

// ============================================
// AUTO-CAPTURE DU TOKEN MSF
// ============================================

// Intercepter les requêtes vers l'API MSF pour capturer le token
// Note: extraHeaders est Chrome-only, Firefox n'en a pas besoin
const webRequestOptions = isFirefox
  ? ["requestHeaders"]
  : ["requestHeaders", "extraHeaders"];

// URLs de l'API MSF (version web utilise api-prod)
const msfApiUrls = [
  "*://api.marvelstrikeforce.com/*",
  "*://api-prod.marvelstrikeforce.com/*"
];

ext.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Chercher x-titan-token (utilisé par la version web)
    const titanToken = details.requestHeaders.find(
      h => h.name.toLowerCase() === "x-titan-token"
    );

    // Ou chercher Authorization Bearer (utilisé par l'API publique)
    const authHeader = details.requestHeaders.find(
      h => h.name.toLowerCase() === "authorization"
    );

    let tokenToSave = null;
    let tokenType = null;

    if (titanToken && titanToken.value) {
      tokenToSave = titanToken.value;
      tokenType = "titan";
      console.log("[BG] x-titan-token détecté sur:", details.url);
    } else if (authHeader && authHeader.value.startsWith("Bearer ")) {
      tokenToSave = authHeader.value;
      tokenType = "bearer";
      console.log("[BG] Bearer token détecté sur:", details.url);
    }

    if (tokenToSave) {
      // Sauvegarder le token (async dans un IIFE pour ne pas bloquer)
      (async () => {
        const stored = await ext.storage.local.get(["msfApiToken", "msfTokenType"]);
        if (stored.msfApiToken !== tokenToSave) {
          await ext.storage.local.set({
            msfApiToken: tokenToSave,
            msfTokenType: tokenType,
            msfTokenCapturedAt: new Date().toISOString(),
            msfTokenAutoCapture: true
          });
          console.log("[BG] Token MSF auto-capturé! Type:", tokenType);
        }
      })();
    }
  },
  { urls: msfApiUrls },
  webRequestOptions
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

// ============================================
// AUTO-DETECTION DES TOKENS OAUTH (callback)
// ============================================

// Écouter quand la page callback est chargée
ext.webNavigation.onCompleted.addListener(async (details) => {
  if (details.url.includes("piouscott.github.io/msf-ocr-hud/callback.html")) {
    console.log("[BG] Page callback détectée, tentative de récupération des tokens...");

    // Attendre un peu que la page traite les tokens
    await new Promise(r => setTimeout(r, 2000));

    try {
      // Injecter un script pour lire localStorage
      const results = await ext.scripting.executeScript({
        target: { tabId: details.tabId },
        func: () => {
          const data = localStorage.getItem("msf_oauth_tokens");
          if (data) {
            localStorage.removeItem("msf_oauth_tokens"); // Nettoyer après lecture
            return JSON.parse(data);
          }
          return null;
        }
      });

      if (results && results[0] && results[0].result) {
        const tokenData = results[0].result;
        console.log("[BG] Tokens OAuth récupérés depuis callback!");

        // Sauvegarder les tokens
        await ext.storage.local.set({
          msfApiToken: tokenData.accessToken,
          msfRefreshToken: tokenData.refreshToken,
          msfTokenType: "oauth",
          msfTokenExpiresAt: Date.now() + (tokenData.expiresIn * 1000),
          msfTokenSavedAt: new Date().toISOString()
        });

        console.log("[BG] Tokens OAuth sauvegardés avec succès!");

        // Notifier l'utilisateur (optionnel: injecter un message dans la page)
        await ext.scripting.executeScript({
          target: { tabId: details.tabId },
          func: () => {
            const resultEl = document.getElementById("result");
            if (resultEl) {
              const successDiv = document.createElement("div");
              successDiv.innerHTML = '<p style="color:#51cf66;font-weight:bold;margin-top:20px;">✓ Extension mise à jour automatiquement !</p><p style="color:#aaa;">Vous pouvez fermer cette page.</p>';
              resultEl.appendChild(successDiv);
            }
          }
        });
      }
    } catch (e) {
      console.error("[BG] Erreur récupération tokens callback:", e);
    }
  }
}, { url: [{ hostContains: "piouscott.github.io" }] });

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

  // Récupérer les squads du joueur
  if (msg.type === "MSF_GET_SQUADS") {
    handleGetSquads().then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  }

  // Récupérer le roster complet du joueur
  if (msg.type === "MSF_GET_ROSTER") {
    handleGetRoster().then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  }

  // Debug: vérifier le token capturé
  if (msg.type === "MSF_CHECK_TOKEN") {
    ext.storage.local.get(["msfApiToken", "msfTokenCapturedAt", "msfTokenAutoCapture", "msfTokenType", "msfTokenExpiresAt", "msfRefreshToken"]).then(stored => {
      sendResponse({
        hasToken: !!stored.msfApiToken,
        tokenPreview: stored.msfApiToken ? stored.msfApiToken.substring(0, 30) + "..." : null,
        tokenType: stored.msfTokenType || "unknown",
        capturedAt: stored.msfTokenCapturedAt,
        autoCapture: stored.msfTokenAutoCapture,
        expiresAt: stored.msfTokenExpiresAt,
        hasRefreshToken: !!stored.msfRefreshToken
      });
    });
    return true;
  }

  // Sauvegarder les tokens OAuth (après login)
  if (msg.type === "MSF_SAVE_OAUTH_TOKENS") {
    ext.storage.local.set({
      msfApiToken: msg.accessToken,
      msfRefreshToken: msg.refreshToken,
      msfTokenType: "oauth",
      msfTokenExpiresAt: Date.now() + (msg.expiresIn * 1000),
      msfTokenSavedAt: new Date().toISOString()
    }).then(() => {
      console.log("[BG] Tokens OAuth sauvegardés");
      sendResponse({ success: true });
    });
    return true;
  }

  // Rafraîchir le token OAuth manuellement
  if (msg.type === "MSF_REFRESH_TOKEN") {
    refreshOAuthToken().then(token => {
      sendResponse({ success: true, tokenPreview: token.substring(0, 30) + "..." });
    }).catch(e => {
      sendResponse({ success: false, error: e.message });
    });
    return true;
  }

  // Obtenir les infos OAuth pour le login
  if (msg.type === "MSF_GET_OAUTH_CONFIG") {
    sendResponse({
      clientId: MSF_OAUTH.clientId,
      authUrl: "https://hydra-public.prod.m3.scopelypv.com/oauth2/auth",
      redirectUri: "https://piouscott.github.io/msf-ocr-hud/callback.html",
      scopes: "openid offline m3p.f.pr.pro m3p.f.pr.ros m3p.f.pr.inv m3p.f.pr.act m3p.f.ar.pro"
    });
    return true;
  }

  // Récupérer les events en cours
  if (msg.type === "MSF_GET_EVENTS") {
    handleGetEvents().then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  }
});

/**
 * Récupère les events en cours via l'API MSF publique
 */
async function handleGetEvents() {
  const token = await getValidToken();

  const url = "https://api.marvelstrikeforce.com/game/v1/events";
  const headers = {
    "x-api-key": MSF_OAUTH.apiKey,
    "Authorization": token.startsWith("Bearer ") ? token : `Bearer ${token}`,
    "Accept": "application/json"
  };

  console.log("[BG] Appel API events avec OAuth token");

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[BG] Erreur events:", response.status, errorText);

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Accès refusé (${response.status}). Token OAuth requis.`);
    }
    throw new Error(`Erreur API: ${response.status}`);
  }

  const data = await response.json();
  console.log("[BG] Events récupérés:", data);

  return {
    success: true,
    events: data.data || data,
    raw: data
  };
}

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
    console.log("[BG] Erreur premier essai:", e.message);

    // Essayer d'injecter le content script dynamiquement
    try {
      console.log("[BG] Tentative injection dynamique...");
      await ext.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["lib/tesseract/tesseract.min.js", "content.js"]
      });

      // Attendre un peu que le script s'initialise
      await new Promise(r => setTimeout(r, 500));

      // Réessayer
      const result = await ext.tabs.sendMessage(tab.id, {
        type: "MSF_EXTRACT",
        dataUrl
      });
      console.log("[BG] Resultat apres injection:", result);
      return result;
    } catch (e2) {
      console.log("[BG] Erreur injection:", e2.message);
    }

    // Si erreur, essayer les frames MSF
    const frames = await ext.webNavigation.getAllFrames({ tabId: tab.id });
    const targets = frames.filter(f => (f.url || "").includes("webplayable.m3.scopelypv.com"));

    if (targets.length > 0) {
      try {
        // Injecter dans l'iframe specifique
        await ext.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [targets[0].frameId] },
          files: ["lib/tesseract/tesseract.min.js", "content.js"]
        });
        await new Promise(r => setTimeout(r, 500));
      } catch (e3) {
        console.log("[BG] Injection iframe echouee:", e3.message);
      }

      const result = await ext.tabs.sendMessage(tab.id, {
        type: "MSF_EXTRACT",
        dataUrl
      }, { frameId: targets[0].frameId });
      return result;
    }

    throw new Error("Content script non accessible. Rechargez la page (F5) et reessayez.");
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

/**
 * Récupère les squads du joueur via l'API MSF
 */
async function handleGetSquads() {
  const stored = await ext.storage.local.get(["msfApiToken", "msfTokenType"]);

  if (!stored.msfApiToken) {
    throw new Error("Token non disponible. Jouez sur la version web pour capturer le token.");
  }

  // Utiliser l'API appropriée selon le type de token
  let url, headers;

  if (stored.msfTokenType === "titan") {
    // API web (api-prod) avec x-titan-token
    url = "https://api-prod.marvelstrikeforce.com/services/api/squads";
    headers = {
      "x-titan-token": stored.msfApiToken,
      "x-app-version": "9.6.0-hp2",
      "Accept": "application/json"
    };
  } else {
    // API publique avec Bearer token
    const MSF_API_KEY = "17wMKJLRxy3pYDCKG5ciP7VSU45OVumB2biCzzgw";
    url = "https://api.marvelstrikeforce.com/player/v1/squads";
    headers = {
      "x-api-key": MSF_API_KEY,
      "Authorization": stored.msfApiToken.startsWith("Bearer ") ? stored.msfApiToken : `Bearer ${stored.msfApiToken}`,
      "Accept": "application/json"
    };
  }

  console.log("[BG] Appel API squads:", url, "Type:", stored.msfTokenType);

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Token expiré. Rejouez sur la version web.");
    }
    throw new Error(`Erreur API: ${response.status}`);
  }

  const data = await response.json();
  console.log("[BG] Squads récupérés:", data);

  // Format différent selon l'API
  if (stored.msfTokenType === "titan") {
    // L'API web retourne directement les squads
    return {
      success: true,
      squads: data.squads || data,
      raw: data
    };
  } else {
    // L'API publique retourne { tabs: {...}, maxSquads: N }
    // ou parfois { data: { tabs: {...} } }
    const tabs = data.tabs || data.data?.tabs || {};
    const maxSquads = data.maxSquads || data.data?.maxSquads || 0;
    return {
      success: true,
      squads: tabs,
      maxSquads: maxSquads
    };
  }
}

/**
 * Récupère le roster complet du joueur (tous les personnages possédés)
 */
async function handleGetRoster() {
  const stored = await ext.storage.local.get(["msfApiToken", "msfTokenType"]);

  if (!stored.msfApiToken) {
    throw new Error("Token non disponible. Jouez sur la version web pour capturer le token.");
  }

  // Seule l'API web (titan) supporte getPlayerRoster
  if (stored.msfTokenType !== "titan") {
    throw new Error("getPlayerRoster nécessite le x-titan-token (version web)");
  }

  const url = "https://api-prod.marvelstrikeforce.com/services/api/getPlayerRoster";
  const headers = {
    "x-titan-token": stored.msfApiToken,
    "x-app-version": "9.6.0-hp2",
    "Accept": "application/json"
  };

  console.log("[BG] Appel API getPlayerRoster");

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Token expiré. Rejouez sur la version web.");
    }
    throw new Error(`Erreur API: ${response.status}`);
  }

  const data = await response.json();
  console.log("[BG] Roster récupéré:", data.data?.length, "personnages");

  // Extraire les IDs des personnages possédés
  const characterIds = (data.data || []).map(c => c.id);

  return {
    success: true,
    roster: characterIds,
    rosterFull: data.data, // Avec power, stars, etc.
    count: characterIds.length
  };
}