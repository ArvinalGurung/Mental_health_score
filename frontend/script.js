"use strict";

/* ------------------------------------------------------------------
   Config – the only place you need to edit if the backend moves.
------------------------------------------------------------------- */
const API_BASE = "http://127.0.0.1:8000";
const PREDICT_URL = `${API_BASE}/predict`;
const REQUEST_TIMEOUT_MS = 20000;

/* Facts measured from the training notebook (df.describe(), 5,000 rows) */
const TRAIN = {
  score: { min: 3.6, q1: 5.1, median: 6.1, q3: 7.1, max: 9.4 },
  age: { min: 18, max: 24 },
  avg_daily_usage_hours: { label: "Daily usage", unit: "h", mean: 5.08, min: 1.0, max: 8.8 },
  daily_unlocks: { label: "Phone unlocks", unit: "", mean: 171.5, min: 62, max: 273 },
  study_hours: { label: "Study hours", unit: "h", mean: 3.01, min: 0.3, max: 8.3 },
  physical_activity_hours: { label: "Physical activity", unit: "h", mean: 1.75, min: 0, max: 4.1 },
  sleep_hours_per_night: { label: "Sleep", unit: "h", mean: 6.63, min: 3.6, max: 9.9 },
};

/* Global feature importance read from the saved Random Forest
   (one-hot columns summed back into their original feature). */
const IMPORTANCE = [
  ["Daily usage hours", 69.2], ["Sleep hours", 10.7], ["Phone unlocks", 5.2],
  ["Study hours", 3.1], ["Most used platform", 3.1], ["Physical activity", 2.9],
  ["Age", 1.9], ["Purpose of use", 1.7], ["Gender", 0.8],
  ["Academic level", 0.7], ["Stress level", 0.6], ["Country", 0.0],
];

const $ = (s, r = document) => r.querySelector(s);
const form = $("#predictForm");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------
   Navigation
------------------------------------------------------------------- */
const menuBtn = $("#menuBtn");
const navLinks = $("#navLinks");
menuBtn.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", String(open));
});
navLinks.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    navLinks.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
  }
});

/* ------------------------------------------------------------------
   Sliders: live value + filled track
------------------------------------------------------------------- */
function syncSlider(el) {
  const out = document.getElementById(el.dataset.out);
  if (out) out.textContent = `${Number(el.value).toFixed(1)}${el.dataset.unit || ""}`;
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--p", `${pct}%`);
}
form.querySelectorAll('input[type="range"]').forEach((el) => {
  syncSlider(el);
  el.addEventListener("input", () => syncSlider(el));
});

