"""
diet_planner.py
---------------
Builds a day-by-day meal plan from the recipes a household can actually cook
with what is in the fridge.

Energy needs use the Mifflin-St Jeor equation, which is the standard formula
taught in nutrition courses:

    men   : BMR = 10*weight(kg) + 6.25*height(cm) - 5*age + 5
    women : BMR = 10*weight(kg) + 6.25*height(cm) - 5*age - 161

BMR is then multiplied by an activity factor to get maintenance calories.
These are population estimates, not personal medical advice, and the API
returns that note with every plan.
"""

from recipe_engine import match_recipes

ACTIVITY_FACTORS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very active": 1.9,
}

GOAL_ADJUSTMENT = {
    "maintain": 0,
    "lose": -400,
    "gain": 400,
}

# Floors so the planner never produces an unsafely low target.
MIN_CALORIES = {"male": 1500, "female": 1200}

MEAL_SPLIT = [
    ("Breakfast", "breakfast", 0.25),
    ("Lunch", "lunch", 0.35),
    ("Snack", "snack", 0.10),
    ("Dinner", "dinner", 0.30),
]

DISCLAIMER = (
    "Calorie figures are estimates from a standard formula and the recipe "
    "dataset. For medical conditions, pregnancy or a supervised diet, check "
    "with a qualified dietitian."
)


def daily_energy_needs(age, sex, weight_kg, height_cm, activity="moderate", goal="maintain"):
    sex = (sex or "male").lower()
    activity = (activity or "moderate").lower()
    goal = (goal or "maintain").lower()

    if sex.startswith("f"):
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
        floor = MIN_CALORIES["female"]
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
        floor = MIN_CALORIES["male"]

    maintenance = bmr * ACTIVITY_FACTORS.get(activity, 1.55)
    target = maintenance + GOAL_ADJUSTMENT.get(goal, 0)
    target = max(target, floor)

    return {
        "bmr": round(bmr),
        "maintenance_calories": round(maintenance),
        "target_calories": round(target),
        "protein_g": round(weight_kg * 1.4),
        "note": DISCLAIMER,
    }


def build_plan(
    available_ingredients,
    days=3,
    people=1,
    diet="any",
    exclude=None,
    target_calories=None,
    profile=None,
):
    """
    Returns a plan of `days` days. Each day has breakfast, lunch, snack and
    dinner picked from recipes that fit the fridge contents, without repeating
    a dish until the pool runs out.
    """
    energy = None
    if profile:
        energy = daily_energy_needs(
            age=profile.get("age", 22),
            sex=profile.get("sex", "male"),
            weight_kg=profile.get("weight_kg", 65),
            height_cm=profile.get("height_cm", 170),
            activity=profile.get("activity", "moderate"),
            goal=profile.get("goal", "maintain"),
        )
        target_calories = target_calories or energy["target_calories"]

    target_calories = target_calories or 2000
    days = max(1, min(int(days or 1), 7))
    used_ids = set()
    plan = []

    for day in range(1, days + 1):
        meals, day_calories, day_protein = [], 0, 0

        for label, meal_type, share in MEAL_SPLIT:
            slot_target = target_calories * share
            pool = match_recipes(
                available_ingredients,
                servings=people,
                diet=diet,
                meal_type=meal_type,
                exclude=exclude,
                limit=12,
                min_score=0.30,
            )
            fresh = [r for r in pool if r["id"] not in used_ids] or pool
            if not fresh:
                meals.append({
                    "slot": label,
                    "recipe": None,
                    "note": "No dish in the dataset fits this slot with the current ingredients.",
                })
                continue

            # Pick whatever sits closest to the calorie share for this slot,
            # while still being a strong ingredient match.
            best = min(
                fresh[:6],
                key=lambda r: abs(r["nutrition"]["per_serving"]["calories"] - slot_target)
                - (r["match_percent"] / 100.0) * 60,
            )
            used_ids.add(best["id"])
            cals = best["nutrition"]["per_serving"]["calories"]
            prot = best["nutrition"]["per_serving"]["protein_g"]
            day_calories += cals
            day_protein += prot

            meals.append({
                "slot": label,
                "recipe": {
                    "id": best["id"],
                    "name": best["name"],
                    "time_minutes": best["time_minutes"],
                    "match_percent": best["match_percent"],
                    "missing_ingredients": best["missing_ingredients"],
                    "calories_per_serving": cals,
                    "protein_per_serving": prot,
                    "servings": people,
                },
            })

        plan.append({
            "day": day,
            "meals": meals,
            "day_total": {
                "calories_per_person": round(day_calories),
                "protein_g_per_person": round(day_protein, 1),
                "calories_for_household": round(day_calories * people),
            },
        })

    return {
        "days": days,
        "people": people,
        "diet": diet,
        "target_calories_per_person": round(target_calories),
        "energy_profile": energy,
        "plan": plan,
        "shopping_list": _shopping_list(plan),
        "note": DISCLAIMER,
    }


def _shopping_list(plan):
    """Everything the plan needs that the fridge did not have."""
    missing = {}
    for day in plan:
        for meal in day["meals"]:
            recipe = meal.get("recipe")
            if not recipe:
                continue
            for item in recipe.get("missing_ingredients", []):
                missing[item] = missing.get(item, 0) + 1
    return [{"item": k, "needed_for_meals": v} for k, v in
            sorted(missing.items(), key=lambda x: -x[1])]
