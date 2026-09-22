"""
app.py
------
Flask API for the INTELLIGENT WEB-BASED RECIPE GENERATOR.

Run it:
    cd backend
    pip install -r requirements.txt
    python app.py

It serves the API on http://127.0.0.1:5000 and also serves the frontend, so
opening http://127.0.0.1:5000 in a browser gives you the whole working app.

Endpoints
    GET  /api/health          - is the server up, is YOLO loaded
    GET  /api/ingredients     - every ingredient the dataset knows
    POST /api/detect          - image file  -> detected ingredients
    POST /api/recipes         - ingredients -> ranked recipes
    GET  /api/recipe/<id>     - one full recipe, scaled to servings
    POST /api/diet-plan       - ingredients + person profile -> meal plan
    POST /api/pantry/expiry   - pantry items -> days left before spoiling
"""

import os

from flask import Flask, jsonify, request, send_from_directory

try:
    from flask_cors import CORS
except ImportError:  # CORS is only needed when the frontend is on another host
    CORS = None

import detector
from diet_planner import build_plan, daily_energy_needs
from recipe_engine import all_ingredient_names, expiry_report, get_recipe, match_recipes

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
MAX_UPLOAD_MB = 8

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
if CORS:
    CORS(app)
else:
    print("[app] flask-cors not installed. Fine if the frontend is served by this same server.")


# ---------------------------------------------------------------- frontend ---
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# --------------------------------------------------------------------- API ---
@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "server_detector": "yolo" if detector.is_available() else "browser-fallback",
        "recipes_loaded": len(all_ingredient_names()),
    })


@app.route("/api/ingredients")
def ingredients():
    return jsonify({"ingredients": all_ingredient_names()})


@app.route("/api/detect", methods=["POST"])
def detect_route():
    if "image" not in request.files:
        return jsonify({"error": "Attach the photo as a form field named 'image'."}), 400

    file = request.files["image"]
    if not file.filename:
        return jsonify({"error": "No file was selected."}), 400

    try:
        confidence = float(request.form.get("confidence", 0.35))
    except ValueError:
        confidence = 0.35

    result = detector.detect(file.read(), confidence=confidence)
    return jsonify(result)


@app.route("/api/recipes", methods=["POST"])
def recipes_route():
    body = request.get_json(silent=True) or {}
    ingredients_in = body.get("ingredients", [])
    if not ingredients_in:
        return jsonify({"error": "Send at least one ingredient."}), 400

    matches = match_recipes(
        available_ingredients=ingredients_in,
        servings=body.get("servings", 2),
        diet=body.get("diet", "any"),
        meal_type=body.get("meal_type"),
        max_time=body.get("max_time"),
        exclude=body.get("exclude", []),
        limit=body.get("limit", 10),
    )
    return jsonify({"count": len(matches), "recipes": matches})


@app.route("/api/recipe/<recipe_id>")
def recipe_route(recipe_id):
    servings = request.args.get("servings", 2, type=int)
    recipe = get_recipe(recipe_id, servings=servings)
    if not recipe:
        return jsonify({"error": f"No recipe with id {recipe_id}."}), 404
    return jsonify(recipe)


@app.route("/api/diet-plan", methods=["POST"])
def diet_plan_route():
    body = request.get_json(silent=True) or {}
    plan = build_plan(
        available_ingredients=body.get("ingredients", []),
        days=body.get("days", 3),
        people=body.get("people", 1),
        diet=body.get("diet", "any"),
        exclude=body.get("exclude", []),
        target_calories=body.get("target_calories"),
        profile=body.get("profile"),
    )
    return jsonify(plan)


@app.route("/api/energy-needs", methods=["POST"])
def energy_route():
    body = request.get_json(silent=True) or {}
    return jsonify(daily_energy_needs(
        age=body.get("age", 22),
        sex=body.get("sex", "male"),
        weight_kg=body.get("weight_kg", 65),
        height_cm=body.get("height_cm", 170),
        activity=body.get("activity", "moderate"),
        goal=body.get("goal", "maintain"),
    ))


@app.route("/api/pantry/expiry", methods=["POST"])
def expiry_route():
    body = request.get_json(silent=True) or {}
    return jsonify({"items": expiry_report(body.get("pantry", []))})


@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": f"That photo is over {MAX_UPLOAD_MB} MB. Try a smaller one."}), 413


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Recipe Generator running on http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