/* ------------------------------------------------------------------
   Backend status chip
------------------------------------------------------------------- */
async function checkBackend() {
  const chip = $("#apiStatus");
  const text = $("#apiStatusText");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${API_BASE}/`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error("bad status");
    chip.className = "status ok";
    text.textContent = "Model server connected";
  } catch {
    chip.className = "status bad";
    text.textContent = "Model server not reachable – start the backend";
  }
}
checkBackend();

/* ------------------------------------------------------------------
   Validation – mirrors the Pydantic constraints in main.py
------------------------------------------------------------------- */
const SELECTS = ["gender", "country", "academic_level", "most_used_platform", "purpose_of_use"];

function setError(name, msg) {
  const holder = form.querySelector(`.err[data-for="${name}"]`);
  if (!holder) return;
  holder.textContent = msg || "";
  const field = holder.closest(".field");
  if (field) field.classList.toggle("invalid", Boolean(msg));
}

function validate() {
  const errors = {};
  const v = (n) => form.elements[n].value;

  // age: int, 10–100
  const age = v("age");
  if (age === "") errors.age = "Enter your age.";
  else if (!Number.isInteger(Number(age))) errors.age = "Age must be a whole number.";
  else if (Number(age) < 10 || Number(age) > 100) errors.age = "Age must be between 10 and 100.";

  SELECTS.forEach((n) => { if (!v(n)) errors[n] = "Choose an option."; });

  // daily_unlocks: int, >= 0
  const unlocks = v("daily_unlocks");
  if (unlocks === "") errors.daily_unlocks = "Enter your unlocks per day.";
  else if (!Number.isInteger(Number(unlocks))) errors.daily_unlocks = "Use a whole number.";
  else if (Number(unlocks) < 0) errors.daily_unlocks = "Cannot be negative.";

  if (!form.querySelector('input[name="stress_level"]:checked')) errors.stress_level = "Pick your stress level.";

  return errors;
}

form.addEventListener("input", (e) => { if (e.target.name) setError(e.target.name, ""); });
form.addEventListener("change", (e) => { if (e.target.name) setError(e.target.name, ""); });

/* ------------------------------------------------------------------
   Build the request body – field names exactly as in StudentData
------------------------------------------------------------------- */
function buildPayload() {
  const f = form.elements;
  return {
    age: parseInt(f.age.value, 10),
    gender: f.gender.value,
    country: f.country.value,
    academic_level: f.academic_level.value,
    most_used_platform: f.most_used_platform.value,
    purpose_of_use: f.purpose_of_use.value,
    avg_daily_usage_hours: parseFloat(f.avg_daily_usage_hours.value),
    daily_unlocks: parseInt(f.daily_unlocks.value, 10),
    study_hours: parseFloat(f.study_hours.value),
    physical_activity_hours: parseFloat(f.physical_activity_hours.value),
    sleep_hours_per_night: parseFloat(f.sleep_hours_per_night.value),
    stress_level: form.querySelector('input[name="stress_level"]:checked').value,
  };
}

/* ------------------------------------------------------------------
   Submit
------------------------------------------------------------------- */
const submitBtn = $("#submitBtn");
const formError = $("#formError");

function showFormError(msg) { formError.textContent = msg; formError.hidden = false; }
function clearFormError() { formError.hidden = true; formError.textContent = ""; }

function describeApiError(status, body) {
  if (status === 422 && body && Array.isArray(body.detail)) {
    return "The server rejected some values: " + body.detail
      .map((d) => `${(d.loc || []).slice(1).join(".") || "input"} – ${d.msg}`).join("; ");
  }
  if (status >= 500) return "The model server hit an error while predicting. Check the terminal running uvicorn for details.";
  return `The server responded with an unexpected status (${status}).`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearFormError();

  const errors = validate();
  SELECTS.concat(["age", "daily_unlocks", "stress_level"]).forEach((n) => setError(n, errors[n]));
  const firstBad = Object.keys(errors)[0];
  if (firstBad) {
    showFormError("Some answers are missing or invalid. Fix the highlighted fields and try again.");
    const target = form.querySelector(`[name="${firstBad}"]`);
    if (target) target.focus();
    return;
  }

  const payload = buildPayload();
  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  $(".btn-label", submitBtn).textContent = "Predicting…";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(PREDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }

    if (!res.ok) throw Object.assign(new Error(describeApiError(res.status, body)), { handled: true });
    if (!body || typeof body.mental_score !== "number") {
      throw Object.assign(new Error("The server's reply did not contain a mental_score."), { handled: true });
    }
    renderResults(body.mental_score, payload);
    checkBackend();
  } catch (err) {
    if (err.handled) showFormError(err.message);
    else if (err.name === "AbortError") showFormError("The request timed out. Make sure the backend is running, then try again.");
    else showFormError(`Could not reach the model server at ${API_BASE}. Start it with "uvicorn main:app --reload" and try again.`);
    checkBackend();
  } finally {
    clearTimeout(timer);
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
    $(".btn-label", submitBtn).textContent = "Predict my score";
  }
});

$("#resetBtn").addEventListener("click", () => {
  form.reset();
  form.querySelectorAll('input[type="range"]').forEach(syncSlider);
  form.querySelectorAll(".err").forEach((e) => { e.textContent = ""; });
  form.querySelectorAll(".invalid").forEach((e) => e.classList.remove("invalid"));
  clearFormError();
});

/* ------------------------------------------------------------------
   Results dashboard
------------------------------------------------------------------- */
function band(score) {
  const s = TRAIN.score;
  if (score < s.q1) return ["Lower than most students in the training data",
    `Your estimate sits in the lowest quarter of scores in the dataset (below ${s.q1}). The model links your answers to students who reported lower wellbeing.`];
  if (score <= s.q3) return ["Around the middle of the training data",
    `Your estimate falls within the middle half of scores in the dataset (${s.q1} to ${s.q3}). The median score was ${s.median}.`];
  return ["Higher than most students in the training data",
    `Your estimate sits in the top quarter of scores in the dataset (above ${s.q3}). The model links your answers to students who reported higher wellbeing.`];
}

function animateNumber(el, to) {
  if (reduceMotion) { el.textContent = to.toFixed(1); return; }
  const start = performance.now(), dur = 1400;
  (function tick(now) {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (to * eased).toFixed(1);
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

function renderResults(score, p) {
  const section = $("#results");
  section.hidden = false;

  // Gauge (0–10)
  const pct = Math.max(0, Math.min(score / 10, 1)) * 100;
  const fill = $("#gaugeFill");
  fill.style.transition = "none";
  fill.setAttribute("stroke-dashoffset", "100");
  void fill.getBoundingClientRect();
  fill.style.transition = "";
  requestAnimationFrame(() => fill.setAttribute("stroke-dashoffset", String(100 - pct)));
  animateNumber($("#scoreValue"), score);

  const [title, text] = band(score);
  $("#bandTitle").textContent = title;
  $("#bandText").textContent = text;

  // Position on the training range
  const s = TRAIN.score, span = s.max - s.min;
  const pos = (x) => `${Math.max(0, Math.min((x - s.min) / span, 1)) * 100}%`;
  $("#q1").style.left = pos(s.q1);
  $("#q2").style.left = pos(s.median);
  $("#q3").style.left = pos(s.q3);
  requestAnimationFrame(() => { $("#marker").style.left = pos(score); });

  // Comparison bars
  const cmp = $("#compare");
  cmp.innerHTML = "";
  ["avg_daily_usage_hours", "sleep_hours_per_night", "study_hours", "physical_activity_hours", "daily_unlocks"].forEach((k) => {
    const t = TRAIN[k], val = p[k];
    const diff = val - t.mean;
    const fmt = (n) => (k === "daily_unlocks" ? Math.round(n) : n.toFixed(1)) + (t.unit ? " " + t.unit : "");
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    const row = document.createElement("div");
    row.innerHTML = `
      <div class="row-head"><b>${t.label}</b><span>${fmt(val)} <small>(${sign}${fmt(Math.abs(diff))} vs avg ${fmt(t.mean)})</small></span></div>
      <div class="bar"><i></i><em style="left:${(t.mean / t.max) * 100}%"></em></div>`;
    cmp.appendChild(row);
    requestAnimationFrame(() => { row.querySelector("i").style.width = Math.min(val / t.max, 1) * 100 + "%"; });
  });

  // Feature importance
  const imp = $("#importance");
  imp.innerHTML = "";
  const top = IMPORTANCE[0][1];
  IMPORTANCE.forEach(([name, v]) => {
    const row = document.createElement("div");
    row.innerHTML = `
      <div class="row-head"><b>${name}</b><span>${v.toFixed(1)}%</span></div>
      <div class="bar"><i></i></div>`;
    imp.appendChild(row);
    requestAnimationFrame(() => { row.querySelector("i").style.width = (v / top) * 100 + "%"; });
  });

  // Notes
  const notes = [];
  if (p.age < TRAIN.age.min || p.age > TRAIN.age.max)
    notes.push(`Age ${p.age} is outside the 18–24 range the model learned from, so this estimate is less reliable.`);
  ["avg_daily_usage_hours", "daily_unlocks", "study_hours", "physical_activity_hours", "sleep_hours_per_night"].forEach((k) => {
    const t = TRAIN[k];
    if (p[k] < t.min || p[k] > t.max)
      notes.push(`${t.label} of ${p[k]} is outside the training range (${t.min}–${t.max}). The model can't tell what happens beyond it.`);
  });
  if (p.country !== "Other")
    notes.push("The saved model groups all countries as “Other”, so your country choice did not change the result.");
  notes.push("Stress level has very little influence in this model, even though it matters a lot in real life.");
  notes.push("This shows a pattern in survey data, not a cause. It is not a diagnosis.");
  $("#notes").innerHTML = notes.map((n) => `<li>${n}</li>`).join("");

  section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
