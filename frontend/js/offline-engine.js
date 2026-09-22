/* ============================================================
   offline-engine.js
   A browser copy of recipe_engine.py + diet_planner.py.

   This runs only when there is no Python server (CONFIG.OFFLINE_MODE = true,
   or the health check failed). It uses the same recipes.json, the same
   scoring weights and the same formulas, so the two modes agree.
   ============================================================ */

const OfflineEngine = (() => {

  const DIET_RULES = {
    any: null,
    vegetarian: ["vegetarian"],
    vegan: ["vegan"],
    eggetarian: ["vegetarian", "vegan", "eggetarian"],
    "high-protein": ["high-protein"],
    "low-carb": ["low-carb"],
    "gluten-free": ["gluten-free"],
  };

  const MEAL_SPLIT = [
    ["Breakfast", "breakfast", 0.25],
    ["Lunch", "lunch", 0.35],
    ["Snack", "snack", 0.10],
    ["Dinner", "dinner", 0.30],
  ];

  const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, "very active": 1.9 };
  const GOAL = { maintain: 0, lose: -400, gain: 400 };
  const NOTE = "Calorie figures are estimates from a standard formula and the recipe dataset. " +
               "For medical conditions, pregnancy or a supervised diet, check with a qualified dietitian.";

  const meta = () => State.meta || { synonyms: {}, substitutions: {}, staples: [], shelf_life_days: {} };

  function normalise(name) {
    const key = String(name || "").trim().toLowerCase().replace(/_/g, " ");
    return meta().synonyms[key] || key;
  }

  function coverage(required, have) {
    const staples = meta().staples || [];
    const matched = [], missing = [];
    required.forEach((e) => {
      const item = normalise(e.item);
      (have.has(item) || staples.includes(item) ? matched : missing).push(item);
    });
    return { matched, missing, ratio: matched.length / (required.length || 1) };
  }

  function substitutes(missing, have) {
    const subs = meta().substitutions || {};
    return missing.map((item) => {
      const options = subs[item] || [];
      const owned = options.find((o) => have.has(normalise(o)));
      if (owned) return { missing: item, use_instead: owned, in_your_fridge: true };
      if (options.length) return { missing: item, use_instead: options[0], in_your_fridge: false };
      return null;
    }).filter(Boolean);
  }

  function scale(entries, base, servings) {
    const f = servings / (base || 1);
    return entries.map((e) => {
      let qty = Math.round(e.qty * f * 100) / 100;
      if (qty === Math.trunc(qty)) qty = Math.trunc(qty);
      return { item: e.item, qty, unit: e.unit };
    });
  }

  function shelfLife(item) {
    const table = meta().shelf_life_days || {};
    return table[item] !== undefined ? table[item] : 30;
  }

  function dietAllows(recipe, diet) {
    const rule = DIET_RULES[diet];
    if (!rule) return true;
    return recipe.diet_tags.some((t) => rule.includes(t));
  }

  /* -------------------------------- match ------------------------------- */
  function match(opts) {
    const recipes = State.data || [];
    const have = new Set((opts.ingredients || []).map(normalise));
    const blocked = new Set((opts.exclude || []).map(normalise));
    const servings = Math.max(1, opts.servings || 1);
    const out = [];

    recipes.forEach((recipe) => {
      if (!dietAllows(recipe, opts.diet)) return;
      if (opts.meal_type && !recipe.meal_type.includes(opts.meal_type)) return;
      if (opts.max_time && recipe.time_minutes > opts.max_time) return;

      const all = [...recipe.core_ingredients, ...recipe.optional_ingredients].map((e) => normalise(e.item));
      if (all.some((i) => blocked.has(i))) return;

      const core = coverage(recipe.core_ingredients, have);
      const optional = coverage(recipe.optional_ingredients, have);

      let urgency = 0;
      if (core.matched.length) {
        const shortest = Math.min(...core.matched.map(shelfLife));
        urgency = Math.max(0, (30 - shortest) / 30);
      }
      const simplicity = Math.max(0, (60 - recipe.time_minutes) / 60);
      const score = 0.70 * core.ratio + 0.15 * optional.ratio + 0.10 * urgency + 0.05 * simplicity;
      if (score < (opts.min_score || 0.35)) return;

      const per = recipe.nutrition_per_serving;
      const total = {};
      Object.keys(per).forEach((k) => { total[k] = Math.round(per[k] * servings * 10) / 10; });

      out.push({
        id: recipe.id,
        name: recipe.name,
        cuisine: recipe.cuisine,
        meal_type: recipe.meal_type,
        diet_tags: recipe.diet_tags,
        difficulty: recipe.difficulty,
        time_minutes: recipe.time_minutes,
        servings,
        match_percent: Math.round(score * 100),
        core_coverage_percent: Math.round(core.ratio * 100),
        used_ingredients: [...core.matched, ...optional.matched],
        missing_ingredients: core.missing,
        substitution_tips: substitutes(core.missing, have),
        ingredients: scale(recipe.core_ingredients, recipe.base_servings, servings),
        optional_ingredients: scale(recipe.optional_ingredients, recipe.base_servings, servings),
        steps: recipe.steps,
        nutrition: { per_serving: per, total },
      });
    });

    out.sort((a, b) => b.match_percent - a.match_percent ||
                       a.missing_ingredients.length - b.missing_ingredients.length);
    return out.slice(0, opts.limit || 10);
  }

  /* ------------------------------- energy ------------------------------- */
  function energy(p) {
    const female = String(p.sex || "male").toLowerCase().startsWith("f");
    const bmr = female
      ? 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age - 161
      : 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age + 5;
    const maintenance = bmr * (ACTIVITY[p.activity] || 1.55);
    const floor = female ? 1200 : 1500;
    const target = Math.max(maintenance + (GOAL[p.goal] || 0), floor);
    return {
      bmr: Math.round(bmr),
      maintenance_calories: Math.round(maintenance),
      target_calories: Math.round(target),
      protein_g: Math.round(p.weight_kg * 1.4),
      note: NOTE,
    };
  }

  /* -------------------------------- plan -------------------------------- */
  function plan(opts) {
    const profile = opts.profile ? energy(opts.profile) : null;
    const target = opts.target_calories || (profile ? profile.target_calories : 2000);
    const days = Math.max(1, Math.min(opts.days || 3, 7));
    const people = Math.max(1, opts.people || 1);
    const used = new Set();
    const plan = [];

    for (let day = 1; day <= days; day++) {
      const meals = [];
      let cals = 0, prot = 0;

      MEAL_SPLIT.forEach(([label, mealType, share]) => {
        const pool = match({
          ingredients: opts.ingredients, servings: people, diet: opts.diet,
          meal_type: mealType, exclude: opts.exclude, limit: 12, min_score: 0.30,
        });
        const fresh = pool.filter((r) => !used.has(r.id));
        const choices = (fresh.length ? fresh : pool).slice(0, 6);

        if (!choices.length) {
          meals.push({ slot: label, recipe: null,
            note: "No dish in the dataset fits this slot with the current ingredients." });
          return;
        }

        const slotTarget = target * share;
        const best = choices.reduce((a, b) => {
          const cost = (r) => Math.abs(r.nutrition.per_serving.calories - slotTarget) - (r.match_percent / 100) * 60;
          return cost(b) < cost(a) ? b : a;
        });

        used.add(best.id);
        cals += best.nutrition.per_serving.calories;
        prot += best.nutrition.per_serving.protein_g;

        meals.push({ slot: label, recipe: {
          id: best.id, name: best.name, time_minutes: best.time_minutes,
          match_percent: best.match_percent, missing_ingredients: best.missing_ingredients,
          calories_per_serving: best.nutrition.per_serving.calories,
          protein_per_serving: best.nutrition.per_serving.protein_g,
          servings: people,
        }});
      });

      plan.push({ day, meals, day_total: {
        calories_per_person: Math.round(cals),
        protein_g_per_person: Math.round(prot * 10) / 10,
        calories_for_household: Math.round(cals * people),
      }});
    }

    const missing = {};
    plan.forEach((d) => d.meals.forEach((m) => {
      if (m.recipe) m.recipe.missing_ingredients.forEach((i) => { missing[i] = (missing[i] || 0) + 1; });
    }));

    return {
      days, people, diet: opts.diet,
      target_calories_per_person: Math.round(target),
      energy_profile: profile,
      plan,
      shopping_list: Object.entries(missing)
        .sort((a, b) => b[1] - a[1])
        .map(([item, n]) => ({ item, needed_for_meals: n })),
      note: NOTE,
    };
  }

  return { match, plan, energy };
})();
