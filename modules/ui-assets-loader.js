/**
 * UI Assets Loader - Charge les assets MSF depuis l'API publique
 * Fallback sur emojis si les assets ne sont pas disponibles
 */
class UIAssetsLoader {
  constructor() {
    this.assets = null;
    this.iconsCache = new Map();
    this.loadPromise = null;
  }

  /**
   * Charge la configuration des assets
   * @returns {Promise<Object>}
   */
  async load() {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const ext = typeof browser !== "undefined" ? browser : chrome;
        const url = ext.runtime.getURL("data/ui-assets.json");
        const response = await fetch(url);
        this.assets = await response.json();
        console.log("[UIAssets] Configuration chargée");
        return this.assets;
      } catch (error) {
        console.warn("[UIAssets] Impossible de charger ui-assets.json:", error);
        this.assets = { icons: {}, colors: {}, fallback: {} };
        return this.assets;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Retourne l'URL complète d'une icône
   * @param {string} iconName - Nom de l'icône (war, raid, events, etc.)
   * @returns {string|null} URL de l'icône ou null
   */
  getIconUrl(iconName) {
    if (!this.assets || !this.assets.icons || !this.assets.icons[iconName]) {
      return null;
    }
    const baseUrl = this.assets.baseUrl || "https://assets.marvelstrikeforce.com";
    return `${baseUrl}${this.assets.icons[iconName]}`;
  }

  /**
   * Charge une icône et retourne une Image ou null si échec
   * @param {string} iconName
   * @param {Function} onLoad - Callback appelé avec l'image si succès
   * @param {Function} onError - Callback appelé si échec
   */
  loadIcon(iconName, onLoad, onError) {
    const url = this.getIconUrl(iconName);
    if (!url) {
      if (onError) onError(new Error(`Icon ${iconName} not found in config`));
      return;
    }

    // Check cache
    if (this.iconsCache.has(iconName)) {
      const cached = this.iconsCache.get(iconName);
      if (cached.success && onLoad) {
        onLoad(cached.img);
      } else if (!cached.success && onError) {
        onError(new Error("Icon failed to load (cached)"));
      }
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      this.iconsCache.set(iconName, { success: true, img });
      if (onLoad) onLoad(img);
    };

    img.onerror = () => {
      this.iconsCache.set(iconName, { success: false });
      console.warn(`[UIAssets] Failed to load icon: ${iconName} from ${url}`);
      if (onError) onError(new Error(`Failed to load ${iconName}`));
    };

    img.src = url;
  }

  /**
   * Remplace l'emoji d'un bouton par une icône MSF (avec fallback)
   * @param {HTMLButtonElement} button
   * @param {string} iconName
   * @param {string} fallbackEmoji
   */
  setButtonIcon(button, iconName, fallbackEmoji) {
    this.loadIcon(
      iconName,
      (img) => {
        // Succès : remplacer l'emoji par l'icône
        const iconContainer = document.createElement("span");
        iconContainer.className = "btn-icon-img";
        iconContainer.style.cssText = `
          display: inline-block;
          width: 18px;
          height: 18px;
          background: url('${img.src}') center/contain no-repeat;
          vertical-align: middle;
          margin-right: 4px;
        `;

        // Trouver et remplacer l'emoji
        const textNode = Array.from(button.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode) {
          textNode.textContent = textNode.textContent.replace(/[\u{1F300}-\u{1F9FF}]/gu, "").trim();
        }

        // Insérer l'icône au début
        button.insertBefore(iconContainer, button.firstChild);
      },
      () => {
        // Échec : garder l'emoji fallback
        console.log(`[UIAssets] Using fallback emoji for ${iconName}`);
      }
    );
  }

  /**
   * Retourne une couleur du thème
   * @param {string} colorName - primary, accent, success, etc.
   * @returns {string} Code couleur hex
   */
  getColor(colorName) {
    if (!this.assets || !this.assets.colors || !this.assets.colors[colorName]) {
      return "#ffffff";
    }
    return this.assets.colors[colorName];
  }

  /**
   * Applique le thème MSF aux variables CSS
   */
  applyTheme() {
    if (!this.assets || !this.assets.colors) return;

    const root = document.documentElement;
    Object.entries(this.assets.colors).forEach(([name, value]) => {
      root.style.setProperty(`--msf-${name}`, value);
    });

    console.log("[UIAssets] Thème MSF appliqué aux variables CSS");
  }
}

// Export global
window.UIAssetsLoader = UIAssetsLoader;
