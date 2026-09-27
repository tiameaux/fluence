/* Mots — entraînement quotidien au rappel lexical.
   Tout l'état vit dans localStorage (clé KEY). Export / import JSON dans Réglages. */
(function () {
  "use strict";

  // ---------- Constantes ----------
  const KEY = "mots.v1";
  const STAGES_DONE = 5; // 5 rappels réussis = maîtrisé
  // Intervalle (en jours) programmé après avoir atteint le palier n
  const RANGES = { 1: [3, 6], 2: [10, 15], 3: [25, 40], 4: [80, 100] };
  const RELEARN_GAP = 6; // un mot raté revient ~6 cartes plus loin dans la même séance (une seule fois)
  const EXTRA_MIN = 5; // « Continuer » ajoute 5 minutes
  const CAT = { N: "Nom", V: "Verbe", A: "Adjectif", R: "Adverbe" };

  const BANK = (window.WORDS || []).filter(w => w && w.w && w.c && w.c.length);
  const BY_W = Object.fromEntries(BANK.map(w => [w.w, w]));

  // ---------- Dates ----------
  const today = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ, heure locale
  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d + n).toLocaleDateString("sv-SE");
  }
  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }
  function daysBetween(a, b) {
    const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
  }

  // ---------- État ----------
  function blank() {
    return { v: 1, progress: {}, log: [], settings: { newPerDay: 25, minutes: 15 }, daily: { date: "", introduced: 0, cards: 0, ms: 0 }, days: [] };
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
  function daily() {
    const t = today();
    if (!S.daily || S.daily.date !== t) S.daily = { date: t, introduced: 0, cards: 0, ms: 0 };
    S.daily.cards = S.daily.cards || 0; S.daily.ms = S.daily.ms || 0; S.daily.introduced = S.daily.introduced || 0;
    return S.daily;
  }

  // ---------- Planification ----------
  // Palier = nombre de rappels réussis. Réussite : palier+1, prochaine date tirée dans RANGES[palier].
  // « Mot accepté » ou réussite avec indice de lettres : borne basse de l'intervalle.
  // Échec : retour le lendemain, palier-2 (plancher 0).
  function schedule(w, result) {
    const t = today();
    let p = S.progress[w];
    if (!p) {
      p = S.progress[w] = { stage: 0, due: t, seen: 0, lapses: 0, status: "active", first: t };
      daily().introduced++;
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

  function activeEntries() { return Object.entries(S.progress).filter(([w, p]) => p.status === "active" && p.due && BY_W[w]); }
  function dueOn(dateIso) { return activeEntries().filter(([, p]) => p.due <= dateIso).map(([w]) => w); }
  function dueReviews() {
    return activeEntries().filter(([, p]) => p.due <= today()).sort((a, b) => a[1].due.localeCompare(b[1].due)).map(([w]) => w);
  }
  function freshWords() { return BANK.filter(x => !S.progress[x.w]).map(x => x.w); }
  function newQuota() { return Math.max(0, S.settings.newPerDay - daily().introduced); }

  // Les mots déjà vus pendant le tri (calib) passent après les inédits pendant les 3 premières semaines.
  const CALIB_DELAY_DAYS = 21;
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
  // La séance est bornée par le temps : révisions dues d'abord mêlées aux nouveaux mots du jour,
  // puis, s'il reste du temps, d'autres nouveaux mots.
  let run = null;
  function startSession(minutes) {
    const queue = buildQueue();
    if (!queue.length) queue.push(...pickNew(10).map(w => ({ w, isNew: true })));
    if (!queue.length) { toast("Plus aucun mot à découvrir : il faut ajouter un lot à la banque."); return; }
    run = { queue, i: 0, t0: Date.now(), deadline: Date.now() + minutes * 60000, results: [], relearned: new Set() };
    showPrompt();
  }
  function current() { return run.queue[run.i]; }
  function elapsedMs() { return Date.now() - run.t0; }
  function timeLeftMs() { return run.deadline - Date.now(); }

  function answer(outcome, latency) {
    // outcome: "T" cible, "A" accepté, "X" autre/rien, "S" séché
    const item = current();
    const p = S.progress[item.w];
    const stageBefore = p ? p.stage : -1;
    // Une réussite obtenue avec des lettres révélées compte comme « accepté » (intervalle plus court)
    const effective = (outcome === "T" && item.hints > 0) ? "A" : outcome;
    if (!item.relearn) schedule(item.w, effective);
    S.log.push([Date.now(), item.w, stageBefore, outcome, Math.round(latency), item.relearn ? 1 : 0, item.v || 0, item.hints || 0, item.def ? 1 : 0]);
    if (S.log.length > 20000) S.log = S.log.slice(-20000);
    run.results.push({ w: item.w, outcome, latency, relearn: !!item.relearn });
    daily().cards++;
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
    if (timeLeftMs() <= 0) return showEnd("time");
    if (run.i >= run.queue.length) {
      const extra = pickNew(10).filter(w => !run.queue.some(q => q.w === w));
      if (!extra.length) return showEnd("empty");
      extra.forEach(w => run.queue.push({ w, isNew: true }));
    }
    showPrompt();
  }
  function discardCurrent() {
    const item = current();
    const w = item.w;
    const before = S.progress[w] ? JSON.parse(JSON.stringify(S.progress[w])) : null;
    S.progress[w] = Object.assign(S.progress[w] || { stage: 0, seen: 0, lapses: 0, first: today() }, { status: "discarded", due: null, discardedOn: today() });
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
  function renderPrompt(p, gapButton) {
    return esc(p)
      .replace(/___/g, gapButton ? '<button class="gap" id="gap" aria-label="Voir la définition"></button>' : '<span class="gap"></span>')
      .replace(/«([^»]+)»/g, '<span class="vs">« $1 »</span>')
      .replace(/\*([^*]+)\*/g, '<em class="en" lang="en">$1</em>');
  }
  // Repère la forme du mot cible dans la phrase d'exemple (par radical si exw absent)
  function exForm(w) {
    if (w.exw && w.ex.includes(w.exw)) return w.exw;
    const core = w.w.replace(/^(se |s'|s’)/, "").split(" ")[0];
    const stem = core.slice(0, Math.max(4, Math.min(core.length - 2, 7)));
    if (stem.length < 3) return null;
    const re = new RegExp("(^|[^\\p{L}])(" + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\p{L}'’-]*)", "iu");
    const m = w.ex.match(re);
    return m ? m[2] : null;
  }
  function exHtml(w) {
    const f = exForm(w);
    return f ? esc(w.ex).replace(esc(f), "<b>" + esc(f) + "</b>") : esc(w.ex);
  }
  // Mot à épeler pour l'indice : sans « se » / « s' »
  function hintWord(w) { return w.w.replace(/^(se |s'|s’)/, ""); }
  function hintText(w, n) {
    const hw = hintWord(w);
    return esc(hw.slice(0, n)) + '<span class="dots">' + "…" + "</span>";
  }
  function variantIndex(item) { const w = BY_W[item.w], p = S.progress[item.w]; return (p ? p.seen : 0) % w.c.length; }
  function stageLabel(item) {
    if (item.relearn) return "Reprise";
    const p = S.progress[item.w];
    if (!p) return "Nouveau";
    return "Rappel " + (p.stage + 1) + "/" + STAGES_DONE;
  }
  function view(html) { resetSwipe(); $app.innerHTML = html; window.scrollTo(0, 0); }

  function showHome() {
    run = null;
    const d = daily();
    const rev = dueReviews().length;
    const tomorrow = Math.max(0, dueOn(addDays(today(), 1)).length - rev);
    const vals = Object.values(S.progress).filter(p => p);
    const active = vals.filter(p => p.status === "active").length;
    const done = vals.filter(p => p.status === "done").length;
    const disc = vals.filter(p => p.status === "discarded").length;
    const left = freshWords().length;
    const streak = computeStreak();
    const didToday = d.cards > 0;
    const mins = S.settings.minutes;
    const doneLine = didToday ? `${d.cards} carte${d.cards > 1 ? "s" : ""} en ${Math.max(1, Math.round(d.ms / 60000))} min aujourd'hui.` : "";
    let card;
    if (!didToday) {
      card = `<h2>Séance du jour</h2>
        <p>${rev ? `${rev} révision${rev > 1 ? "s" : ""} à faire, puis de nouveaux mots` : "De nouveaux mots"} jusqu'à ${mins} minutes.</p>
        <button class="btn primary xl" id="go">Commencer</button>`;
    } else if (rev > 0) {
      card = `<h2>Séance du jour</h2>
        <p>${doneLine} Il reste ${rev} révision${rev > 1 ? "s" : ""}.</p>
        <button class="btn primary xl" id="go">Reprendre</button>`;
    } else {
      card = `<h2><span class="ok">✓</span> Séance du jour faite</h2>
        <p>${doneLine}</p>
        <button class="btn ghost xl" id="more">Encore ${EXTRA_MIN} minutes</button>`;
    }
    view(`
      <header class="home-head">
        <div class="date">${esc(fmtDate(today()))}</div>
        <h1>Mots</h1>
      </header>
      <section class="panel today-card">${card}</section>
      <p class="hint">Demain : ${tomorrow ? `${tomorrow} révision${tomorrow > 1 ? "s" : ""} prévue${tomorrow > 1 ? "s" : ""}` : "aucune révision prévue"}.</p>
      <section class="progress-list">
        <h2>Ta progression</h2>
        <dl>
          <div><dt>En cours d'apprentissage</dt><dd>${active}</dd></div>
          <div><dt>Maîtrisés <span class="sub">(5 rappels réussis)</span></dt><dd>${done}</dd></div>
          <div><dt>Pas encore vus</dt><dd>${left}</dd></div>
          ${disc ? `<div><dt>Écartés</dt><dd>${disc}</dd></div>` : ""}
          <div><dt>Jours d'affilée</dt><dd>${streak}</dd></div>
        </dl>
      </section>
      <nav class="foot"><button class="link" id="settings">Réglages et sauvegarde</button></nav>
    `);
    const go = document.getElementById("go"); if (go) go.onclick = () => startSession(mins);
    const more = document.getElementById("more"); if (more) more.onclick = () => startSession(EXTRA_MIN);
    document.getElementById("settings").onclick = showSettings;
  }
  function computeStreak() {
    const set = new Set(S.days);
    let d = today(), n = 0;
    if (!set.has(d)) d = addDays(d, -1);
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  // Barre de progression = temps écoulé sur la durée prévue ; le compteur donne les cartes faites.
  function topBar() {
    const total = run.deadline - run.t0;
    const frac = Math.min(1, elapsedMs() / total);
    const left = Math.max(0, Math.ceil(timeLeftMs() / 60000));
    const n = run.results.length;
    return `<div class="bar">
      <button class="icon" id="quit" aria-label="Quitter la séance">✕</button>
      <div class="meter" aria-hidden="true"><span style="width:${frac * 100}%"></span></div>
      <span class="count">${n} faite${n > 1 ? "s" : ""} · ${left} min</span>
    </div>`;
  }
  function bindQuit() { document.getElementById("quit").onclick = () => showEnd("quit"); }

  function showPrompt() {
    const item = current();
    const w = BY_W[item.w];
    if (!w) { run.i++; return run.i < run.queue.length ? showPrompt() : showEnd("empty"); }
    item.v = variantIndex(item);
    item.hints = 0; item.def = false;
    const pr = w.c[item.v];
    view(`
      ${topBar()}
      <div class="card">
        <div class="tag">${esc(stageLabel(item))} · ${CAT[w.cat] || ""}</div>
        <p class="prompt">${renderPrompt(pr, !!w.d)}</p>
        <div class="aids">
          ${w.d ? `<button class="aid" id="defBtn">Définition</button>` : ""}
          <button class="aid" id="hintBtn"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 21h6v-1.5H9V21zm3-19a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2zm2.5 11.6-.5.35V15.5h-4v-1.55l-.5-.35a5 5 0 1 1 5 0z"/></svg>Indice</button>
        </div>
        <div class="reveal" id="defBox" hidden></div>
        <div class="reveal hintbox" id="hintBox" hidden></div>
      </div>
      <div class="actions two">
        <button class="btn ghost xl" id="dry">Je sèche</button>
        <button class="btn primary xl" id="got">J'ai</button>
      </div>
    `);
    bindQuit();
    const showDef = () => {
      if (!w.d) return;
      item.def = true;
      const box = document.getElementById("defBox");
      box.innerHTML = renderPrompt(w.d, false);
      box.hidden = false;
      const b = document.getElementById("defBtn"); if (b) b.disabled = true;
    };
    const gap = document.getElementById("gap"); if (gap) gap.onclick = showDef;
    const defBtn = document.getElementById("defBtn"); if (defBtn) defBtn.onclick = showDef;
    document.getElementById("hintBtn").onclick = () => {
      const max = hintWord(w).length - 1;
      if (item.hints >= max) return;
      item.hints++;
      const box = document.getElementById("hintBox");
      box.innerHTML = hintText(w, item.hints);
      box.hidden = false;
      if (item.hints >= max) document.getElementById("hintBtn").disabled = true;
    };
    const t0 = performance.now();
    document.getElementById("got").onclick = () => showAnswer(true, performance.now() - t0);
    document.getElementById("dry").onclick = () => showAnswer(false, performance.now() - t0);
  }

  function showAnswer(had, latency) {
    const item = current();
    const w = BY_W[item.w];
    const alts = w.alts || [];
    const pr = w.c[item.v || 0];
    const f = exForm(w);
    const isExCloze = f && pr === w.ex.replace(f, "___");
    const aidNote = [item.def ? "définition" : "", item.hints ? `${item.hints} lettre${item.hints > 1 ? "s" : ""}` : ""].filter(Boolean).join(" + ");
    view(`
      ${topBar()}
      <div class="ans-head">
        <div class="tag">${esc(stageLabel(item))} · ${(latency / 1000).toFixed(1)} s${aidNote ? " · " + aidNote : ""}</div>
        <button class="discard" id="discard">Ce mot ne m'intéresse pas</button>
      </div>
      ${isExCloze ? "" : `<p class="prompt small">${renderPrompt(pr, false)}</p>`}
      <div class="words">
        <button class="word target" data-o="T" ${had ? "" : "disabled"}>${esc(w.w)}</button>
        ${alts.length ? `<div class="alts">${alts.map(a => `<button class="word alt" data-o="A" ${had ? "" : "disabled"}>${esc(a)}</button>`).join("")}</div>` : ""}
      </div>
      ${w.ex ? `<p class="ex">${exHtml(w)}</p>` : ""}
      ${w.d ? `<p class="defline">${renderPrompt(w.d, false)}</p>` : ""}
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

  function showEnd(reason) {
    if (!run.closed) { daily().ms += elapsedMs(); run.closed = true; save(); }
    const R = run.results.filter(r => !r.relearn);
    const hit = R.filter(r => r.outcome === "T").length;
    const acc = R.filter(r => r.outcome === "A").length;
    const miss = R.filter(r => r.outcome === "X" || r.outcome === "S");
    const lats = R.filter(r => r.outcome !== "S").map(r => r.latency).sort((a, b) => a - b);
    const med = lats.length ? lats[Math.floor(lats.length / 2)] / 1000 : 0;
    const mins = elapsedMs() / 60000;
    const perItem = run.results.length ? (mins * 60) / run.results.length : 0;
    const title = reason === "time" ? "Temps écoulé" : reason === "quit" ? "Séance interrompue" : "Plus rien à réviser";
    view(`
      <header class="home-head"><div class="date">${title}</div><h1>Bilan</h1></header>
      <section class="stats three">
        <div><b class="ok">${hit}</b><span>mots cibles</span></div>
        <div><b class="mid">${acc}</b><span>mots acceptés</span></div>
        <div><b class="ko">${miss.length}</b><span>ratés</span></div>
      </section>
      <section class="stats three">
        <div><b>${med.toFixed(1)} s</b><span>rappel médian</span></div>
        <div><b>${perItem.toFixed(0)} s</b><span>par carte, tout compris</span></div>
        <div><b>${Math.max(1, Math.round(mins))} min</b><span>de séance</span></div>
      </section>
      ${miss.length ? `<p class="hint">Reviennent demain : <b>${[...new Set(miss.map(r => r.w))].map(esc).join(", ")}</b></p>` : ""}
      ${reason === "time" ? `<button class="btn ghost xl" id="cont">Encore ${EXTRA_MIN} minutes</button>` : ""}
      <button class="btn primary xl" id="home">Retour à l'accueil</button>
    `);
    document.getElementById("home").onclick = showHome;
    const c = document.getElementById("cont");
    if (c) c.onclick = () => {
      run.closed = false; run.t0 = Date.now(); run.deadline = Date.now() + EXTRA_MIN * 60000;
      if (run.i >= run.queue.length) run.queue.push(...pickNew(10).map(w => ({ w, isNew: true })));
      if (run.i < run.queue.length) showPrompt(); else showHome();
    };
  }

  // ---------- Réglages ----------
  function showSettings() {
    const disc = Object.entries(S.progress).filter(([, p]) => p.status === "discarded").map(([w]) => w).sort((a, b) => a.localeCompare(b, "fr"));
    view(`
      <div class="bar"><button class="icon" id="back" aria-label="Retour">←</button><span class="bar-title">Réglages</span></div>
      <section class="panel">
        <label class="row" for="min"><span>Durée de séance (min)</span>
          <span class="stepper"><button class="icon" data-s="min" data-d="-1" aria-label="Moins">−</button><output id="min">${S.settings.minutes}</output><button class="icon" data-s="min" data-d="1" aria-label="Plus">+</button></span></label>
        <label class="row" for="npd"><span>Nouveaux mots mêlés aux révisions</span>
          <span class="stepper"><button class="icon" data-s="npd" data-d="-1" aria-label="Moins">−</button><output id="npd">${S.settings.newPerDay}</output><button class="icon" data-s="npd" data-d="1" aria-label="Plus">+</button></span></label>
        <p class="hint">La séance fait d'abord les révisions du jour, mêlées à ce nombre de nouveaux mots. S'il reste du temps, elle en pioche d'autres jusqu'à la fin de la durée prévue.</p>
        <p class="hint">Calendrier : découverte, puis rappels à j+3-6, j+10-15, j+25-40, j+80-100. Un mot raté revient le lendemain et redescend d'un intervalle. Une réussite avec des lettres révélées compte comme un mot accepté : intervalle plus court.</p>
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
  window.__mots = { exForm, schedule, buildQueue, get state() { return S; }, set state(v) { S = v; }, addDays, today };

  showHome();

  if ("serviceWorker" in navigator && location.protocol === "https:" && !/claude\.(ai|site)|claudeusercontent/.test(location.host)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
