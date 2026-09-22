"""
detector.py
-----------
Ingredient detection from a fridge photo.

The app works in two modes and picks whichever is available:

1. SERVER MODE - Ultralytics YOLO runs on the Flask server. Use this when you
   have Python packages installed and a machine that can run the model.
   Put a trained model at backend/models/best.pt, or leave it empty and the
   code downloads yolov8n.pt (COCO) on first run.

2. BROWSER MODE - if YOLO is not installed the server returns
   {"detector": "unavailable"} and the frontend falls back to TensorFlow.js
   COCO-SSD running inside the browser. This is what makes the app work on
   cheap shared hosting where you cannot run Python at all.

Raw model labels (COCO class names) are mapped to kitchen ingredient names
through detector_class_map in data/ingredients.json.
"""

import io
import json
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
CUSTOM_MODEL = os.path.join(MODEL_DIR, "best.pt")

with open(os.path.join(DATA_DIR, "ingredients.json"), "r", encoding="utf-8") as f:
    CLASS_MAP = json.load(f)["detector_class_map"]

_model = None
_load_error = None


def _get_model():
    """Load YOLO once and keep it in memory. Returns None if unavailable."""
    global _model, _load_error
    if _model is not None or _load_error is not None:
        return _model
    try:
        from ultralytics import YOLO  # noqa: WPS433 (optional dependency)
        weights = CUSTOM_MODEL if os.path.exists(CUSTOM_MODEL) else "yolov8n.pt"
        _model = YOLO(weights)
        print(f"[detector] YOLO loaded from {weights}")
    except Exception as exc:  # model or package missing
        _load_error = str(exc)
        print(f"[detector] YOLO not available -> browser mode. Reason: {exc}")
    return _model


def is_available():
    return _get_model() is not None


def map_label(label):
    """Turn a model class name into an ingredient the recipe engine knows."""
    key = str(label).strip().lower()
    return CLASS_MAP.get(key, key)


def detect(image_bytes, confidence=0.35):
    """
    Run detection on raw image bytes.

    Returns:
        {
          "detector": "yolo" | "unavailable",
          "items": [{"ingredient": "tomato", "label": "tomato",
                     "confidence": 0.82, "box": [x1,y1,x2,y2]}],
          "ingredients": ["tomato", "onion"]
        }
    """
    model = _get_model()
    if model is None:
        return {"detector": "unavailable", "items": [], "ingredients": [],
                "message": "Server-side YOLO is not installed. The browser detector will be used."}

    from PIL import Image
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    results = model.predict(image, conf=confidence, verbose=False)
    items, seen = [], set()

    for result in results:
        names = result.names
        for box in result.boxes:
            label = names[int(box.cls[0])]
            ingredient = map_label(label)
            conf = round(float(box.conf[0]), 3)
            coords = [round(float(v)) for v in box.xyxy[0].tolist()]
            items.append({
                "ingredient": ingredient,
                "label": label,
                "confidence": conf,
                "box": coords,
            })
            seen.add(ingredient)

    items.sort(key=lambda d: -d["confidence"])
    return {"detector": "yolo", "items": items, "ingredients": sorted(seen)}
