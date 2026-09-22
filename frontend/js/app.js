/* ============================================================
   app.js  -  everything the page does
   ============================================================ */

const State = {
  ingredients: new Map(),   // name -> {name, confidence, category}
  offline: CONFIG.OFFLINE_MODE,
  data: null,               // recipes.json, only loaded in offline mode
  meta: null,               // ingredients.json, only loaded in offline mode
};

/* ------------------------------ helpers ------------------------------ */
const $ = (id) => document.getElementById(id);

function toast(message, isError) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

async function api(path, options) {
  const res = await fetch(CONFIG.API_BASE + path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function splitList(value) {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/* ------------------------- start-up / health ------------------------- */
async function boot() {
  Detector.init(onDetection);
  wireUi();

  if (State.offline) {
    await loadOfflineData();
    $("serverStatus").textContent = "browser mode";
    $("serverStatus").className = "status ok";
    $("statDetector").textContent = "in browser";
    return;
  }

  try {
    const health = await api("/api/health");
    const usingYolo = health.server_detector === "yolo";
    Detector.setServerYolo(usingYolo);
    $("serverStatus").textContent = "server connected";
    $("serverStatus").className = "status ok";
    $("statDetector").textContent = usingYolo ? "YOLO on server" : "in browser";

    // Category colours for the chips come from the same data file.
    fetch(CONFIG.INGREDIENT_DATA_URL).then((r) => r.json())
      .then((m) => { State.meta = m; }).catch(() => {});

    const list = await api("/api/ingredients");
    fillDatalist(list.ingredients);
    $("statIngredients").textContent = list.ingredients.length;
  } catch (err) {
    State.offline = true;
    await loadOfflineData();
    $("serverStatus").textContent = "browser mode";
    $("serverStatus").className = "status";
    $("statDetector").textContent = "in browser";
  }
}

async function loadOfflineData() {
  try {
    const [recipes, meta] = await Promise.all([
      fetch(CONFIG.DATA_URL).then((r) => r.json()),
      fetch(CONFIG.INGREDIENT_DATA_URL).then((r) => r.json()),
    ]);
    State.data = recipes;
    State.meta = meta;
    const names = new Set();
    recipes.forEach((r) =>
      [...r.core_ingredients, ...r.optional_ingredients].forEach((e) => names.add(e.item)));
    fillDatalist([...names].sort());
    $("statRecipes").textContent = recipes.length;
    $("statIngredients").textContent = names.size;
  } catch (e) {
    toast("Could not load recipes.json. Check the path in config.js.", true);
  }
}

function fillDatalist(names) {
  $("ingredientList").innerHTML = names.map((n) => `<option value="${n}">`).join("");
}

/* --------------------------- ingredient list -------------------------- */
const CATEGORY_OF = (name) => {
  const cats = State.meta ? State.meta.categories : null;
  if (!cats) return "other";
  for (const [cat, list] of Object.entries(cats)) if (list.includes(name)) return cat;
  return "other";
};

function addIngredient(name, confidence) {
  const key = String(name).trim().toLowerCase();
  if (!key) return;
  if (!State.ingredients.has(key)) {
    State.ingredients.set(key, { name: key, confidence, category: CATEGORY_OF(key) });
  }
  renderChips();
}

function removeIngredient(key) {
  State.ingredients.delete(key);
  renderChips();
}

function renderChips() {
  const box = $("chips");
  if (State.ingredients.size === 0) {
    box.innerHTML = '<li class="chips-empty">Nothing on the shelf yet. Detect a photo or type an ingredient above.</li>';
    return;
  }
  box.innerHTML = [...State.ingredients.values()].map((item) => `
    <li class="chip" data-cat="${item.category}">
      <span>${item.name}</span>
      ${item.confidence ? `<span class="chip-conf">${Math.round(item.confidence * 100)}%</span>` : ""}
      <button class="chip-x" data-key="${item.name}" aria-label="Remove ${item.name}">&times;</button>
    </li>`).join("");

  box.querySelectorAll(".chip-x").forEach((b) =>
    b.addEventListener("click", () => removeIngredient(b.dataset.key)));
}

function onDetection(result) {
  if (!result.items.length) {
    toast("Nothing recognised in that photo. Add the items by hand below.", true);
    return;
  }
  result.items.forEach((it) => addIngredient(it.ingredient, it.confidence));
  toast(`${result.items.length} item(s) found. Check the list before cooking.`);
  document.getElementById("shelf").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ------------------------------ recipes ------------------------------ */
async function findRecipes() {
  const ingredients = [...State.ingredients.keys()];
  if (!ingredients.length) { toast("Add at least one ingredient first.", true); return; }

  const payload = {
    ingredients,
    servings: Number($("servings").value) || 2,
    diet: $("diet").value,
    meal_type: $("mealType").value || null,
    max_time: $("maxTime").value ? Number($("maxTime").value) : null,
    exclude: splitList($("exclude").value),
    limit: 8,
  };

  const btn = $("btnFind");
  btn.disabled = true;
  btn.textContent = "Searching…";

  try {
    const data = State.offline
      ? { recipes: OfflineEngine.match(payload) }
      : await api("/api/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    renderRecipes(data.recipes, payload.servings);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Find recipes";
  }
}

function renderRecipes(recipes, servings) {
  const box = $("recipeList");
  if (!recipes.length) {
    box.innerHTML = `<p class="empty-state">Nothing matched. Try removing a filter, or add one or two more ingredients.</p>`;
    return;
  }

  box.innerHTML = recipes.map((r) => {
    const missing = r.missing_ingredients.length
      ? `<p class="missing">Missing: ${r.missing_ingredients.join(", ")}</p>` : "";
    const tips = (r.substitution_tips || []).map((t) =>
      `<p class="sub-tip">No ${t.missing}? Use ${t.use_instead}${t.in_your_fridge ? " — you already have it" : ""}.</p>`).join("");

    return `
    <article class="recipe">
      <div class="recipe-head">
        <h3>${r.name}</h3>
        <span class="meta">${r.cuisine} &middot; ${r.time_minutes} min &middot; ${r.difficulty} &middot; serves ${r.servings}</span>
        <span class="score ${r.match_percent < 70 ? "low" : ""}">${r.match_percent}% match</span>
      </div>
      <div class="recipe-body">
        <div>
          <h4>Ingredients for ${r.servings}</h4>
          <ul class="ing-list">
            ${r.ingredients.map((i) => `<li>${i.qty} ${i.unit} ${i.item}</li>`).join("")}
          </ul>
          ${missing}${tips}
        </div>
        <div>
          <h4>Method</h4>
          <ol class="step-list">${r.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        </div>
      </div>
      <div class="nutri">
        <div>Per serving<b>${r.nutrition.per_serving.calories} kcal</b></div>
        <div>Protein<b>${r.nutrition.per_serving.protein_g} g</b></div>
        <div>Carbs<b>${r.nutrition.per_serving.carbs_g} g</b></div>
        <div>Fat<b>${r.nutrition.per_serving.fat_g} g</b></div>
        <div>Whole dish<b>${r.nutrition.total.calories} kcal</b></div>
      </div>
    </article>`;
  }).join("");

  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ----------------------------- diet plan ----------------------------- */
async function buildPlan() {
  const ingredients = [...State.ingredients.keys()];
  if (!ingredients.length) { toast("Add ingredients before planning meals.", true); return; }

  const payload = {
    ingredients,
    days: Number($("pDays").value) || 3,
    people: Number($("servings").value) || 1,
    diet: $("diet").value,
    exclude: splitList($("exclude").value),
    profile: {
      age: Number($("pAge").value),
      sex: $("pSex").value,
      weight_kg: Number($("pWeight").value),
      height_cm: Number($("pHeight").value),
      activity: $("pActivity").value,
      goal: $("pGoal").value,
    },
  };

  const btn = $("btnPlan");
  btn.disabled = true;
  btn.textContent = "Planning…";

  try {
    const data = State.offline
      ? OfflineEngine.plan(payload)
      : await api("/api/diet-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    renderPlan(data);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Build the plan";
  }
}

function renderPlan(data) {
  const e = data.energy_profile || {};
  const days = data.plan.map((d) => `
    <div class="day-card">
      <h3>Day ${d.day}</h3>
      ${d.meals.map((m) => m.recipe ? `
        <div class="meal-row">
          <span class="meal-slot">${m.slot}</span>
          <span class="meal-name">${m.recipe.name}</span>
          <span class="meta">${m.recipe.calories_per_serving} kcal &middot; ${m.recipe.protein_per_serving} g protein &middot; ${m.recipe.time_minutes} min</span>
        </div>` : `
        <div class="meal-row">
          <span class="meal-slot">${m.slot}</span>
          <span class="meta">${m.note}</span>
        </div>`).join("")}
      <p class="day-total">Day total per person: ${d.day_total.calories_per_person} kcal, ${d.day_total.protein_g_per_person} g protein.</p>
    </div>`).join("");

  const shopping = data.shopping_list.length ? `
    <div class="shop-list">
      <h3>Buy these to finish the plan</h3>
      <ul>${data.shopping_list.map((s) => `<li>${s.item} — needed for ${s.needed_for_meals} meal(s)</li>`).join("")}</ul>
    </div>` : "";

  $("planOut").innerHTML = `
    <div class="energy-box">
      <div>Resting energy<b>${e.bmr || "—"} kcal</b></div>
      <div>Maintenance<b>${e.maintenance_calories || "—"} kcal</b></div>
      <div>Daily target<b>${data.target_calories_per_person} kcal</b></div>
      <div>Protein target<b>${e.protein_g || "—"} g</b></div>
    </div>
    ${days}
    ${shopping}
    <p class="small">${data.note}</p>`;
}

/* ------------------------------- wiring ------------------------------ */
function wireUi() {
  $("addForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    addIngredient($("addInput").value);
    $("addInput").value = "";
  });
  $("btnClear").addEventListener("click", () => { State.ingredients.clear(); renderChips(); });
  $("btnFind").addEventListener("click", findRecipes);
  $("btnPlan").addEventListener("click", buildPlan);
}

document.addEventListener("DOMContentLoaded", boot);
