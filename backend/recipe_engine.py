"""
recipe_engine.py
----------------
Core matching logic of the INTELLIGENT WEB-BASED RECIPE GENERATOR.

Given a list of ingredients detected from a fridge photo (or typed by the
user), this module ranks the recipe dataset and returns the best matches,
scaled to the number of people eating.

Scoring model
    match_score = 0.70 * core_coverage
                + 0.15 * optional_coverage
                + 0.10 * expiry_urgency_bonus
                + 0.05 * simplicity_bonus

Nothing is invented: a recipe is only returned when the user actually has
most of its core ingredients, which is how the system avoids the
"hallucinated ingredient" problem described in the report.
"""

import json
import os
from datetime import date

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def _load(filename):
    with open(os.path.join(DATA_DIR, filename), "r", encoding="utf-8") as f:
        return json.load(f)


RECIPES = _load("recipes.json")
INGREDIENT_DATA = _load("ingredients.json")

SYNONYMS = INGREDIENT_DATA["synonyms"]
SUBSTITUTIONS = INGREDIENT_DATA["substitutions"]
STAPLES = set(INGREDIENT_DATA["staples"])
SHELF_LIFE = INGREDIENT_DATA["shelf_life_days"]
CATEGORIES = INGREDIENT_DATA["categories"]

# Diet rules: which recipe tags are allowed for each diet preference.
DIET_RULES = {
    "any": None,
    "vegetarian": {"vegetarian"},
    "vegan": {"vegan"},
    "eggetarian": {"vegetarian", "vegan", "eggetarian"},
    "non-vegetarian": None,
    "high-protein": {"high-protein"},
    "low-carb": {"low-carb"},
    "gluten-free": {"gluten-free"},
}


def normalise(name):
    """Lower-case, strip and resolve an ingredient name to its canonical form."""
    key = str(name).strip().lower()
    key = key.replace("_", " ")
    if key.endswith("es") and key[:-2] in SYNONYMS.values():
        key = key[:-2]
    return SYNONYMS.get(key, key)


def normalise_list(items):
    """Normalise a list of raw ingredient names, removing duplicates."""
    seen, out = set(), []
    for item in items or []:
        n = normalise(item)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def category_of(ingredient):
    for cat, members in CATEGORIES.items():
        if ingredient in members:
            return cat
    return "other"


def expiry_days(ingredient):
    """Typical days an ingredient stays good once bought. Used for urgency."""
    return SHELF_LIFE.get(ingredient, 30)


def _coverage(required, available):
    """Return (matched, missing, ratio) for one ingredient group."""
    matched, missing = [], []
    for entry in required:
        item = normalise(entry["item"])
        if item in available or item in STAPLES:
            matched.append(item)
        else:
            missing.append(item)
    total = len(required) or 1
    return matched, missing, len(matched) / total


def _substitutes_for(missing, available):
    """Suggest a replacement the user actually owns, else a generic option."""
    tips = []
    for item in missing:
        options = SUBSTITUTIONS.get(item, [])
        owned = [o for o in options if normalise(o) in available]
        if owned:
            tips.append({"missing": item, "use_instead": owned[0], "in_your_fridge": True})
        elif options:
            tips.append({"missing": item, "use_instead": options[0], "in_your_fridge": False})
    return tips


def scale_ingredients(entries, base_servings, servings):
    """Scale quantities from the recipe's base servings to the required count."""
    factor = servings / float(base_servings or 1)
    scaled = []
    for e in entries:
        qty = round(e["qty"] * factor, 2)
        if qty == int(qty):
            qty = int(qty)
        scaled.append({"item": e["item"], "qty": qty, "unit": e["unit"]})
    return scaled


def scale_nutrition(nutrition, servings):
    """Per-serving values stay the same; totals are multiplied by servings."""
    total = {k: round(v * servings, 1) for k, v in nutrition.items()}
    return {"per_serving": nutrition, "total": total}


def diet_allows(recipe, diet):
    rule = DIET_RULES.get(diet)
    if rule is None:
        return True
    return bool(rule & set(recipe["diet_tags"]))


