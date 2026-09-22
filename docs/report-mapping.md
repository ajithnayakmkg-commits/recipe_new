# Report → code mapping

Use this when you write the implementation chapter or face the viva. Every
objective in your report now has a file and a function behind it.

## Objectives from Chapter 3

| Objective in the report | Where it lives | What to demonstrate |
|---|---|---|
| Remove manual ingredient entry using a single photo | `frontend/js/detect.js`, `backend/detector.py` | Take a photo, watch the chips appear by themselves |
| Detect and classify food items with YOLO | `backend/detector.py` → `detect()`; browser fallback in `detect.js` → `detectInBrowser()` | The boxes drawn over the photo with class name and confidence |
| Generate structured, context-aware recipes using only detected ingredients | `backend/recipe_engine.py` → `match_recipes()` | The `missing_ingredients` field, and the 35% score floor |
| Prevent hallucinated ingredients | `recipe_engine.py` → `_coverage()` and `min_score` | A recipe never appears unless its core ingredients are actually present |
| Lower the cognitive load of meal planning | `backend/diet_planner.py` → `build_plan()` | One button produces breakfast, lunch, snack and dinner for several days |
| Track quantities and expiry | `recipe_engine.py` → `expiry_report()`, `shelf_life_days` in `ingredients.json` | Post to `/api/pantry/expiry` and show the "use soon" flags |
| Nutritional insight | `recipe_engine.py` → `scale_nutrition()`, `diet_planner.py` → `daily_energy_needs()` | Per-serving and whole-dish calories, and the Mifflin–St Jeor target |
| Personalisation and substitution | `recipe_engine.py` → `diet_allows()`, `_substitutes_for()` | Set diet to vegan, or remove paneer and see the tofu suggestion |
| Easy web dashboard | `frontend/index.html` | The whole page, working on a phone |

## Chapter 5 methodology, as built

| Report stage | Implementation |
|---|---|
| Data collection | `data/recipes.json` (30 recipes), `data/ingredients.json` (synonyms, substitutions, shelf life). YOLO weights come from COCO or your own trained set. |
| Preprocessing | Images resized by the camera capture and by YOLO's own letterboxing; ingredient names normalised through `normalise()` so "aloo", "potatoes" and "potato" collapse into one token. |
| Ingredient detection | YOLOv8 (`detector.py`) on the server, COCO-SSD in the browser as fallback. |
| Recipe generation | A constrained retrieval-and-scaling engine instead of a free-text LLM. It cannot invent an ingredient, which is the failure case every paper in your survey reports. |
| Prompt engineering equivalent | The scoring weights and the `min_score` floor in `match_recipes()` play the role the constrained prompt plays in the surveyed systems. |
| Deployment | Flask + HTML/CSS/JS, with a second path that runs entirely in the browser for static hosting. |

## Where this differs from the report — say this honestly in the viva

The report describes a Large Language Model writing the recipes. This build
uses a curated dataset with a scoring engine instead. That is a deliberate
choice and it is defensible:

- It runs on free hosting with no API key and no running cost.
- The output is reproducible, which matters when an examiner runs it twice.
- It cannot hallucinate an ingredient, which is the exact limitation listed for
  three of the five papers in your survey.

If you want the LLM path as well, add a module that posts the detected
ingredient list to any model API and asks for JSON only, then render the reply
with the same `renderRecipes()` function. Keep the dataset engine as the
fallback so the demo never fails in front of the panel.

## Comparison table for your results chapter

| System in your survey | Detection | Recipe source | Limitation they report |
|---|---|---|---|
| Multimodal AI Chef (2023) | YOLOv5, 30 classes | ChatGPT-3.5 | Closed vocabulary of 30 items |
| AI-Powered Smart Recipe Generator (2025) | EfficientNetV2B0, 51 classes | Gemini API | 96×96 input limits cluttered images |
| Food Recipe Generator (2025) | None | NLP on typed text | No computer vision at all |
| **This project** | YOLOv8 on server, COCO-SSD in browser | Curated dataset with constrained scoring | Recipe variety is bounded by dataset size |

## Suggested screenshots for the report

1. The empty capture panel on a phone.
2. The photo with detection boxes drawn over it.
3. The ingredient chips after detection, with one edited by hand.
4. The recipe list showing match percentages and a substitution tip.
5. The three-day diet plan with the shopping list.
6. A terminal showing `curl` hitting `/api/recipes` — good evidence of a real API.
