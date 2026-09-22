/* ============================================================
   detect.js
   Camera access, photo capture, and ingredient detection.

   Detection is tried in this order:
     1. The Python server, if it reports that YOLO is loaded.
     2. TensorFlow.js COCO-SSD inside the browser.
   Either way the result is the same shape, so app.js does not care
   which one ran.
   ============================================================ */

const Detector = (() => {
  const video   = document.getElementById("video");
  const overlay = document.getElementById("overlay");
  const preview = document.getElementById("preview");
  const empty   = document.getElementById("stageEmpty");
  const busy    = document.getElementById("stageBusy");
  const hint    = document.getElementById("captureHint");

  const btnCamera = document.getElementById("btnCamera");
  const btnShoot  = document.getElementById("btnShoot");
  const btnStop   = document.getElementById("btnStop");
  const fileInput = document.getElementById("fileInput");

  let stream = null;
  let browserModel = null;
  let serverHasYolo = false;
  let lastBlob = null;

  /* ---- COCO class -> kitchen ingredient (mirrors the backend map) ---- */
  const CLASS_MAP = {
    banana: "banana", apple: "apple", orange: "orange",
    broccoli: "broccoli", carrot: "carrot",
    sandwich: "bread", "hot dog": "bread", pizza: "cheese",
    cake: "sugar", donut: "refined flour",
    bottle: "milk", cup: "milk", bowl: "rice",
  };

  function setBusy(on, text) {
    busy.hidden = !on;
    if (text) busy.lastChild.textContent = " " + text;
  }

  function showPreview(url) {
    preview.src = url;
    preview.hidden = false;
    empty.hidden = true;
  }

  /* ------------------------------ camera ------------------------------ */
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hint.textContent = "This browser will not give camera access. Use 'Choose photo' instead.";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      video.srcObject = stream;
      video.hidden = false;
      preview.hidden = true;
      empty.hidden = true;
      overlay.hidden = true;
      btnCamera.hidden = true;
      btnShoot.hidden = false;
      btnStop.hidden = false;
      hint.textContent = "Hold the phone steady, fill the frame with one shelf, then take the photo.";
      await video.play();
    } catch (err) {
      hint.textContent =
        "Camera blocked: " + err.name +
        ". Allow camera permission, or serve the page over https, or use 'Choose photo'.";
    }
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.hidden = true;
    btnCamera.hidden = false;
    btnShoot.hidden = true;
    btnStop.hidden = true;
  }

  function captureFrame() {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* ---------------------------- detection ----------------------------- */
  async function loadBrowserModel() {
    if (browserModel) return browserModel;
    if (typeof cocoSsd === "undefined") return null;
    setBusy(true, "Loading the detection model");
    browserModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    setBusy(false);
    return browserModel;
  }

  async function detectInBrowser(imgElement) {
    const model = await loadBrowserModel();
    if (!model) return { detector: "unavailable", items: [], ingredients: [] };

    const predictions = await model.detect(imgElement);
    const items = [];
    const seen = new Set();

    predictions.forEach((p) => {
      if (p.score < CONFIG.MIN_CONFIDENCE) return;
      const ingredient = CLASS_MAP[p.class] || p.class;
      items.push({
        ingredient,
        label: p.class,
        confidence: Math.round(p.score * 100) / 100,
        box: [p.bbox[0], p.bbox[1], p.bbox[0] + p.bbox[2], p.bbox[1] + p.bbox[3]],
      });
      seen.add(ingredient);
    });

    return { detector: "browser", items, ingredients: [...seen] };
  }

  async function detectOnServer(blob) {
    const form = new FormData();
    form.append("image", blob, "fridge.jpg");
    form.append("confidence", String(CONFIG.MIN_CONFIDENCE));
    const res = await fetch(CONFIG.API_BASE + "/api/detect", { method: "POST", body: form });
    if (!res.ok) throw new Error("Server detection failed");
    return res.json();
  }

  /** Draw boxes over the photo so the user can see what was recognised. */
  function drawBoxes(items, imgW, imgH) {
    if (!items.length) { overlay.hidden = true; return; }
    overlay.width = imgW;
    overlay.height = imgH;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, imgW, imgH);
    ctx.lineWidth = Math.max(2, imgW / 320);
    ctx.font = `${Math.max(13, imgW / 34)}px Inter, sans-serif`;

    items.forEach((it) => {
      const [x1, y1, x2, y2] = it.box;
      ctx.strokeStyle = "#f0a202";
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const text = `${it.ingredient} ${Math.round(it.confidence * 100)}%`;
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = "#12211c";
      ctx.fillRect(x1, Math.max(0, y1 - 22), w, 22);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x1 + 5, Math.max(15, y1 - 6));
    });
    overlay.hidden = false;
  }

  /** Run the whole pipeline on a canvas or an image element. */
  async function analyse(source, blob) {
    setBusy(true, "Reading the photo");
    let result = null;

    try {
      if (serverHasYolo && blob) {
        result = await detectOnServer(blob);
        if (result.detector === "unavailable") result = null;
      }
    } catch (e) {
      console.warn("Server detection unavailable, using the browser model.", e);
    }

    if (!result) {
      const img = source instanceof HTMLImageElement ? source : await canvasToImage(source);
      result = await detectInBrowser(img);
    }

    const w = source.width || source.naturalWidth;
    const h = source.height || source.naturalHeight;
    drawBoxes(result.items, w, h);
    setBusy(false);
    return result;
  }

  function canvasToImage(canvas) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = canvas.toDataURL("image/jpeg", 0.9);
    });
  }

  /* ------------------------------ wiring ------------------------------ */
  function init(onResult) {
    btnCamera.addEventListener("click", startCamera);
    btnStop.addEventListener("click", stopCamera);

    btnShoot.addEventListener("click", async () => {
      const canvas = captureFrame();
      canvas.toBlob(async (blob) => {
        lastBlob = blob;
        showPreview(URL.createObjectURL(blob));
        stopCamera();
        onResult(await analyse(canvas, blob));
      }, "image/jpeg", 0.9);
    });

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      lastBlob = file;
      stopCamera();
      const url = URL.createObjectURL(file);
      showPreview(url);
      const img = new Image();
      img.onload = async () => onResult(await analyse(img, file));
      img.src = url;
    });
  }

  return {
    init,
    setServerYolo: (v) => { serverHasYolo = v; },
    warmUp: loadBrowserModel,
  };
})();
