# INTELLIGENT WEB-BASED RECIPE GENERATOR

Final year project — Department of Computer Science and Engineering, SSSE, Tumakuru (2025–26).

Take one photo of your fridge. The system detects the food items, matches them
against a recipe dataset, scales the dish to the number of people eating, shows
the nutrition, and builds a multi-day diet plan with a shopping list.

---

## 1. What is in this folder

```
recipe-generator/
├── backend/
│   ├── app.py               Flask API + serves the frontend
│   ├── recipe_engine.py     Matching, scoring, substitution, serving scaling
│   ├── diet_planner.py      Calorie needs and the day-by-day meal plan
│   ├── detector.py          YOLO ingredient detection (optional)
│   ├── train_yolo.py        Optional: train YOLO on a custom fridge dataset
│   ├── requirements.txt
│   ├── Procfile             For Render / Railway deployment
│   ├── models/              Put your trained best.pt here
│   └── data/
│       ├── recipes.json         30 recipes with steps + nutrition  ← your dataset
│       └── ingredients.json     Synonyms, substitutions, shelf life, class map
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── config.js        ← THE ONLY FILE YOU EDIT WHEN HOSTING
│       ├── detect.js        Camera, photo upload, detection
│       ├── offline-engine.js  Browser copy of the engine (static hosting)
│       └── app.js           UI logic
└── docs/
    └── report-mapping.md    Which file implements which chapter of your report
```

---

## 2. Run it on your laptop (5 minutes)

**Step 1 — install Python 3.9 or newer.** Check with `python --version`.

**Step 2 — install the two packages the app needs.**

```bash
cd recipe-generator/backend
pip install flask flask-cors
```

**Step 3 — start the server.**

```bash
python app.py
```

You should see `Recipe Generator running on http://127.0.0.1:5000`.

**Step 4 — open `http://127.0.0.1:5000` in Chrome.**

That's it. The backend also serves the frontend, so there is nothing else to
connect. The badge in the top right should say **server connected**.

Camera works on `localhost` without https. On any other address browsers
require https — see section 5.

---

## 3. Turning on YOLO detection on the server (optional)

Without this step, detection runs inside the browser using TensorFlow.js
COCO-SSD, which already recognises banana, apple, orange, carrot, broccoli,
bottles and bowls. That is enough for a working demo.

For proper fridge detection with YOLO:

```bash
pip install ultralytics pillow
python app.py
```

On first run it downloads `yolov8n.pt` automatically. The health badge will
then show **YOLO on server**.

To recognise Indian kitchen items (paneer, curry leaves, dal), train your own
model:

1. Download a fridge-ingredient dataset in YOLO format from Roboflow Universe.
2. Put it in `backend/dataset/` with `data.yaml`, `images/train`, `labels/train`.
3. `python train_yolo.py`
4. Copy `runs/detect/.../weights/best.pt` → `backend/models/best.pt`
5. Restart the server. `detector.py` picks it up automatically.

The mAP numbers printed at the end of training are exactly the metrics your
report's literature survey compares against.

---

## 4. How the frontend talks to the backend

Every request goes through one setting: `API_BASE` in `frontend/js/config.js`.

| Your situation | What to put in config.js |
|---|---|
| Backend and frontend on the same server | `API_BASE: ""` |
| Frontend on your web host, backend on Render | `API_BASE: "https://your-app.onrender.com"` |
| No Python anywhere (static hosting only) | `API_BASE: ""` and `OFFLINE_MODE: true` |

The API itself:

| Method | Route | Sends | Gets back |
|---|---|---|---|
| GET | `/api/health` | — | server status, which detector is active |
| GET | `/api/ingredients` | — | every ingredient in the dataset |
| POST | `/api/detect` | image file | detected items with boxes and confidence |
| POST | `/api/recipes` | ingredients, servings, diet, filters | ranked recipes with steps and nutrition |
| GET | `/api/recipe/<id>?servings=4` | — | one full recipe, scaled |
| POST | `/api/diet-plan` | ingredients + person profile | multi-day plan + shopping list |
| POST | `/api/pantry/expiry` | pantry items with dates | days left before spoiling |

Test one without the browser:

```bash
curl -X POST http://127.0.0.1:5000/api/recipes \
  -H "Content-Type: application/json" \
  -d '{"ingredients":["tomato","onion","egg"],"servings":2}'
```

---

## 5. Hosting it on your own website

### Option A — the simplest: static hosting, no Python at all

Works on Hostinger, GoDaddy, cPanel, GitHub Pages, Netlify, Vercel.

