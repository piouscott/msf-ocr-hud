console.log("✅ MSF content.js chargé");

function startCropCalibrator(options) {
  options = options || {};
  const label = options.label || "CROP";
  const showGrid = options.showGrid || false;

  const overlay = document.createElement("div");
  overlay.id = "msf-calib";
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.05)";
  document.body.appendChild(overlay);

  if (showGrid) {
    const grid = document.createElement("div");
    grid.style.cssText = "position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,transparent,transparent 49px,rgba(0,229,255,0.15) 49px,rgba(0,229,255,0.15) 50px),repeating-linear-gradient(90deg,transparent,transparent 49px,rgba(0,229,255,0.15) 49px,rgba(0,229,255,0.15) 50px);pointer-events:none";
    overlay.appendChild(grid);
  }

  const box = document.createElement("div");
  box.style.cssText = "position:absolute;border:2px solid #0ff;background:rgba(0,255,255,0.1);box-sizing:border-box;box-shadow:0 0 0 9999px rgba(0,0,0,0.3)";
  overlay.appendChild(box);

  const info = document.createElement("pre");
  info.style.cssText = "position:fixed;right:16px;bottom:16px;background:rgba(0,0,0,0.9);color:#fff;padding:12px;border-radius:8px;font:12px monospace;margin:0;cursor:pointer;user-select:none";
  info.textContent = "Drag to select. ESC to quit.";
  overlay.appendChild(info);

  let startX = 0;
  let startY = 0;
  let dragging = false;
  const W = window.innerWidth;
  const H = window.innerHeight;

  function clamp(v, min, max) {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function updateInfo(x, y, w, h) {
    const rx = x / W;
    const ry = y / H;
    const rw = w / W;
    const rh = h / H;
    info.textContent = label + "\nPixels: " + x + "," + y + " " + w + "x" + h + "\n{ x: " + rx.toFixed(4) + ", y: " + ry.toFixed(4) + ", w: " + rw.toFixed(4) + ", h: " + rh.toFixed(4) + " }";
  }

  overlay.addEventListener("mousedown", function(e) {
    if (e.target === info) return;
    dragging = true;
    startX = clamp(e.clientX, 0, W);
    startY = clamp(e.clientY, 0, H);
    box.style.left = startX + "px";
    box.style.top = startY + "px";
    box.style.width = "0px";
    box.style.height = "0px";
    updateInfo(startX, startY, 0, 0);
  });

  overlay.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    const curX = clamp(e.clientX, 0, W);
    const curY = clamp(e.clientY, 0, H);
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";
    updateInfo(x, y, w, h);
  });

  overlay.addEventListener("mouseup", function() {
    dragging = false;
  });

  window.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      overlay.remove();
    }
  });

  updateInfo(0, 0, 0, 0);
}

window.startCropCalibrator = startCropCalibrator;

if (typeof browser !== "undefined") {
  browser.runtime.onMessage.addListener(function(msg) {
    if (msg.action === "startCalibrator") {
      startCropCalibrator({
        label: msg.label || "CROP",
        showGrid: msg.showGrid || false
      });
      console.log("✅ Calibrateur démarré");
      return Promise.resolve({success: true});
    }
  });
}

console.log("✅ Calibrateur prêt - Tapez: startCropCalibrator({showGrid:true})");