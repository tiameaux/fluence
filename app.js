/* Mots — entraînement quotidien au rappel lexical.
   Tout l'état vit dans localStorage (clé KEY). Export / import JSON dans Réglages. */
(function () {
  "use strict";

  // ---------- Constantes ----------
  const KEY = "mots.v1";
  const STAGES_DONE = 5; // 5 rappels réussis = acquis
  // Intervalle (en jours) programmé après avoir atteint le palier n
  const RANGES = { 1: [3, 6], 2: [10, 15], 3: [25, 40], 4: [80, 100] };
  const RELEARN_GAP = 6; // un mot raté en séance revient ~6 cartes plus loin (une seule fois)
  const SEC_PER_ITEM = 10; // estimation affichée sur l'accueil
  const CAT = { N: "Nom", V: "Verbe", A: "Adjectif", R: "Adverbe" };

  const BANK = (window.WORDS || []).filter(w => w && w.w && w.prompt);
  const BY_W = Object.fromEntries(BANK.map(w => [w.w, w]));

  // ---------- Dates ----------
  const today = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ, heure locale
  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dt.toLocaleDateString("sv-SE");
  }
  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }

  // ---------- État ----------
  function blank() {
    return { v: 1, progress: {}, log: [], settings: { newPerDay: 25, minutes: 15 }, daily: { date: "", introduced: 0 }, days: [] };
  }
  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const s = Object.assign(blank(), JSON.parse(raw));
      s.settings = Object.assign(blank().settings, s.settings || {});
      return s;
    } catch (e) { return blank(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast("Sauvegarde impossible sur cet appareil. Exporte tes données depuis Réglages."); }
  }
  function introducedToday() { return S.daily.date === today() ? S.daily.introduced : 0; }

  // ---------- Planification ----------
  // Palier = nombre de rappels réussis. Réussite : palier+1, prochaine date tirée dans RANGES[palier].
  // « Mot accepté » compte comme réussite, avec la borne basse de l'intervalle.
  // Échec : retour le lendemain, palier-2 (plancher 0), pour qu'une nouvelle réussite reprogramme l'intervalle précédent.
  function schedule(w, result) {
    const t = today();
    let p = S.progress[w];
    if (!p) {
      p = S.progress[w] = { stage: 0, due: t, seen: 0, lapses: 0, status: "active", first: t };
      if (S.daily.date !== t) S.daily = { date: t, introduced: 0, bonus: 0 };
      S.daily.introduced++;
    }
    p.seen++;
    p.last = t;
    if (result === "T" || result === "A") {
      p.stage++;
      if (p.stage >= STAGES_DONE) { p.status = "done"; p.due = null; }
      else {
        const [a, b] = RANGES[p.stage];
        p.due = addDays(t, result === "A" ? a : randInt(a, b));
      }
    } else {
      p.lapses++;
      p.stage = Math.max(0, p.stage - 2);
      p.due = addDays(t, 1);
    }
  }

  function dueReviews() {
    const t = today();
    return Object.entries(S.progress)
      .filter(([w, p]) => p.status === "active" && p.due && p.due <= t && BY_W[w])
      .sort((a, b) => a[1].due.localeCompare(b[1].due))
      .map(([w]) => w);
  }
  function freshWords() { return BANK.filter(x => !S.progress[x.w]).map(x => x.w); }
  function bonusToday() { return S.daily.date === today() ? (S.daily.bonus || 0) : 0; }
  function newQuota() { return Math.max(0, S.settings.newPerDay + bonusToday() - introducedToday()); }

  // Choix des nouveaux mots : les mots déjà vus pendant le tri (calib) passent après les inédits
  // pendant les 3 premières semaines, puis sont mélangés aux autres.
  const CALIB_DELAY_DAYS = 21;
  function daysBetween(a, b) {
    const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
  }
  function pickNew(n) {
    const pool = freshWords();
    const start = S.days.length ? S.days[0] : today();
    if (daysBetween(start, today()) >= CALIB_DELAY_DAYS) return shuffle(pool).slice(0, n);
    const inedits = pool.filter(w => !BY_W[w].calib), calib = pool.filter(w => BY_W[w].calib);
    return shuffle(inedits).concat(shuffle(calib)).slice(0, n);
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function buildQueue() {
    const rev = shuffle(dueReviews());
    const nw = pickNew(newQuota());
    // Répartit les nouveaux mots régulièrement entre les révisions
    const q = [];
    const total = rev.length + nw.length;
    let ri = 0, ni = 0;
    for (let k = 0; k < total; k++) {
      const wantNew = nw.length && (ni + 1) / nw.length <= (k + 1) / total + 1e-9;
      if ((wantNew && ni < nw.length) || ri >= rev.length) q.push({ w: nw[ni++], isNew: true });
      else q.push({ w: rev[ri++], isNew: false });
    }
    return q;
  }

  // ---------- Séance ----------
  let run = null; // {queue, i, t0Session, t0Item, results:[], relearned:Set, extended}
  function startSession() {
    const queue = buildQueue();
    if (!queue.length) { toast("Rien à faire aujourd'hui. Reviens demain ou augmente les nouveaux mots dans Réglages."); return; }
    run = { queue, i: 0, t0Session: Date.now(), results: [], relearned: new Set(), extended: false };
    showPrompt();
  }
  function current() { return run.queue[run.i]; }
  function elapsedMin() { return (Date.now() - run.t0Session) / 60000; }

  function answer(outcome, latency) {
    // outcome: "T" cible, "A" accepté, "X" autre/rien, "S" séché
    const item = current();
    const p = S.progress[item.w];
    const stageBefore = p ? p.stage : -1;
    if (!item.relearn) schedule(item.w, outcome);
    S.log.push([Date.now(), item.w, stageBefore, outcome, Math.round(latency), item.relearn ? 1 : 0, item.v || 0]);
    if (S.log.length > 20000) S.log = S.log.slice(-20000);
    run.results.push({ w: item.w, outcome, latency, relearn: !!item.relearn, isNew: item.isNew });
    // Reprise en fin de séance : un mot raté revient une fois quelques cartes plus loin
    if ((outcome === "X" || outcome === "S") && !item.relearn && !run.relearned.has(item.w)) {
      run.relearned.add(item.w);
      const pos = Math.min(run.queue.length, run.i + 1 + RELEARN_GAP);
      run.queue.splice(pos, 0, { w: item.w, isNew: false, relearn: true });
    }
    markDay();
    save();
    next();
  }
  function markDay() {
    const t = today();
    if (!S.days.includes(t)) { S.days.push(t); if (S.days.length > 800) S.days = S.days.slice(-800); }
  }
  function next() {
    run.i++;
    if (run.i >= run.queue.length) {
      // File vide avant la fin du temps prévu : on puise dans le stock de nouveaux mots
      const extra = elapsedMin() < S.settings.minutes ? pickNew(10).filter(w => !run.queue.some(q => q.w === w)) : [];
      if (!extra.length) return showEnd(false);
      extra.forEach(w => run.queue.push({ w, isNew: true }));
    }
    if (!run.extended && elapsedMin() >= S.settings.minutes) return showEnd(true);
    showPrompt();
  }
  function discardCurrent() {
    const item = current();
    const w = item.w;
    const before = S.progress[w] ? JSON.parse(JSON.stringify(S.progress[w])) : null;
    S.progress[w] = Object.assign(S.progress[w] || { stage: 0, seen: 0, lapses: 0, first: today() }, { status: "discarded", due: null, discardedOn: today() });
    // retire aussi une éventuelle reprise en attente
    run.queue = run.queue.filter((q, k) => k <= run.i || q.w !== w);
    save();
    toast("« " + w + " » retiré de ta liste.", "Annuler", () => {
      if (before) S.progress[w] = before; else delete S.progress[w];
      save();
      toast("« " + w + " » est de retour.");
    });
    next();
  }

  // ---------- Rendu ----------
  const $app = document.getElementById("app");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function renderPrompt(p) {
    return esc(p)
      .replace(/___/g, '<span class="gap" aria-label="mot à trouver"></span>')
      .replace(/«([^»]+)»/g, '<span class="vs">« $1 »</span>')
      .replace(/\*([^*]+)\*/g, '<em class="en" lang="en">$1</em>');
  }
  // Met en gras la forme du mot cible dans la phrase d'exemple (repérage par radical, sans garantie)
  function highlight(sentence, lemma) {
    const core = lemma.replace(/^(se |s'|s’)/, "").split(" ")[0];
    const stem = core.slice(0, Math.max(4, Math.min(core.length - 2, 7)));
    const safe = esc(sentence);
    if (stem.length < 3) return safe;
    const re = new RegExp("(^|[^\\p{L}])(" + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\p{L}'’-]*)", "iu");
    return safe.replace(re, "$1<b>$2</b>");
  }
  // Alterne les prompts d'un mot au fil des présentations (prompt principal, puis alt, puis principal…)
  function variants(w) { const v = [{ type: w.type, prompt: w.prompt }]; if (w.alt && w.alt.prompt) v.push(w.alt); return v; }
  function variantIndex(item) { const w = BY_W[item.w], p = S.progress[item.w]; return (p ? p.seen : 0) % variants(w).length; }
  function stageLabel(item) {
    if (item.relearn) return "Reprise";
    const p = S.progress[item.w];
    if (!p) return "Nouveau";
    return "Rappel " + (p.stage + 1) + "/" + STAGES_DONE;
  }
  function view(html) { if (typeof resetSwipe === "function") resetSwipe(); $app.innerHTML = html; window.scrollTo(0, 0); }

  function showHome() {
    run = null;
    const rev = dueReviews().length;
    const nw = Math.min(newQuota(), freshWords().length);
    const n = rev + nw;
    const est = Math.max(1, Math.round(n * SEC_PER_ITEM / 60));
    const vals = Object.values(S.progress).filter(p => p);
    const active = vals.filter(p => p.status === "active").length;
    const done = vals.filter(p => p.status === "done").length;
    const disc = vals.filter(p => p.status === "discarded").length;
    const left = freshWords().length;
    const streak = computeStreak();
    const doneToday = S.days.includes(today());
    view(`
      <header class="home-head">
        <div class="date">${esc(fmtDate(today()))}</div>
        <h1>Mots</h1>
      </header>
      <section class="today">
        <div class="big-stat"><b>${rev}</b><span>révision${rev > 1 ? "s" : ""}</span></div>
        <div class="big-stat"><b>${nw}</b><span>nouveau${nw > 1 ? "x" : ""}</span></div>
      </section>
      ${n ? `<button class="btn primary xl" id="go">Commencer · ≈ ${Math.min(est, S.settings.minutes)} min</button>
             ${est > S.settings.minutes ? `<p class="hint">La séance s'arrête à ${S.settings.minutes} min ; le reste passe à demain.</p>` : ""}`
          : `<p class="empty">${doneToday ? "Séance du jour terminée." : "Rien de prévu aujourd'hui."} ${left ? "" : "La banque de mots est épuisée : ajoute un lot."}</p>
             ${left && !newQuota() ? `<button class="btn ghost" id="more">Ajouter 5 nouveaux mots</button>` : ""}`}
      <section class="stats">
        <div><b>${active}</b><span>en cours</span></div>
        <div><b>${done}</b><span>acquis</span></div>
        <div><b>${left}</b><span>à découvrir</span></div>
        <div><b>${streak}</b><span>jour${streak > 1 ? "s" : ""} d'affilée</span></div>
      </section>
      ${disc ? `<p class="hint">${disc} mot${disc > 1 ? "s" : ""} écarté${disc > 1 ? "s" : ""}.</p>` : ""}
      <nav class="foot"><button class="link" id="settings">Réglages et sauvegarde</button></nav>
    `);
    const go = document.getElementById("go"); if (go) go.onclick = startSession;
    const more = document.getElementById("more"); if (more) more.onclick = () => { if (S.daily.date !== today()) S.daily = { date: today(), introduced: 0, bonus: 0 }; S.daily.bonus = (S.daily.bonus || 0) + 5; save(); showHome(); };
    document.getElementById("settings").onclick = showSettings;
  }
  function computeStreak() {
    const set = new Set(S.days);
    let d = today(), n = 0;
    if (!set.has(d)) d = addDays(d, -1);
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  function topBar() {
    const total = run.queue.length;
    return `<div class="bar">
      <button class="icon" id="quit" aria-label="Quitter la séance">✕</button>
      <div class="meter" aria-hidden="true"><span style="width:${(run.i / total) * 100}%"></span></div>
      <span class="count">${run.i + 1}/${total}</span>
    </div>`;
  }
  function bindQuit() { document.getElementById("quit").onclick = () => showEnd(false, true); }

  function showPrompt() {
    const item = current();
    const w = BY_W[item.w];
    if (!w) { run.i++; return run.i < run.queue.length ? showPrompt() : showEnd(false); }
    item.v = variantIndex(item);
    const pr = variants(w)[item.v].prompt;
    view(`
      ${topBar()}
      <div class="card">
        <div class="tag">${esc(stageLabel(item))} · ${CAT[w.cat] || ""}</div>
        <p class="prompt">${renderPrompt(pr)}</p>
      </div>
      <div class="actions two">
        <button class="btn ghost xl" id="dry">Je sèche</button>
        <button class="btn primary xl" id="got">J'ai</button>
      </div>
    `);
    bindQuit();
    const t0 = performance.now();
    document.getElementById("got").onclick = () => showAnswer(true, performance.now() - t0);
    document.getElementById("dry").onclick = () => showAnswer(false, performance.now() - t0);
  }

  function showAnswer(had, latency) {
    const item = current();
    const w = BY_W[item.w];
    const alts = w.alts || [];
    view(`
      ${topBar()}
      <div class="ans-head">
        <div class="tag">${esc(stageLabel(item))} · ${(latency / 1000).toFixed(1)} s</div>
        <button class="discard" id="discard">Ce mot ne m'intéresse pas</button>
      </div>
      <p class="prompt small">${renderPrompt(variants(w)[item.v || 0].prompt)}</p>
      <div class="words">
        <button class="word target" data-o="T" ${had ? "" : "disabled"}>${esc(w.w)}</button>
        ${alts.length ? `<div class="alts">${alts.map(a => `<button class="word alt" data-o="A" ${had ? "" : "disabled"}>${esc(a)}</button>`).join("")}</div>` : ""}
      </div>
      ${w.ex ? `<p class="ex">${w.exw ? esc(w.ex).replace(esc(w.exw), "<b>" + esc(w.exw) + "</b>") : highlight(w.ex, w.w)}</p>` : ""}
      ${w.note ? `<p class="note">${esc(w.note)}</p>` : ""}
      <div class="actions">
        ${had ? `<p class="instr">Touche le mot que tu avais trouvé.</p>
                 <button class="btn ghost xl" id="miss">Autre mot ou rien</button>`
              : `<button class="btn primary xl" id="nextBtn">Suivant</button>`}
      </div>
    `);
    bindQuit();
    document.getElementById("discard").onclick = discardCurrent;
    bindSwipe();
    if (had) {
      $app.querySelectorAll(".word").forEach(b => b.onclick = () => answer(b.dataset.o, latency));
      document.getElementById("miss").onclick = () => answer("X", latency);
    } else {
      document.getElementById("nextBtn").onclick = () => answer("S", latency);
    }
  }

  // Glisser vers la gauche sur l'écran réponse = écarter le mot
  function bindSwipe() {
    let x0 = null, y0 = 0, dx = 0;
    $app.ontouchstart = e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; $app.style.transition = "none"; };
    $app.ontouchmove = e => {
      if (x0 === null) return;
      const t = e.touches[0]; dx = t.clientX - x0;
      if (Math.abs(t.clientY - y0) > Math.abs(dx)) { x0 = null; $app.style.transform = ""; return; }
      if (dx < 0) { $app.style.transform = `translateX(${dx}px)`; $app.style.opacity = String(Math.max(.35, 1 + dx / 400)); }
    };
    $app.ontouchend = () => {
      if (x0 === null) return; x0 = null;
      $app.style.transition = "transform .18s ease, opacity .18s ease";
      if (dx < -110) { $app.style.transform = "translateX(-110%)"; $app.style.opacity = "0"; setTimeout(() => { resetSwipe(); discardCurrent(); }, 170); }
      else { $app.style.transform = ""; $app.style.opacity = ""; }
    };
  }
  function resetSwipe() { $app.ontouchstart = $app.ontouchmove = $app.ontouchend = null; $app.style.transition = "none"; $app.style.transform = ""; $app.style.opacity = ""; }

  function showEnd(timeUp, quit) {
    const R = run.results.filter(r => !r.relearn);
    const hit = R.filter(r => r.outcome === "T").length;
    const acc = R.filter(r => r.outcome === "A").length;
    const miss = R.filter(r => r.outcome === "X" || r.outcome === "S");
    const lats = R.filter(r => r.outcome !== "S").map(r => r.latency).sort((a, b) => a - b);
    const med = lats.length ? lats[Math.floor(lats.length / 2)] / 1000 : 0;
    const mins = elapsedMin();
    const perItem = run.results.length ? (mins * 60) / run.results.length : 0;
    const remaining = run.queue.length - run.i;
    view(`
      <header class="home-head"><div class="date">${timeUp ? "Temps écoulé" : quit ? "Séance interrompue" : "Séance terminée"}</div><h1>Bilan</h1></header>
      <section class="stats three">
        <div><b class="ok">${hit}</b><span>mots cibles</span></div>
        <div><b class="mid">${acc}</b><span>mots acceptés</span></div>
        <div><b class="ko">${miss.length}</b><span>ratés</span></div>
      </section>
      <section class="stats three">
        <div><b>${med.toFixed(1)} s</b><span>rappel médian</span></div>
        <div><b>${perItem.toFixed(0)} s</b><span>par carte, tout compris</span></div>
        <div><b>${Math.round(mins)} min</b><span>de séance</span></div>
      </section>
      ${miss.length ? `<p class="hint">Reviennent demain : <b>${miss.map(r => esc(r.w)).join(", ")}</b></p>` : ""}
      ${timeUp && remaining > 0 ? `<button class="btn ghost xl" id="cont">Continuer (${remaining} carte${remaining > 1 ? "s" : ""})</button>` : ""}
      <button class="btn primary xl" id="home">Retour à l'accueil</button>
    `);
    document.getElementById("home").onclick = showHome;
    const c = document.getElementById("cont");
    if (c) c.onclick = () => { run.extended = true; showPrompt(); };
  }

  // ---------- Réglages ----------
  function showSettings() {
    const disc = Object.entries(S.progress).filter(([, p]) => p.status === "discarded").map(([w]) => w).sort((a, b) => a.localeCompare(b, "fr"));
    view(`
      <div class="bar"><button class="icon" id="back" aria-label="Retour">←</button><span class="bar-title">Réglages</span></div>
      <section class="panel">
        <label class="row" for="npd"><span>Nouveaux mots par jour</span>
          <span class="stepper"><button class="icon" data-s="npd" data-d="-1" aria-label="Moins">−</button><output id="npd">${S.settings.newPerDay}</output><button class="icon" data-s="npd" data-d="1" aria-label="Plus">+</button></span></label>
        <label class="row" for="min"><span>Durée de séance (min)</span>
          <span class="stepper"><button class="icon" data-s="min" data-d="-1" aria-label="Moins">−</button><output id="min">${S.settings.minutes}</output><button class="icon" data-s="min" data-d="1" aria-label="Plus">+</button></span></label>
        <p class="hint">Calendrier : découverte, puis rappels à j+3-6, j+10-15, j+25-40, j+80-100. Un mot raté revient le lendemain et redescend d'un intervalle.</p>
        <p class="hint">Si la séance se vide avant la durée prévue, l'appli pioche d'autres nouveaux mots. Chaque nouveau mot coûte environ 5 rappels à venir : 25 nouveaux par jour tiennent dans 15 min à 6 s par carte.</p>
      </section>
      <section class="panel">
        <h2>Sauvegarde</h2>
        <p class="hint">Ta progression est stockée sur ce téléphone uniquement. Exporte-la de temps en temps.</p>
        <div class="actions two">
          <button class="btn ghost" id="exp">Télécharger</button>
          <button class="btn ghost" id="copy">Copier</button>
        </div>
        <label class="hint" for="imp">Restaurer depuis un fichier</label>
        <input type="file" id="imp" accept="application/json,.json">
        <textarea id="impText" placeholder="…ou colle ici le contenu d'une sauvegarde"></textarea>
        <button class="btn ghost" id="impBtn">Restaurer le texte collé</button>
        <p class="hint" id="msg" aria-live="polite"></p>
      </section>
      <section class="panel">
        <h2>Mots écartés (${disc.length})</h2>
        ${disc.length ? `<div class="alts">${disc.map(w => `<button class="word alt small" data-w="${esc(w)}" title="Remettre dans la liste">${esc(w)} ↺</button>`).join("")}</div>
          <p class="hint">Touche un mot pour le remettre en circulation.</p>` : `<p class="hint">Aucun.</p>`}
      </section>
      <section class="panel">
        <h2>Banque</h2>
        <p class="hint">${BANK.length} mots · ${S.log.length} réponses enregistrées.</p>
      </section>
    `);
    document.getElementById("back").onclick = showHome;
    $app.querySelectorAll("[data-s]").forEach(b => b.onclick = e => {
      e.preventDefault();
      const k = b.dataset.s, d = +b.dataset.d;
      if (k === "npd") S.settings.newPerDay = Math.min(60, Math.max(0, S.settings.newPerDay + d));
      else S.settings.minutes = Math.min(60, Math.max(3, S.settings.minutes + d));
      save();
      document.getElementById("npd").textContent = S.settings.newPerDay;
      document.getElementById("min").textContent = S.settings.minutes;
    });
    const msg = t => { document.getElementById("msg").textContent = t; };
    document.getElementById("exp").onclick = () => {
      try {
        const blob = new Blob([JSON.stringify(S)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "mots-sauvegarde-" + today() + ".json";
        document.body.appendChild(a); a.click(); a.remove();
        msg("Fichier téléchargé.");
      } catch (e) { msg("Téléchargement impossible ici : utilise Copier."); }
    };
    document.getElementById("copy").onclick = () => {
      const t = JSON.stringify(S);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => msg("Sauvegarde copiée."), () => msg("Copie refusée par le navigateur."));
      else msg("Copie non disponible ici.");
    };
    const restore = txt => {
      try {
        const d = JSON.parse(txt);
        if (!d || typeof d.progress !== "object") throw 0;
        S = Object.assign(blank(), d); save(); msg("Sauvegarde restaurée.");
      } catch (e) { msg("Ce contenu n'est pas une sauvegarde valide."); }
    };
    document.getElementById("imp").onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => restore(r.result); r.readAsText(f);
    };
    document.getElementById("impBtn").onclick = () => restore(document.getElementById("impText").value);
    $app.querySelectorAll("[data-w]").forEach(b => b.onclick = () => {
      const w = b.dataset.w;
      const p = S.progress[w];
      p.status = "active"; p.due = today(); delete p.discardedOn;
      save(); showSettings();
    });
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(text, actionLabel, action) {
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.innerHTML = `<span>${esc(text)}</span>${actionLabel ? `<button class="link" id="toastAct">${esc(actionLabel)}</button>` : ""}`;
    el.hidden = false;
    if (actionLabel) document.getElementById("toastAct").onclick = () => { el.hidden = true; action(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // Exposé pour les tests
  window.__mots = { highlight, schedule, buildQueue, get state() { return S; }, set state(v) { S = v; }, addDays, today };

  showHome();

  if ("serviceWorker" in navigator && location.protocol === "https:" && !/claude\.(ai|site)|claudeusercontent/.test(location.host)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