1. Open `frontend/js/config.js` and set `OFFLINE_MODE: true`.
2. Copy the `backend/data` folder so it sits next to `frontend`, keeping the
   same relative path (`../backend/data/recipes.json`). If your host only
   accepts one folder, move `recipes.json` and `ingredients.json` into
   `frontend/data/` and change `DATA_URL` to `"data/recipes.json"` and
   `INGREDIENT_DATA_URL` to `"data/ingredients.json"`.
3. Upload the `frontend` folder to `public_html` (or drag it into Netlify).
4. Make sure the site loads over **https**, otherwise the camera will not open.

Everything — detection, matching, scaling, diet plan — then runs in the
visitor's browser.

### Option B — full stack, backend on a free host

1. Push this folder to a GitHub repository.
2. Go to render.com → New → Web Service → connect the repo.
   - Build command: `pip install -r backend/requirements.txt`
   - Start command: `gunicorn app:app --chdir backend --bind 0.0.0.0:$PORT`
3. Render gives you a URL like `https://recipe-gen.onrender.com`.
4. Put that URL into `API_BASE` in `config.js`.
5. Upload the `frontend` folder to your own web host.

PythonAnywhere and Railway work the same way; only the start command changes.

### Option C — everything on one server (a VPS or your college server)

```bash
pip install -r backend/requirements.txt
gunicorn app:app --chdir backend --bind 0.0.0.0:8000
```

Then point Nginx or Apache at port 8000. `API_BASE` stays `""`.

---

## 6. Adding your own recipes

Open `backend/data/recipes.json` and copy one block:

```json
{
  "id": "R031",
  "name": "Your Dish",
  "cuisine": "Indian",
  "meal_type": ["lunch", "dinner"],
  "diet_tags": ["vegetarian", "gluten-free"],
  "time_minutes": 25,
  "difficulty": "Easy",
  "base_servings": 2,
  "core_ingredients": [{"item": "rice", "qty": 1, "unit": "cup"}],
  "optional_ingredients": [{"item": "coriander", "qty": 1, "unit": "tbsp"}],
  "steps": ["First step.", "Second step."],
  "nutrition_per_serving": {"calories": 300, "protein_g": 8, "carbs_g": 50, "fat_g": 7, "fiber_g": 4}
}
```

Rules that keep the engine happy:

- `core_ingredients` decide the match score. Keep them to the 3–5 items the
  dish cannot be made without.
- Salt, pepper, oil and basic spices are in the `staples` list already, so you
  do not need to own them for a recipe to match.
- New ingredient name? Add its everyday alternatives to `synonyms` in
  `ingredients.json` so "aloo" and "potato" count as the same thing.
- Restart the server after editing. In offline mode just reload the page.

If you want a much larger dataset, the Kaggle *Food Ingredients and Recipes*
and *RecipeNLG* datasets can be converted into this same JSON shape with a
short Python script, and everything else keeps working.

---

## 7. How the matching works (for your viva)

```
match_score = 0.70 × core ingredient coverage
            + 0.15 × optional ingredient coverage
            + 0.10 × expiry urgency
            + 0.05 × simplicity (shorter cooking time)
```

- **Core coverage** is the fraction of must-have ingredients you actually own.
- **Expiry urgency** pushes dishes that use up short-lived items (spinach,
  milk, banana) ahead of dishes using potatoes and rice. This is what makes the
  system reduce food waste rather than just suggest recipes.
- **Substitution**: when something is missing, the engine checks whether you own
  a valid replacement, and says so.
- A recipe below 35% is never shown, which is how the system avoids suggesting a
  dish whose ingredients you do not have — the hallucination problem described
  in your report.

Calorie targets use the Mifflin–St Jeor equation with an activity factor, and
are floored at a safe minimum so the planner never produces an unhealthy target.

---

## 8. If something does not work

| Problem | Fix |
|---|---|
| Badge says "browser mode" when you expected the server | The Flask server is not running, or `API_BASE` is wrong. |
| Camera button does nothing | The page is not on https or localhost. Use "Choose photo" meanwhile. |
| "Could not load recipes.json" | `DATA_URL` in config.js does not match where you uploaded the data folder. |
| Detection finds nothing | COCO-SSD only knows a few foods. Train your own model (section 3), or add items by hand. |
| CORS error in the console | `pip install flask-cors`, or serve the frontend from the same server. |
| Recipes show but the plan is empty | Add a few more ingredients — the planner needs breakfast, lunch and dinner candidates. |

---

## Team

| # | Name | USN |
|---|---|---|
| 1 | Ajith Nayak M | |
| 2 | Balaji H M | |
| 3 | Basavaraj | |
| 4 | K Vinay | |

Guide: ______________________   Head of Department: ______________________