def match_recipes(
    available_ingredients,
    servings=2,
    diet="any",
    meal_type=None,
    max_time=None,
    exclude=None,
    limit=10,
    min_score=0.35,
):
    """
    Rank recipes against what the user has.

    available_ingredients : list[str]  - detected or typed ingredient names
    servings              : int        - how many people are eating
    diet                  : str        - key from DIET_RULES
    meal_type             : str|None   - breakfast / lunch / dinner / snack
    max_time              : int|None   - maximum cooking minutes
    exclude               : list[str]  - allergens or disliked items to avoid
    """
    available = set(normalise_list(available_ingredients))
    blocked = set(normalise_list(exclude or []))
    servings = max(1, int(servings or 1))
    results = []

    for recipe in RECIPES:
        if not diet_allows(recipe, diet):
            continue
        if meal_type and meal_type not in recipe["meal_type"]:
            continue
        if max_time and recipe["time_minutes"] > int(max_time):
            continue

        all_items = {normalise(e["item"]) for e in
                     recipe["core_ingredients"] + recipe["optional_ingredients"]}
        if blocked & all_items:
            continue

        core_matched, core_missing, core_ratio = _coverage(recipe["core_ingredients"], available)
        opt_matched, _, opt_ratio = _coverage(recipe["optional_ingredients"], available)

        # Prioritise recipes that use up short-lived ingredients first.
        urgency = 0.0
        if core_matched:
            shortest = min(expiry_days(i) for i in core_matched)
            urgency = max(0.0, (30 - shortest) / 30.0)

        simplicity = max(0.0, (60 - recipe["time_minutes"]) / 60.0)

        score = (0.70 * core_ratio) + (0.15 * opt_ratio) + (0.10 * urgency) + (0.05 * simplicity)
        if score < min_score:
            continue

        results.append({
            "id": recipe["id"],
            "name": recipe["name"],
            "cuisine": recipe["cuisine"],
            "meal_type": recipe["meal_type"],
            "diet_tags": recipe["diet_tags"],
            "difficulty": recipe["difficulty"],
            "time_minutes": recipe["time_minutes"],
            "servings": servings,
            "match_percent": round(score * 100),
            "core_coverage_percent": round(core_ratio * 100),
            "used_ingredients": core_matched + opt_matched,
            "missing_ingredients": core_missing,
            "substitution_tips": _substitutes_for(core_missing, available),
            "ingredients": scale_ingredients(recipe["core_ingredients"], recipe["base_servings"], servings),
            "optional_ingredients": scale_ingredients(recipe["optional_ingredients"], recipe["base_servings"], servings),
            "steps": recipe["steps"],
            "nutrition": scale_nutrition(recipe["nutrition_per_serving"], servings),
        })

    results.sort(key=lambda r: (-r["match_percent"], len(r["missing_ingredients"])))
    return results[:limit]


def get_recipe(recipe_id, servings=2):
    for recipe in RECIPES:
        if recipe["id"] == recipe_id:
            return {
                **recipe,
                "servings": servings,
                "ingredients": scale_ingredients(recipe["core_ingredients"], recipe["base_servings"], servings),
                "optional_ingredients": scale_ingredients(recipe["optional_ingredients"], recipe["base_servings"], servings),
                "nutrition": scale_nutrition(recipe["nutrition_per_serving"], servings),
            }
    return None


def expiry_report(pantry):
    """
    pantry: list of {"item": "tomato", "added_on": "2026-09-14"}
    Returns each item with days left before it is likely to spoil.
    """
    today = date.today()
    report = []
    for entry in pantry or []:
        item = normalise(entry.get("item", ""))
        if not item:
            continue
        try:
            y, m, d = (int(x) for x in str(entry.get("added_on", today)).split("-"))
            added = date(y, m, d)
        except (ValueError, AttributeError):
            added = today
        life = expiry_days(item)
        left = life - (today - added).days
        report.append({
            "item": item,
            "category": category_of(item),
            "days_left": left,
            "status": "expired" if left < 0 else "use soon" if left <= 2 else "fresh",
        })
    report.sort(key=lambda r: r["days_left"])
    return report


def all_ingredient_names():
    """Every ingredient the dataset knows about, for the type-ahead box."""
    names = set()
    for recipe in RECIPES:
        for e in recipe["core_ingredients"] + recipe["optional_ingredients"]:
            names.add(normalise(e["item"]))
    return sorted(names)
