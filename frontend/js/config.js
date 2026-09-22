/* ============================================================
   config.js  -  THE ONLY FILE YOU EDIT WHEN YOU CHANGE HOSTING
   ============================================================

   API_BASE tells the frontend where the Python backend lives.

   1. Running everything locally with python app.py
         API_BASE: ""            <- leave it empty, same origin

   2. Frontend on your web host, backend on Render/Railway/PythonAnywhere
         API_BASE: "https://your-backend-name.onrender.com"

   3. Frontend only, no Python anywhere (static hosting like GitHub Pages,
      Netlify, Hostinger, cPanel)
         API_BASE: ""  and  OFFLINE_MODE: true
      The whole app then runs in the browser using recipes.json and the
      TensorFlow.js detector. Nothing else to configure.
*/

const CONFIG = {
  API_BASE: "",
  OFFLINE_MODE: false,      // set true if you are not running the Python server
  DATA_URL: "../backend/data/recipes.json",
  INGREDIENT_DATA_URL: "../backend/data/ingredients.json",
  MIN_CONFIDENCE: 0.45,     // detector threshold, 0 to 1
};
