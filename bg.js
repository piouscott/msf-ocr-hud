const ext = typeof browser !== "undefined" ? browser : chrome;

async function sendToAllFrames(tabId, message) {
  // Récupère la liste des frames
  const frames = await ext.webNavigation.getAllFrames({ tabId });

  // Filtre uniquement les frames du jeu
  const targets = frames.filter(f => (f.url || "").includes("webplayable.m3.scopelypv.com"));

  // Envoie le message à chaque frame ciblée
  await Promise.all(
    targets.map(f =>
      ext.tabs.sendMessage(tabId, message, { frameId: f.frameId }).catch(() => null)
    )
  );
}

ext.browserAction.onClicked.addListener(async (tab) => {
  try {
    const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: "png" });

    await sendToAllFrames(tab.id, { type: "MSF_SCREENSHOT", dataUrl });

    console.log("✅ Screenshot envoyé à toutes les frames");
  } catch (e) {
    console.error("❌ Erreur BG:", e);
  }
});