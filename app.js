/* Maltese class practice. Text only. Scores stay in this browser unless a person saves a record. */

const STORAGE_KEY = "mh.progress.v2";

const SECTIONS = [
  { id: "cards", label: "Cards" },
  { id: "mcq", label: "Choices" },
  { id: "blanks", label: "Blanks" },
  { id: "reading", label: "Reading" },
  { id: "translate", label: "Translation" },
  { id: "revision", label: "Revision" },
];

const SECTION_LABEL = {
  cards: "Cards",
  mcq: "Choices",
  blanks: "Blanks",
  reading: "Reading",
  translate: "Translation",
  revision: "Revision",
};

const NOTES = {
  cards: "Turn the card, then mark it.",
  mcq: "Choose one, then check it.",
  blanks: "Capitals do not matter. ħ and ġ still do.",
  reading: "Read, then answer.",
  translate: "Type the other language. ħ and ġ still count.",
  revision: "From earlier lessons.",
};

const state = {
  loading: true,
  bootError: "",
  loadingLesson: false,
  lessonError: "",
  index: null,
  reference: null,
  config: { leaderboardUrl: "", supabaseUrl: "", supabaseAnonKey: "" },
  account: null,
  remoteScores: null,
  deleteState: "idle",
  route: { view: "home" },
  routeKey: "",
  lesson: null,
  section: "cards",
  faceFirst: "mt",
  direction: "to-mt",
  deck: [],
  cardIndex: 0,
  flipped: false,
  quiz: null,
};

const lessonCache = new Map();
let routeToken = 0;

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(value) {
  return String(value)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matches(input, accepted) {
  const given = normalize(input);
  if (!given) return false;
  return accepted.some((item) => normalize(item) === given);
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function starsFor(percent) {
  if (percent >= 100) return 3;
  if (percent >= 80) return 2;
  if (percent >= 60) return 1;
  return 0;
}

function splitTitle(title, id) {
  const match = String(title || "").match(/^Lesson\s+\d+\s*:\s*(.+)$/i);
  return {
    kicker: `Lesson ${id}`,
    heading: match ? match[1] : title || `Lesson ${id}`,
  };
}

function learningLabel(count) {
  return count === 1 ? "1 word still learning" : `${count} words still learning`;
}

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nickname: "", lessons: {} };
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return { nickname: "", lessons: {} };
    if (!data.lessons || typeof data.lessons !== "object") data.lessons = {};
    if (typeof data.nickname !== "string") data.nickname = "";
    return data;
  } catch {
    return { nickname: "", lessons: {} };
  }
}

function writeStore(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* This browser is not storing scores. */
  }
}

function lessonEntry(store, lessonId) {
  const id = String(lessonId);
  if (!store.lessons[id]) {
    store.lessons[id] = { weak: [], sections: {} };
  }
  if (!Array.isArray(store.lessons[id].weak)) store.lessons[id].weak = [];
  if (!store.lessons[id].sections) store.lessons[id].sections = {};
  return store.lessons[id];
}

function hasProgress(entry) {
  if (!entry) return false;
  if (entry.cardsSeenAt) return true;
  if (Array.isArray(entry.weak) && entry.weak.length) return true;
  return Object.keys(entry.sections || {}).length > 0;
}

function setWeak(lessonId, word, learning) {
  const store = loadStore();
  const entry = lessonEntry(store, lessonId);
  const weak = new Set(entry.weak);
  if (learning) weak.add(word);
  else weak.delete(word);
  entry.weak = [...weak];
  writeStore(store);
}

function markCardsReviewed(lessonId) {
  const store = loadStore();
  const entry = lessonEntry(store, lessonId);
  entry.cardsSeenAt = new Date().toISOString();
  writeStore(store);
}

function saveResult(lessonId, section, percent) {
  const store = loadStore();
  const entry = lessonEntry(store, lessonId);
  const prev = entry.sections[section];
  const now = new Date().toISOString();
  const stars = starsFor(percent);
  const next = {
    bestPercent: percent,
    bestStars: stars,
    bestAt: now,
    lastPercent: percent,
    lastAt: now,
    attempts: (prev?.attempts || 0) + 1,
  };
  if (prev && prev.bestPercent > percent) {
    next.bestPercent = prev.bestPercent;
    next.bestStars = prev.bestStars;
    next.bestAt = prev.bestAt;
  } else if (prev && prev.bestPercent === percent) {
    next.bestAt = prev.bestAt;
  }
  entry.sections[section] = next;
  writeStore(store);
  return next;
}

function leaderboardUrl() {
  const url = String(state.config?.leaderboardUrl || "").trim();
  return /^https:\/\//i.test(url) ? url : "";
}

function warnLesson(lesson) {
  const label = lesson.title || `Lesson ${lesson.lesson_id}`;
  ["lesson_id", "title", "vocabulary", "multiple_choice", "fill_in_blank", "comprehension"].forEach((key) => {
    if (lesson[key] == null) console.warn(`${label} is missing “${key}”.`);
  });
  (lesson.multiple_choice || []).forEach((question) => {
    if (!(question.options || []).includes(question.answer)) {
      console.warn(`${label}: a choice does not list its answer (${question.id || question.question}).`);
    }
  });
  if (Number(lesson.lesson_id) > 1 && !Array.isArray(lesson.revision)) {
    console.warn(`${label}: lesson 2 and after should include a revision list.`);
  }
}

function choiceItem(question, fromLesson = null) {
  return {
    kind: "choice",
    prompt: question.question || "",
    options: question.options || [],
    answer: question.answer || "",
    fromLesson,
    kicker: "",
  };
}

function textItem(question, fromLesson = null) {
  const extra = Array.isArray(question.answers) ? question.answers : [];
  return {
    kind: "text",
    sentence: question.sentence || "",
    prompt: question.question || "",
    hint: question.hint || "",
    displayAnswer: question.answer || "",
    accept: [question.answer, ...extra].filter(Boolean),
    fromLesson,
    lang: "mt",
    kicker: "",
  };
}

function revisionItem(question) {
  const fromLesson = question.from_lesson ?? null;
  if (question.type === "fib" || question.sentence) return textItem(question, fromLesson);
  return choiceItem(question, fromLesson);
}

function translationItems(vocab, direction) {
  const intoMaltese = direction !== "to-en";
  return shuffle(vocab).map((word) => {
    const extra = intoMaltese ? word.accept_maltese : word.accept_english;
    return {
      kind: "text",
      sentence: "",
      prompt: intoMaltese ? word.english : word.maltese,
      hint: "",
      displayAnswer: intoMaltese ? word.maltese : word.english,
      accept: [intoMaltese ? word.maltese : word.english, ...(extra || [])].filter(Boolean),
      fromLesson: null,
      lang: intoMaltese ? "mt" : "en",
      promptLang: intoMaltese ? "en" : "mt",
      kicker: intoMaltese ? "Write in Maltese" : "Write in English",
    };
  });
}

function prepare(items) {
  return items.map((item) => (
    item.kind === "choice" ? { ...item, options: shuffle(item.options) } : item
  ));
}

function buildDeck(vocab, lessonId) {
  const entry = loadStore().lessons[String(lessonId)] || {};
  const weak = new Set(entry.weak || []);
  const weakCards = vocab.filter((word) => weak.has(word.maltese));
  const rest = vocab.filter((word) => !weak.has(word.maltese));
  return [...shuffle(weakCards), ...shuffle(rest)];
}

function allowedSections(lesson) {
  const ids = ["cards", "mcq", "blanks", "reading", "translate"];
  if (Array.isArray(lesson.revision) && lesson.revision.length) ids.push("revision");
  return ids;
}

function parseHash() {
  const parts = (location.hash.replace(/^#/, "") || "/")
    .split("/")
    .filter(Boolean);
  if (parts[0] === "progress") return { view: "progress" };
  if (parts[0] === "reference") {
    return {
      view: "reference",
      topic: decodeURIComponent(parts[1] || ""),
      anchor: decodeURIComponent(parts[2] || ""),
    };
  }
  if (parts[0] === "lesson" && /^\d+$/.test(parts[1] || "")) {
    return {
      view: "lesson",
      lessonId: Number(parts[1]),
      section: parts[2] || "cards",
      needsCanonical: !parts[2],
    };
  }
  return { view: "home" };
}

function itemsFor(section) {
  const lesson = state.lesson;
  if (section === "mcq") return (lesson.multiple_choice || []).map((question) => choiceItem(question));
  if (section === "blanks") return (lesson.fill_in_blank || []).map((question) => textItem(question));
  if (section === "reading") {
    return (lesson.comprehension?.questions || []).map((question) => choiceItem(question));
  }
  if (section === "translate") return translationItems(lesson.vocabulary || [], state.direction);
  if (section === "revision") return (lesson.revision || []).map(revisionItem);
  return [];
}

function startSection(section) {
  state.section = section;
  state.flipped = false;
  state.cardIndex = 0;
  if (section === "cards") {
    state.deck = buildDeck(state.lesson.vocabulary || [], state.lesson.lesson_id);
    state.quiz = null;
    return;
  }
  state.deck = [];
  state.quiz = {
    section,
    items: prepare(itemsFor(section)),
    index: 0,
    picked: null,
    checked: false,
    correct: 0,
    outcome: "",
    given: "",
    note: "",
    finished: false,
    percent: 0,
    stars: 0,
    saved: null,
    share: "idle",
  };
}

async function ensureLesson(id) {
  const meta = (state.index?.lessons || []).find((lesson) => Number(lesson.id) === Number(id)) || null;
  if (!meta) {
    state.lesson = null;
    state.lessonError = "missing";
    return;
  }
  if (meta.status !== "active") {
    state.lesson = null;
    state.lessonError = "soon";
    return;
  }
  if (lessonCache.has(meta.id)) {
    state.lesson = lessonCache.get(meta.id);
    state.lessonError = "";
    return;
  }
  const response = await fetch(`data/${meta.file}`);
  if (!response.ok) {
    state.lesson = null;
    state.lessonError = "file";
    return;
  }
  const lesson = await response.json();
  warnLesson(lesson);
  lessonCache.set(meta.id, lesson);
  state.lesson = lesson;
  state.lessonError = "";
}

async function syncRoute() {
  const route = parseHash();
  if (route.needsCanonical) {
    location.replace(`#/lesson/${route.lessonId}/${route.section}`);
    return;
  }
  const token = ++routeToken;
  const key = `${route.view}:${route.lessonId || ""}:${route.section || ""}:${route.topic || ""}:${route.anchor || ""}`;
  const changed = key !== state.routeKey;
  state.routeKey = key;
  state.route = route;

  if (route.view === "lesson") {
    const cached = lessonCache.has(route.lessonId);
    if (!cached) {
      state.lesson = null;
      state.lessonError = "";
      state.loadingLesson = true;
      render();
    }
    try {
      await ensureLesson(route.lessonId);
    } catch {
      state.lesson = null;
      state.lessonError = "file";
    }
    if (token !== routeToken) return;
    state.loadingLesson = false;
    if (state.lesson) {
      const allowed = allowedSections(state.lesson);
      if (!allowed.includes(route.section)) {
        location.replace(`#/lesson/${route.lessonId}/cards`);
        return;
      }
      if (changed) startSection(route.section);
    }
  }

  if (token !== routeToken) return;
  if (route.view === "progress" && state.account && state.remoteScores == null) void loadRemoteScores();
  if (changed) window.scrollTo(0, 0);
  render();
}

function setTitle() {
  if (state.route.view === "progress") {
    document.title = "Progress · Il-Malti";
    return;
  }
  if (state.route.view === "reference") {
    const topic = referenceTopic();
    document.title = topic ? `${topic.title} · Il-Malti` : "Reference · Il-Malti";
    return;
  }
  if (state.route.view === "lesson" && state.lesson) {
    const { heading } = splitTitle(state.lesson.title, state.lesson.lesson_id);
    document.title = `${heading} · Il-Malti`;
    return;
  }
  document.title = "Il-Malti";
}

function starSvg(on) {
  return `<svg class="star${on ? " is-on" : ""}" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.7 12.35 7l5.75.5-4.35 3.75 1.35 5.55L10 13.9 4.9 16.8l1.35-5.55L1.9 7.5 7.65 7z"/></svg>`;
}

function starsHtml(count) {
  const stars = [0, 1, 2].map((index) => starSvg(index < count)).join("");
  return `<span class="stars" role="img" aria-label="${count} of 3 stars">${stars}</span>`;
}

function shell(main, wide) {
  return `
    <div class="shell${wide ? " is-wide" : ""}">
      <header class="topbar">
        <a class="brand" href="#/">Il-Malti</a>
        ${navHtml()}
      </header>
      <main>${main}</main>
    </div>`;
}

function navHtml() {
  const view = state.route.view;
  const current = view === "lesson" || view === "home" ? "home" : view;
  const items = [
    ["#/", "home", "Lessons"],
    ["#/reference", "reference", "Reference"],
    ["#/progress", "progress", "Progress"],
  ];
  return `<nav class="nav" aria-label="Main">${items.map(([href, id, label]) => `
    <a href="${href}"${current === id ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}

function loadingBlock(title) {
  return shell(`
    <p class="kicker">Please wait</p>
    <p class="lede">${esc(title)}</p>`);
}

function homeHtml() {
  const lessons = state.index?.lessons || [];
  const cards = lessons.map((lesson) => {
    const { kicker, heading } = splitTitle(lesson.title, lesson.id);
    if (lesson.status !== "active") {
      return `
        <article class="lesson-card is-soon" aria-disabled="true">
          <div class="card-top">
            <p class="kicker">${esc(kicker)}</p>
            <span class="badge">Coming soon</span>
          </div>
          <h2 class="card-title">${esc(heading)}</h2>
          <p class="meta">Not open yet.</p>
        </article>`;
    }
    return `
      <a class="lesson-card" href="#/lesson/${lesson.id}/cards">
        <p class="kicker">${esc(kicker)}</p>
        <h2 class="card-title">${esc(heading)}</h2>
        <p class="meta">${esc(progressLine(lesson.id))}</p>
      </a>`;
  }).join("");

  const body = lessons.length
    ? cards
    : `<p class="lede">No lessons are listed yet.</p>`;

  return shell(`
    <p class="kicker">MQF 1</p>
    <h1 class="home-title">Il-Malti</h1>
    <p class="lede">Maltese as a foreign language. Work through a lesson, or look something up below.</p>
    <p class="list-label">Lessons</p>
    <div class="catalog">${body}</div>
    ${referenceHomeStrip()}
    <p class="colophon">For the MQF 1 class.</p>`);
}

function referenceHomeStrip() {
  const topics = state.reference?.topics || [];
  if (!topics.length) return "";
  const cards = topics.map((topic) => `
    <a class="ref-link" href="#/reference/${esc(topic.id)}">
      <span class="ref-link-title">${esc(topic.title)}</span>
      <span class="meta">${esc(topic.blurb || "")}</span>
    </a>`).join("");
  return `
    <p class="list-label">Reference</p>
    <div class="ref-links">${cards}</div>`;
}

function progressLine(id) {
  const entry = loadStore().lessons[String(id)];
  if (!hasProgress(entry)) return "Not started";
  const parts = ["mcq", "blanks", "reading", "translate", "revision"].flatMap((key) => {
    const row = entry.sections?.[key];
    return row ? [`${SECTION_LABEL[key]} ${row.bestStars}/3`] : [];
  });
  if (parts.length) return parts.join(" · ");
  const left = entry.weak?.length || 0;
  return left ? `Cards · ${learningLabel(left)}` : "Cards reviewed";
}

function progressHtml() {
  const store = loadStore();
  const metas = new Map((state.index?.lessons || []).map((lesson) => [String(lesson.id), lesson]));
  const ids = [...new Set([...metas.keys(), ...Object.keys(store.lessons || {})])]
    .filter((id) => hasProgress(store.lessons[id]))
    .sort((a, b) => Number(a) - Number(b));

  const blocks = ids.map((id) => scoreBlock(id, store.lessons[id], metas.get(id))).join("");
  const empty = `
    <p class="lede">Nothing saved yet. Finish a section, or mark a card, and it will appear here.</p>`;

  return shell(`
    <p class="kicker">This browser</p>
    <h1>Progress</h1>
    <p class="lede">Kept on this device. A later try never replaces a better score. 1 star at 60%, 2 at 80%, 3 at 100%.</p>
    ${recordStatusHtml()}
    ${ids.length ? `<div class="score-groups">${blocks}</div>` : empty}
    ${progressRecordForm()}`);
}

function scoreBlock(id, entry, meta) {
  const title = meta?.title || `Lesson ${id}`;
  const { kicker, heading } = splitTitle(title, id);
  const rows = [];
  if (entry.cardsSeenAt || entry.weak?.length) {
    const left = entry.weak?.length || 0;
    const seen = entry.cardsSeenAt ? ` · ${formatDate(entry.cardsSeenAt)}` : "";
    const detail = left
      ? `${learningLabel(left)}${seen}`
      : `Every word marked known · ${formatDate(entry.cardsSeenAt)}`;
    rows.push(scoreRow("Cards", detail, "", ""));
  }
  ["mcq", "blanks", "reading", "translate", "revision"].forEach((key) => {
    const row = entry.sections?.[key];
    if (!row) return;
    const tries = row.attempts === 1 ? "1 try" : `${row.attempts} tries`;
    const last = row.lastPercent !== row.bestPercent ? ` · last try ${row.lastPercent}%` : "";
    rows.push(scoreRow(
      SECTION_LABEL[key],
      `${tries} · best ${formatDate(row.bestAt)}${last}`,
      starsHtml(row.bestStars),
      `${row.bestPercent}%`,
    ));
  });
  return `
    <section class="score-block">
      <p class="kicker">${esc(kicker)}</p>
      <h2>${esc(heading)}</h2>
      <ul class="score-list">${rows.join("")}</ul>
    </section>`;
}

function scoreRow(name, detail, stars, percent) {
  return `
    <li>
      <div>
        <p class="score-name">${esc(name)}</p>
        <p class="meta">${esc(detail)}</p>
      </div>
      <div class="score-fig">
        ${stars}
        ${percent ? `<span class="score-pct">${esc(percent)}</span>` : ""}
      </div>
    </li>`;
}

function lessonHtml() {
  if (state.loadingLesson) return loadingBlock("Opening lesson");
  if (state.lessonError || !state.lesson) return missingLesson();
  const { kicker, heading } = splitTitle(state.lesson.title, state.lesson.lesson_id);
  return shell(`
    <div class="lesson-head">
      <p class="kicker lesson-kicker">${esc(kicker)}</p>
      <h1>${esc(heading)}</h1>
    </div>
    ${tabsHtml()}
    ${state.quiz?.finished ? resultsBlock() : practiceBlock()}`);
}

function missingLesson() {
  const copy = {
    soon: "It is marked coming soon.",
    file: "The lesson file could not be opened.",
    missing: "It is not on the list.",
  }[state.lessonError] || "It is not on the list.";
  return shell(`
    <a class="crumb" href="#/">Lessons</a>
    <p class="kicker">Lesson</p>
    <h1>This one is not open.</h1>
    <p class="lede">${esc(copy)}</p>
    <a class="btn btn-primary" href="#/">All lessons</a>`);
}

function tabsHtml() {
  const id = state.lesson.lesson_id;
  const allowed = allowedSections(state.lesson);
  const tabs = SECTIONS.filter((section) => allowed.includes(section.id)).map((section) => {
    const current = section.id === state.section ? ' aria-current="page"' : "";
    return `<a class="tab" href="#/lesson/${id}/${section.id}"${current}>${section.label}</a>`;
  }).join("");
  const note = state.quiz?.finished ? "" : `<p class="section-note">${esc(NOTES[state.section] || "")}</p>`;
  return `<nav class="tabs" aria-label="Practice">${tabs}</nav>${note}`;
}

function practiceBlock() {
  if (state.section === "cards") return cardsBlock();
  return quizBlock();
}

function faceControl() {
  const maltese = state.faceFirst !== "en";
  return `
    <div class="segment" role="group" aria-label="First side">
      <button type="button" data-action="face" data-face="mt" aria-pressed="${maltese ? "true" : "false"}">Maltese first</button>
      <button type="button" data-action="face" data-face="en" aria-pressed="${maltese ? "false" : "true"}">English first</button>
    </div>`;
}

function endCopy(count) {
  if (count === 0) return "You marked every word as known.";
  if (count === 1) return "1 word will lead the next pass.";
  return `${count} words will lead the next pass.`;
}

function cardsBlock() {
  const deck = state.deck || [];
  if (!deck.length) return `<p>This lesson has no words yet.</p>`;
  if (state.cardIndex >= deck.length) {
    const left = loadStore().lessons[String(state.lesson.lesson_id)]?.weak?.length || 0;
    return `
      ${faceControl()}
      <p class="kicker" id="card-status" tabindex="-1">Cards</p>
      <h2 class="end-title">That is the set.</h2>
      <p class="lede end-copy">${esc(endCopy(left))}</p>
      <button type="button" class="btn btn-primary" data-action="retry">Go through again</button>`;
  }

  const card = deck[state.cardIndex];
  const weak = new Set(loadStore().lessons[String(state.lesson.lesson_id)]?.weak || []);
  const malteseFirst = state.faceFirst !== "en";
  const front = malteseFirst
    ? { label: "Maltese", text: card.maltese, lang: "mt" }
    : { label: "English", text: card.english, lang: "en" };
  const back = malteseFirst
    ? { label: "English", text: card.english, lang: "en" }
    : { label: "Maltese", text: card.maltese, lang: "mt" };

  return `
    ${faceControl()}
    <div class="q-top">
      <p class="kicker" id="card-status" tabindex="-1">${state.cardIndex + 1} of ${deck.length}</p>
      ${weak.has(card.maltese) ? '<p class="aside is-revision">Review</p>' : ""}
    </div>
    <div class="scene">
      <button type="button" class="flip${state.flipped ? " is-flipped" : ""}" data-action="flip" aria-pressed="${state.flipped ? "true" : "false"}">
        ${faceHtml(front, "front", state.flipped)}
        ${faceHtml(back, "back", !state.flipped)}
      </button>
    </div>
    <div class="actions pair dock">
      <button type="button" class="btn" data-action="still">Still learning</button>
      <button type="button" class="btn btn-primary" data-action="knew">Knew it</button>
    </div>`;
}

function faceHtml(side, place, hidden) {
  return `
    <span class="face ${place}" ${hidden ? 'aria-hidden="true"' : ""}>
      <span class="face-label">${esc(side.label)}</span>
      <span class="word" lang="${side.lang}">${esc(side.text)}</span>
      <span class="face-foot">Turn</span>
    </span>`;
}

function quizBlock() {
  const quiz = state.quiz;
  if (!quiz || !quiz.items.length) return `<p>Nothing in this section yet.</p>`;
  const item = quiz.items[quiz.index];
  const total = quiz.items.length;
  const done = quiz.index + (quiz.checked ? 1 : 0);
  const width = Math.round((done / total) * 100);
  const aside = item.fromLesson
    ? `<p class="aside is-revision">From Lesson ${esc(item.fromLesson)}</p>`
    : item.kicker ? `<p class="aside">${esc(item.kicker)}</p>` : "";

  return `
    ${directionControl()}
    ${state.section === "reading" ? passageHtml() : ""}
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="Section progress">
      <span style="width:${width}%"></span>
    </div>
    <div class="q-top">
      <p class="kicker">Question ${quiz.index + 1} of ${total}</p>
      ${aside}
    </div>
    ${item.kind === "choice" ? choiceHtml(item, quiz) : textHtml(item, quiz)}`;
}

function passageHtml() {
  const text = state.lesson.comprehension?.text || "";
  return `
    <p class="kicker passage-label">Passage</p>
    <blockquote class="passage" lang="mt">${esc(text)}</blockquote>`;
}

function directionControl() {
  if (state.section !== "translate" || !state.quiz || state.quiz.index > 0 || state.quiz.checked) return "";
  const intoMaltese = state.direction !== "to-en";
  return `
    <div class="segment" role="group" aria-label="Direction">
      <button type="button" data-action="direction" data-dir="to-mt" aria-pressed="${intoMaltese ? "true" : "false"}">Into Maltese</button>
      <button type="button" data-action="direction" data-dir="to-en" aria-pressed="${intoMaltese ? "false" : "true"}">Into English</button>
    </div>`;
}

function choiceHtml(item, quiz) {
  const letters = "ABCDEFGHIJ";
  const options = item.options.map((option, index) => {
    let note = "";
    let className = "option";
    if (!quiz.checked && quiz.picked === index) className = "option is-picked";
    if (quiz.checked) {
      const isAnswer = normalize(option) === normalize(item.answer);
      if (isAnswer) {
        className = "option is-correct";
        note = quiz.picked === index ? "Correct" : "Answer";
      } else if (quiz.picked === index) {
        className = "option is-wrong";
        note = "Yours";
      } else {
        className = "option is-dim";
      }
    }
    return `
      <button type="button" class="${className}" data-action="pick" data-index="${index}" aria-pressed="${quiz.picked === index ? "true" : "false"}" ${quiz.checked ? "disabled" : ""}>
        <span class="option-key">${letters[index] || index + 1}</span>
        <span class="option-text">${esc(option)}</span>
        ${note ? `<span class="option-note">${note}</span>` : ""}
      </button>`;
  }).join("");

  const last = quiz.index === quiz.items.length - 1;
  const actions = quiz.checked
    ? `<button type="button" class="btn btn-primary" data-action="next">${last ? "See result" : "Next"}</button>`
    : `<button type="button" class="btn btn-primary" data-action="check-choice">Check</button>`;

  return `
    <h2 class="prompt" id="prompt" tabindex="-1">${esc(item.prompt)}</h2>
    <div class="options" role="group" aria-label="Answers">${options}</div>
    ${quiz.note ? `<p class="form-note">${esc(quiz.note)}</p>` : ""}
    <div class="actions dock">${actions}</div>`;
}

function sentenceHtml(sentence, filled) {
  const parts = String(sentence).split("___");
  const gap = filled
    ? `<span class="gap is-filled">${esc(filled)}</span>`
    : `<span class="gap"><span class="sr">blank</span></span>`;
  return `<p class="sentence" id="prompt" tabindex="-1" lang="mt">${parts.map((part) => esc(part)).join(gap)}</p>`;
}

function textHtml(item, quiz) {
  const prompt = item.sentence
    ? `${sentenceHtml(item.sentence, quiz.checked ? item.displayAnswer : "")}${item.hint ? `<p class="hint">Hint · ${esc(item.hint)}</p>` : ""}`
    : `<p class="prompt" id="prompt" tabindex="-1" lang="${item.promptLang || "en"}">${esc(item.prompt)}</p>`;

  const last = quiz.index === quiz.items.length - 1;
  let response = "";
  if (quiz.checked) {
    const right = quiz.outcome === "right";
    const body = right
      ? "Correct."
      : `You wrote <strong>${esc(quiz.given)}</strong>. The answer is <strong>${esc(item.displayAnswer)}</strong>.`;
    response = `<div class="feedback ${right ? "is-right" : "is-wrong"}" role="status" tabindex="-1">${body}</div>
      <div class="actions dock"><button type="button" class="btn btn-primary" data-action="next">${last ? "See result" : "Next"}</button></div>`;
  } else {
    response = `
      <form data-action="check-text" autocomplete="off">
        <label class="field-label" for="answer">Your answer</label>
        <input id="answer" name="answer" class="answer-input" lang="${item.lang || "mt"}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done" maxlength="80">
        ${quiz.note ? `<p class="form-note">${esc(quiz.note)}</p>` : ""}
        <div class="actions dock"><button class="btn btn-primary" type="submit">Check</button></div>
      </form>`;
  }
  return prompt + response;
}

function resultCopy(percent, correct, total) {
  const missed = total - correct;
  if (percent >= 100) return "Every answer matched.";
  if (percent >= 90) {
    const left = missed === 1 ? "One answer is still open." : `${missed} answers are still open.`;
    return `A strong paper. 3 stars needs every answer. ${left}`;
  }
  if (percent >= 80) return "A strong pass. 3 stars needs a perfect paper.";
  if (percent >= 60) return "That is a pass. The ones you missed are worth another look.";
  return "Worth another run when you are ready.";
}

function savedCopy(saved, percent) {
  if (!saved) return "Saved on this device.";
  if (saved.bestPercent > percent) {
    return `Saved. Your best on this device remains ${saved.bestPercent}%.`;
  }
  if (saved.attempts > 1) return "Saved on this device. This is your best so far.";
  return "Saved on this device.";
}

function resultsBlock() {
  const quiz = state.quiz;
  const total = quiz.items.length;
  const url = leaderboardUrl();
  return `
    <p class="kicker">${esc(SECTION_LABEL[quiz.section] || "Result")}</p>
    <p class="result-score" tabindex="-1">${quiz.percent}%</p>
    <p class="result-detail">${quiz.correct} of ${total} correct</p>
    ${starsHtml(quiz.stars)}
    <p class="result-copy">${esc(resultCopy(quiz.percent, quiz.correct, total))}</p>
    <p class="rule">1 star at 60% · 2 at 80% · 3 at 100%.</p>
    <p class="result-detail">${esc(savedCopy(quiz.saved, quiz.percent))}</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="retry">Try this again</button>
      <a class="btn" href="#/">All lessons</a>
    </div>
    ${url ? shareHtml(url) : ""}
    ${recordPanel()}`;
}

function shareHtml() {
  const quiz = state.quiz;
  const name = esc(loadStore().nickname || "");
  if (quiz.share === "sent") {
    return `<div class="share"><p id="share-status" tabindex="-1">Sent from this browser. The sheet keeps it if the class link is set up.</p></div>`;
  }
  const note = quiz.share === "name"
    ? "Add a name before sending."
    : quiz.share === "error"
      ? "The score is still saved on this device. The sheet did not receive it."
      : "";
  return `
    <form class="share" data-action="share" autocomplete="off">
      <p class="kicker">Class sheet</p>
      <p class="lede">Optional. Send this result with a first name or a nickname.</p>
      <label class="field-label" for="nickname">Name</label>
      <input id="nickname" name="nickname" class="answer-input" maxlength="24" value="${name}" autocomplete="name">
      ${note ? `<p class="form-note" id="share-status" tabindex="-1">${esc(note)}</p>` : `<p class="sr" id="share-status" tabindex="-1"></p>`}
      <div class="actions">
        <button class="btn btn-primary" type="submit" ${quiz.share === "sending" ? "disabled" : ""}>${quiz.share === "sending" ? "Sending…" : "Send"}</button>
      </div>
    </form>`;
}

function referenceTopic() {
  const id = state.route.topic;
  if (!id) return null;
  return (state.reference?.topics || []).find((topic) => topic.id === id) || null;
}

function refSlug(title) {
  return normalize(title).replace(/\s+/g, "-");
}

function refAttr(title) {
  const slug = refSlug(title || "");
  return slug ? ` id="ref-${slug}"` : "";
}

function findBits(item, extra) {
  return [
    item?.form, item?.title, item?.word, item?.kind, item?.sound, item?.means,
    item?.example, item?.gloss, item?.note, item?.formed, item?.join, item?.joined,
    item?.also, item?.alsoGloss,
    ...(extra || []),
  ].filter(Boolean).join(" ");
}

function referenceEntries() {
  const rows = [];
  (state.reference?.topics || []).forEach((topic) => {
    const push = (title, detail, find) => {
      rows.push({ topic: topic.id, topicTitle: topic.title, title, detail, find });
    };
    (topic.letters || []).forEach((letter) => {
      push(letter.form, [letter.gloss, letter.example, letter.also].filter(Boolean).join(" · "), findBits(letter));
    });
    (topic.items || []).forEach((item) => {
      push(item.word || item.title, item.means || item.sound || "", findBits(item, item.with));
    });
    (topic.groups || []).forEach((group) => {
      (group.items || []).forEach((item) => {
        const title = item.form || item.word || item.title;
        const detail = item.means || item.sound || item.gloss || "";
        push(title, detail, findBits(item));
      });
    });
  });
  return rows;
}

function findField() {
  return `
    <label class="field-label" for="ref-find">Find</label>
    <input id="ref-find" class="find" type="search" placeholder="Try tnejn, bonġu, or fil-" autocomplete="off" enterkeyhint="search">`;
}

function topicNav(currentId) {
  const topics = state.reference?.topics || [];
  const all = `<a href="#/reference"${currentId ? "" : ' aria-current="page"'}>All</a>`;
  const rest = topics.map((topic) => `
    <a href="#/reference/${esc(topic.id)}"${topic.id === currentId ? ' aria-current="page"' : ""}>${esc(topic.title)}</a>`).join("");
  return `<nav class="topic-nav" aria-label="Reference">${all}${rest}</nav>`;
}

function referenceHtml() {
  if (!state.reference) {
    return shell(`
      <h1>Reference</h1>
      <p class="lede">The reference did not load.</p>`, true);
  }
  if (state.route.topic && !referenceTopic()) {
    return shell(`
      ${topicNav("")}
      <h1>That page is not here.</h1>
      <p class="lede">Choose a topic above.</p>`, true);
  }
  const topic = referenceTopic();
  if (!topic) {
    return shell(`
      <p class="kicker">Look it up</p>
      <h1>Reference</h1>
      <p class="lede">${esc(state.reference.intro || "")}</p>
      ${findField()}
      <div class="ref-links" data-ref-topics>${topicCards()}</div>
      <div class="hit-list" data-ref-hits hidden></div>
      <p class="find-empty" data-ref-empty hidden>Nothing matches.</p>`, true);
  }
  return shell(`
    ${topicNav(topic.id)}
    <h1>${esc(topic.title)}</h1>
    <p class="lede">${esc(topic.lead || "")}</p>
    ${findField()}
    <div data-ref-body>${referenceBody(topic)}</div>
    <p class="find-empty" data-ref-empty hidden>Nothing on this page matches.</p>
    <p class="colophon">Lessons 1 and 2 follow the class notes.</p>`, true);
}

function topicCards() {
  return (state.reference?.topics || []).map((topic) => `
    <a class="ref-link" href="#/reference/${esc(topic.id)}">
      <span class="ref-link-title">${esc(topic.title)}</span>
      <span class="meta">${esc(topic.blurb || "")}</span>
    </a>`).join("");
}

function referenceBody(topic) {
  if (topic.kind === "alphabet") return alphabetHtml(topic);
  if (topic.kind === "cards") return vowelHtml(topic);
  if (topic.kind === "groups") return groupsHtml(topic);
  if (topic.kind === "prepositions") return prepositionsHtml(topic);
  if (topic.kind === "particles") return particlesHtml(topic);
  if (topic.kind === "phrases") return phrasesHtml(topic);
  return "";
}

function alphabetHtml(topic) {
  const cells = (topic.letters || []).map((letter) => `
    <article class="letter${letter.kind === "vowel" ? " is-vowel" : ""}"${refAttr(letter.form)} data-find="${esc(findBits(letter))}">
      <p class="letter-form" lang="mt">${esc(letter.form)}</p>
      <p class="letter-kind">${letter.kind === "vowel" ? "Vowel" : "Consonant"}</p>
      ${letter.sound ? `<p class="letter-sound">${esc(letter.sound)}</p>` : ""}
      <p class="letter-ex" lang="mt">${esc(letter.example)} <span>${esc(letter.gloss)}</span></p>
      ${letter.also ? `<p class="letter-ex" lang="mt">${esc(letter.also)} <span>${esc(letter.alsoGloss || "")}</span></p>` : ""}
    </article>`).join("");
  return `<div class="letter-grid">${cells}</div>`;
}

function vowelHtml(topic) {
  return `<div class="vowel-grid">${(topic.items || []).map((item) => `
    <article class="ref-card"${refAttr(item.title)} data-find="${esc(findBits(item))}">
      <h2 class="ref-word" lang="mt">${esc(item.title)}</h2>
      <p class="ref-means">${esc(item.sound || "")}</p>
      <p class="example" lang="mt">${esc(item.example)} <span>${esc(item.gloss || "")}</span></p>
      ${item.note ? `<p class="ref-note">${esc(item.note)}</p>` : ""}
    </article>`).join("")}</div>`;
}

function groupsHtml(topic) {
  const groups = (topic.groups || []).map((group) => `
    <section class="ref-group" data-ref-group>
      <h2 class="group-title">${esc(group.title)}</h2>
      <div class="letter-grid">
        ${(group.items || []).map((item) => `
          <article class="letter"${refAttr(item.form)} data-find="${esc(findBits(item))}">
            <p class="letter-form" lang="mt">${esc(item.form)}</p>
            ${item.sound ? `<p class="letter-sound">${esc(item.sound)}</p>` : ""}
            ${item.example
              ? `<p class="letter-ex" lang="mt">${esc(item.example)} <span>${esc(item.gloss || "")}</span></p>`
              : (item.gloss ? `<p class="letter-ex"><span>${esc(item.gloss)}</span></p>` : "")}
          </article>`).join("")}
      </div>
    </section>`).join("");
  const notes = (topic.notes || []).map((note) => `<li>${esc(note)}</li>`).join("");
  return `${groups}${notes ? `<ul class="ref-notes">${notes}</ul>` : ""}`;
}

function prepositionsHtml(topic) {
  const people = topic.people || [];
  return (topic.items || []).map((item) => `
    <article class="ref-card"${refAttr(item.word)} data-find="${esc(findBits(item, item.with))}">
      <div class="ref-top">
        <h2 class="ref-word" lang="mt">${esc(item.word)}</h2>
        <p class="ref-means">${esc(item.means)}</p>
      </div>
      <p class="formed"><span>${esc(item.join || "")}</span> <strong lang="mt">${esc(item.joined || "")}</strong></p>
      <p class="example" lang="mt">${esc(item.example)} <span>${esc(item.gloss || "")}</span></p>
      ${item.note ? `<p class="ref-note">${esc(item.note)}</p>` : ""}
      ${Array.isArray(item.with) ? formsHtml(people, item.with) : ""}
    </article>`).join("");
}

function formsHtml(people, forms) {
  const cells = forms.map((form, index) => `
    <li><span>${esc(people[index] || "")}</span> <strong lang="mt">${esc(form)}</strong></li>`).join("");
  return `<p class="forms-label">With a person</p><ul class="forms">${cells}</ul>`;
}

function phrasesHtml(topic) {
  const groups = topic.groups?.length ? topic.groups : [{ title: "", items: topic.items || [] }];
  const body = groups.map((group) => `
    <section class="ref-group" data-ref-group>
      ${group.title ? `<h2 class="group-title">${esc(group.title)}</h2>` : ""}
      ${(group.items || []).map((item) => `
        <article class="ref-card"${refAttr(item.word)} data-find="${esc(findBits(item))}">
          <div class="ref-top">
            <h2 class="ref-word" lang="mt">${esc(item.word)}</h2>
            <p class="ref-means">${esc(item.means || "")}</p>
          </div>
          ${item.formed ? `<p class="formed-copy">${esc(item.formed)}</p>` : ""}
          ${item.example ? `<p class="example" lang="mt">${esc(item.example)} <span>${esc(item.gloss || "")}</span></p>` : ""}
        </article>`).join("")}
    </section>`).join("");
  const notes = (topic.notes || []).map((note) => `<li>${esc(note)}</li>`).join("");
  return `${body}${notes ? `<ul class="ref-notes">${notes}</ul>` : ""}`;
}

function particlesHtml(topic) {
  return (topic.items || []).map((item) => `
    <article class="ref-card"${refAttr(item.word)} data-find="${esc(findBits(item))}">
      <div class="ref-top">
        <h2 class="ref-word" lang="mt">${esc(item.word)}</h2>
        <p class="ref-means">${esc(item.means)}</p>
      </div>
      <p class="formed-copy">${esc(item.formed || "")}</p>
      <p class="example" lang="mt">${esc(item.example)} <span>${esc(item.gloss || "")}</span></p>
    </article>`).join("");
}

function filterReference(raw) {
  const query = normalize(raw);
  const topics = document.querySelector("[data-ref-topics]");
  const hits = document.querySelector("[data-ref-hits]");
  const empty = document.querySelector("[data-ref-empty]");
  if (topics && hits) {
    if (!query) {
      topics.hidden = false;
      hits.hidden = true;
      hits.innerHTML = "";
      if (empty) empty.hidden = true;
      return;
    }
    const matches = referenceEntries()
      .filter((row) => normalize(row.find).includes(query))
      .slice(0, 40);
    topics.hidden = true;
    hits.hidden = false;
    hits.innerHTML = matches.map((row) => `
      <a class="hit" href="#/reference/${esc(row.topic)}/${esc(refSlug(row.title))}">
        <span class="hit-title" lang="mt">${esc(row.title)}</span>
        <span class="hit-detail">${esc(row.detail)}</span>
        <span class="hit-topic">${esc(row.topicTitle)}</span>
      </a>`).join("");
    if (empty) empty.hidden = matches.length > 0;
    return;
  }
  const nodes = [...document.querySelectorAll("[data-find]")];
  if (!nodes.length) return;
  nodes.forEach((node) => {
    node.hidden = Boolean(query) && !normalize(node.dataset.find || "").includes(query);
  });
  document.querySelectorAll("[data-ref-group]").forEach((group) => {
    const any = [...group.querySelectorAll("[data-find]")].some((node) => !node.hidden);
    group.hidden = !any;
  });
  const notes = document.querySelector(".ref-notes");
  if (notes) notes.hidden = Boolean(query);
  if (empty) empty.hidden = nodes.some((node) => !node.hidden);
}

function render(options = {}) {
  const root = document.getElementById("app");
  let html = "";
  if (state.loading) html = loadingBlock("Loading lessons");
  else if (state.bootError) {
    html = shell(`
      <p class="kicker">Cannot open the lessons</p>
      <h1>The lesson list did not load.</h1>
      <p class="lede">Open this app through a local server or a hosted link. Opening the file directly blocks the lesson files.</p>`);
  } else if (state.route.view === "progress") html = progressHtml();
  else if (state.route.view === "reference") html = referenceHtml();
  else if (state.route.view === "lesson") html = lessonHtml();
  else html = homeHtml();

  root.innerHTML = html;
  setTitle();
  if (state.route.view === "reference" && state.route.anchor) {
    document.getElementById(`ref-${state.route.anchor}`)?.scrollIntoView({ block: "start" });
  }
  if (!options.focus) return;
  const target = document.querySelector(options.focus);
  if (!target) return;
  target.focus();
  if (options.scroll) target.scrollIntoView({ block: "center" });
}

function flipCard() {
  const flip = document.querySelector(".flip");
  if (!flip) return;
  state.flipped = !state.flipped;
  flip.classList.toggle("is-flipped", state.flipped);
  flip.setAttribute("aria-pressed", String(state.flipped));
  const faces = flip.querySelectorAll(".face");
  setFaceHidden(faces[0], state.flipped);
  setFaceHidden(faces[1], !state.flipped);
}

function setFaceHidden(face, hidden) {
  if (!face) return;
  if (hidden) face.setAttribute("aria-hidden", "true");
  else face.removeAttribute("aria-hidden");
}

function pickOption(index) {
  const quiz = state.quiz;
  if (!quiz || quiz.checked || quiz.finished) return;
  const item = quiz.items[quiz.index];
  if (!item || index < 0 || index >= item.options.length) return;
  quiz.picked = index;
  quiz.note = "";
  document.querySelectorAll(".option").forEach((button) => {
    const picked = Number(button.dataset.index) === index;
    button.classList.toggle("is-picked", picked);
    button.setAttribute("aria-pressed", String(picked));
  });
  document.querySelector(".form-note")?.remove();
}

function checkChoice() {
  const quiz = state.quiz;
  if (!quiz || quiz.checked || quiz.finished) return;
  const item = quiz.items[quiz.index];
  if (quiz.picked == null) {
    quiz.note = "Choose an answer first.";
    render({ focus: "[data-action='check-choice']" });
    return;
  }
  const picked = item.options[quiz.picked];
  const right = normalize(picked) === normalize(item.answer);
  quiz.checked = true;
  quiz.outcome = right ? "right" : "wrong";
  quiz.note = "";
  if (right) quiz.correct += 1;
  render({ focus: "[data-action='next']" });
}

function checkText(raw) {
  const quiz = state.quiz;
  if (!quiz || quiz.checked || quiz.finished) return;
  const value = String(raw || "").trim();
  if (!value) {
    quiz.note = "Write an answer first.";
    render({ focus: "#answer" });
    return;
  }
  const item = quiz.items[quiz.index];
  const right = matches(value, item.accept);
  quiz.checked = true;
  quiz.given = value;
  quiz.outcome = right ? "right" : "wrong";
  quiz.note = "";
  if (right) quiz.correct += 1;
  render({ focus: "[data-action='next']" });
}

function nextItem() {
  const quiz = state.quiz;
  if (!quiz || !quiz.checked) return;
  quiz.index += 1;
  quiz.picked = null;
  quiz.checked = false;
  quiz.outcome = "";
  quiz.given = "";
  quiz.note = "";
  if (quiz.index >= quiz.items.length) {
    quiz.finished = true;
    const total = quiz.items.length;
    quiz.percent = total ? Math.round((quiz.correct / total) * 100) : 0;
    quiz.stars = starsFor(quiz.percent);
    quiz.saved = saveResult(state.lesson.lesson_id, quiz.section, quiz.percent);
    quiz.record = { mode: cloudConfig() ? (state.account ? "saving" : "ask") : "off", error: "" };
    render({ focus: ".result-score", scroll: true });
    if (quiz.record.mode === "saving") void saveAttempt();
    return;
  }
  render({ focus: "#prompt", scroll: true });
}

function rateCard(learning) {
  const card = state.deck[state.cardIndex];
  if (!card) return;
  setWeak(state.lesson.lesson_id, card.maltese, learning);
  state.cardIndex += 1;
  state.flipped = false;
  if (state.cardIndex >= state.deck.length) markCardsReviewed(state.lesson.lesson_id);
  render({ focus: "#card-status" });
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 24);
}

async function shareScore(form) {
  const quiz = state.quiz;
  const url = leaderboardUrl();
  if (!quiz || quiz.share === "sending" || quiz.share === "sent" || !url) return;
  const nickname = cleanName(new FormData(form).get("nickname"));
  if (!nickname) {
    quiz.share = "name";
    render({ focus: "#nickname" });
    return;
  }
  const store = loadStore();
  store.nickname = nickname;
  writeStore(store);
  quiz.share = "sending";
  render();
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        nickname,
        lessonId: state.lesson.lesson_id,
        lessonTitle: state.lesson.title,
        section: quiz.section,
        percent: quiz.percent,
        stars: quiz.stars,
        completedAt: new Date().toISOString(),
      }),
    });
    quiz.share = "sent";
  } catch {
    quiz.share = "error";
  }
  render({ focus: "#share-status" });
}

function onClick(event) {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "flip") {
    flipCard();
    return;
  }
  if (action === "pick") {
    pickOption(Number(el.dataset.index));
    return;
  }
  if (action === "check-choice") {
    checkChoice();
    return;
  }
  if (action === "next") {
    nextItem();
    return;
  }
  if (action === "still" || action === "knew") {
    rateCard(action === "still");
    return;
  }
  if (action === "retry") {
    startSection(state.section);
    window.scrollTo(0, 0);
    render();
    return;
  }
  if (action === "face") {
    state.faceFirst = el.dataset.face === "en" ? "en" : "mt";
    state.flipped = false;
    render();
    return;
  }
  if (action === "record-close") {
    if (state.quiz) state.quiz.record = { mode: "closed", error: "" };
    render();
    return;
  }
  if (action === "delete-ask") {
    state.deleteState = "confirm";
    render();
    return;
  }
  if (action === "delete-cancel") {
    state.deleteState = "idle";
    render();
    return;
  }
  if (action === "delete-confirm") {
    void deleteRecord();
    return;
  }
  if (action === "direction") {
    if (!state.quiz || state.quiz.index > 0 || state.quiz.checked) return;
    state.direction = el.dataset.dir === "to-en" ? "to-en" : "to-mt";
    startSection("translate");
    render();
  }
}

function onSubmit(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.action === "check-text") {
    checkText(new FormData(form).get("answer"));
    return;
  }
  if (form.dataset.action === "share") void shareScore(form);
  if (form.dataset.action === "record") void createRecord(form, "result");
  if (form.dataset.action === "record-progress") void createRecord(form, "progress");
}

function onKeydown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const typing = event.target.closest("input, textarea");
  const quiz = state.quiz;
  if (!quiz || quiz.finished) return;
  const item = quiz.items[quiz.index];
  if (!item || item.kind !== "choice") return;
  if (!typing && !quiz.checked) {
    const key = event.key.toLowerCase();
    let index = -1;
    if (/^[1-9]$/.test(event.key)) index = Number(event.key) - 1;
    const letter = "abcdefghi".indexOf(key);
    if (letter >= 0) index = letter;
    if (index >= 0 && index < item.options.length) {
      event.preventDefault();
      pickOption(index);
      return;
    }
  }
  if (event.key === "Enter" && !typing) {
    event.preventDefault();
    if (quiz.checked) nextItem();
    else checkChoice();
  }
}

function cloudConfig() {
  const url = String(state.config?.supabaseUrl || "").trim();
  const key = String(state.config?.supabaseAnonKey || "").trim();
  if (!/^https:\/\//i.test(url) || key.length < 20) return null;
  return { url, key };
}

let supabaseClient = null;

async function cloud() {
  const config = cloudConfig();
  if (!config) return null;
  if (!supabaseClient) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabaseClient = createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "mh.auth" },
    });
  }
  return supabaseClient;
}

function personName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function setAccount(row) {
  if (!row?.gdpr_accepted) {
    state.account = null;
    return;
  }
  state.account = {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
  };
}

async function restoreAccount() {
  state.account = null;
  state.remoteScores = null;
  const client = await cloud();
  if (!client) return;
  const { data } = await client.auth.getSession();
  const user = data?.session?.user;
  if (!user) return;
  const { data: row, error } = await client
    .from("learners")
    .select("id, first_name, last_name, email, gdpr_accepted")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !row?.gdpr_accepted) {
    await client.auth.signOut();
    return;
  }
  setAccount(row);
}

function lessonTitleFor(id) {
  const meta = (state.index?.lessons || []).find((lesson) => Number(lesson.id) === Number(id));
  return meta?.title || state.lesson?.title || `Lesson ${id}`;
}

function localBestRows(learnerId) {
  const store = loadStore();
  const rows = [];
  Object.entries(store.lessons || {}).forEach(([id, entry]) => {
    Object.entries(entry.sections || {}).forEach(([section, row]) => {
      if (row?.bestPercent == null) return;
      rows.push({
        learner_id: learnerId,
        lesson_id: Number(id),
        lesson_title: lessonTitleFor(id),
        section,
        percent: row.bestPercent,
        stars: row.bestStars,
        completed_at: row.bestAt || new Date().toISOString(),
      });
    });
  });
  return rows;
}

function recordError(error) {
  const text = String(error?.message || "");
  const code = String(error?.code || "");
  if (code === "23505" || /duplicate/i.test(text)) {
    return "That email already has a record. This score is still saved on this device.";
  }
  if (/anonymous/i.test(text)) {
    return "The score is still saved on this device. Anonymous sign-in is turned off in Supabase.";
  }
  return "The score is still saved on this device. The record could not be saved.";
}

async function saveAttempt() {
  const quiz = state.quiz;
  const client = await cloud();
  if (!quiz || !client || !state.account) return;
  const { error } = await client.from("scores").insert({
    learner_id: state.account.id,
    lesson_id: state.lesson.lesson_id,
    lesson_title: state.lesson.title,
    section: quiz.section,
    percent: quiz.percent,
    stars: quiz.stars,
    completed_at: new Date().toISOString(),
  });
  quiz.record = error
    ? { mode: "error", error: recordError(error) }
    : { mode: "saved", error: "" };
  state.remoteScores = null;
  render({ focus: "#record-status" });
}

async function createRecord(form, source) {
  if (form.dataset.busy === "1") return;
  const agreed = form.querySelector("[name='gdpr']")?.checked === true;
  const firstName = personName(new FormData(form).get("first_name"));
  const lastName = personName(new FormData(form).get("last_name"));
  const email = String(new FormData(form).get("email") || "").trim().slice(0, 120);
  const fail = (message) => {
    if (source === "result" && state.quiz) state.quiz.record = { mode: "ask", error: message };
    else state.deleteState = message;
    render({ focus: "#record-status" });
  };
  if (!agreed) {
    fail("Tick the notice before a record can be created.");
    return;
  }
  if (!firstName || !lastName) {
    fail("Add a first name and a last name.");
    return;
  }
  if (!validEmail(email)) {
    fail("Add an email address.");
    return;
  }
  form.dataset.busy = "1";
  if (source === "result" && state.quiz) state.quiz.record = { mode: "saving", error: "" };
  else state.deleteState = "saving";
  render();
  try {
    const client = await cloud();
    if (!client) throw new Error("missing config");
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    const user = data?.user;
    if (!user) throw new Error("missing user");
    const { error: profileError } = await client.from("learners").insert({
      id: user.id,
      first_name: firstName,
      last_name: lastName,
      email,
      gdpr_accepted: true,
      gdpr_accepted_at: new Date().toISOString(),
    });
    if (profileError) {
      await client.auth.signOut();
      throw profileError;
    }
    setAccount({ id: user.id, first_name: firstName, last_name: lastName, email, gdpr_accepted: true });
    const rows = localBestRows(user.id);
    if (rows.length) {
      const { error: scoreError } = await client.from("scores").insert(rows);
      if (scoreError) {
        state.remoteScores = null;
        const message = "Your name is saved. The scores could not be added yet.";
        if (source === "result" && state.quiz) state.quiz.record = { mode: "error", error: message };
        else state.deleteState = message;
        render({ focus: "#record-status" });
        return;
      }
    }
    state.remoteScores = null;
    state.deleteState = "idle";
    if (source === "result" && state.quiz) state.quiz.record = { mode: "saved", error: "" };
  } catch (error) {
    if (!state.account) state.account = null;
    const message = recordError(error);
    if (source === "result" && state.quiz) state.quiz.record = { mode: "ask", error: message };
    else state.deleteState = message;
  }
  render({ focus: "#record-status" });
}

function consentFields(error) {
  return `
    <p>If you want a record under your name, we store your first name, last name, email, and lesson scores. We use them only to keep track of your scores and to draw your progress. We do not use them for marketing, and we do not pass them on.</p>
    <p>You can delete the record later. Deleting copies it to the archive and removes it from the active list. Nothing is stored unless you tick the notice and choose save.</p>
    <label class="field-label" for="first-name">First name</label>
    <input id="first-name" name="first_name" class="answer-input" maxlength="80" autocomplete="given-name" required>
    <label class="field-label" for="last-name">Last name</label>
    <input id="last-name" name="last_name" class="answer-input" maxlength="80" autocomplete="family-name" required>
    <label class="field-label" for="record-email">Email</label>
    <input id="record-email" name="email" class="answer-input" type="email" maxlength="120" autocomplete="email" required>
    <label class="consent">
      <input name="gdpr" type="checkbox" value="yes">
      <span>I agree. Keep my name, email, and scores only to track my progress.</span>
    </label>
    <p class="form-note" id="record-status" tabindex="-1">${esc(error || "")}</p>`;
}

function recordPanel() {
  const quiz = state.quiz;
  const record = quiz?.record;
  if (!record || record.mode === "off") return "";
  if (record.mode === "saving") {
    return `<section class="record"><p id="record-status" tabindex="-1">Saving this score to your record…</p></section>`;
  }
  if (record.mode === "saved") {
    const who = state.account ? `${state.account.firstName} ${state.account.lastName}` : "your record";
    return `<section class="record"><p id="record-status" tabindex="-1">Saved to the record for ${esc(who)}. The graph is on Progress.</p></section>`;
  }
  if (record.mode === "error") {
    return `<section class="record"><p id="record-status" tabindex="-1">${esc(record.error)}</p></section>`;
  }
  if (record.mode === "closed") return "";
  return `
    <section class="record">
      <form data-action="record" autocomplete="on">
        <p class="kicker">Optional record</p>
        <h2 class="record-title">Keep this score?</h2>
        ${consentFields(record.error)}
        <div class="actions">
          <button class="btn btn-primary" type="submit" data-record-save disabled>Save my score</button>
          <button class="btn" type="button" data-action="record-close">Not now</button>
        </div>
      </form>
    </section>`;
}

function recordStatusHtml() {
  if (!cloudConfig()) return "";
  if (state.deleteState === "done") {
    return `<p class="record-note" id="record-status" tabindex="-1">Your record was copied to the archive and removed from the active list.</p>`;
  }
  if (!state.account) return "";
  const chart = progressChart();
  const remove = state.deleteState === "confirm"
    ? `<div class="record-note">
        <p>Delete the record for ${esc(state.account.firstName)} ${esc(state.account.lastName)}? The name, email, and scores are copied to the archive, then removed from the active list.</p>
        <div class="actions">
          <button type="button" class="btn btn-primary" data-action="delete-confirm">Delete the record</button>
          <button type="button" class="btn" data-action="delete-cancel">Keep it</button>
        </div>
      </div>`
    : `<div class="actions">
        <button type="button" class="btn" data-action="delete-ask">${state.deleteState === "working" ? "Removing…" : "Delete my record"}</button>
      </div>
      ${typeof state.deleteState === "string" && !["idle", "confirm", "working", "done"].includes(state.deleteState) ? `<p class="form-note" id="record-status">${esc(state.deleteState)}</p>` : ""}`;
  return `
    <section class="record record-live">
      <p class="kicker">Saved record</p>
      <h2 class="record-title">${esc(state.account.firstName)} ${esc(state.account.lastName)}</h2>
      <p class="meta">${esc(state.account.email)}</p>
      ${chart}
      ${remove}
    </section>`;
}

function progressRecordForm() {
  const hasScores = Object.values(loadStore().lessons || {}).some((entry) => Object.keys(entry.sections || {}).length);
  if (!cloudConfig() || state.account || state.deleteState === "done" || !hasScores) return "";
  const error = typeof state.deleteState === "string" && !["idle", "saving"].includes(state.deleteState)
    ? state.deleteState
    : "";
  if (state.deleteState === "saving") {
    return `<section class="record"><p id="record-status">Creating the record…</p></section>`;
  }
  return `
    <section class="record">
      <form data-action="record-progress" autocomplete="on">
        <p class="kicker">Optional record</p>
        <h2 class="record-title">Keep a record of these scores?</h2>
        ${consentFields(error)}
        <div class="actions">
          <button class="btn btn-primary" type="submit" data-record-save disabled>Save my record</button>
        </div>
      </form>
    </section>`;
}

function progressChart() {
  const scores = state.remoteScores;
  if (!Array.isArray(scores)) return `<p class="meta">Opening the saved scores…</p>`;
  if (!scores.length) return `<p class="meta">No saved scores yet.</p>`;
  const width = 640;
  const height = 200;
  const pad = 28;
  const ordered = [...scores].sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at)));
  const points = ordered.map((row, index) => {
    const x = ordered.length === 1
      ? width / 2
      : pad + (index * (width - pad * 2)) / (ordered.length - 1);
    const y = pad + ((100 - Number(row.percent)) / 100) * (height - pad * 2);
    return { x, y, row };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const dots = points.map((point) => `<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="4"><title>${esc(point.row.lesson_title)} · ${esc(SECTION_LABEL[point.row.section] || point.row.section)} · ${esc(point.row.percent)}%</title></circle>`).join("");
  const rows = ordered.map((row) => `
    <li>
      <span>${esc(formatDate(row.completed_at))}</span>
      <span>${esc(row.lesson_title)}</span>
      <span>${esc(SECTION_LABEL[row.section] || row.section)}</span>
      <span>${esc(row.percent)}%</span>
    </li>`).join("");
  const summary = `${ordered.length} saved score${ordered.length === 1 ? "" : "s"}, from ${ordered[0].percent}% to ${ordered[ordered.length - 1].percent}%.`;
  return `
    <figure class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(summary)}">
        <line class="chart-axis" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"></line>
        <polyline class="chart-line" points="${line}"></polyline>
        ${dots}
      </svg>
      <figcaption class="sr">${esc(summary)}</figcaption>
    </figure>
    <ul class="chart-list">${rows}</ul>`;
}

async function loadRemoteScores() {
  if (!state.account || state.remoteScores || state.remoteLoading) return;
  state.remoteLoading = true;
  try {
    const client = await cloud();
    const { data, error } = await client
      .from("scores")
      .select("lesson_id, lesson_title, section, percent, stars, completed_at")
      .eq("learner_id", state.account.id)
      .order("completed_at", { ascending: true });
    state.remoteScores = error ? [] : (data || []);
  } catch {
    state.remoteScores = [];
  }
  state.remoteLoading = false;
  if (state.route.view === "progress") render();
}

async function deleteRecord() {
  if (state.deleteState === "working" || !state.account) return;
  state.deleteState = "working";
  render();
  try {
    const client = await cloud();
    const { error } = await client.rpc("archive_my_record");
    if (error) throw error;
    await client.auth.signOut();
    state.account = null;
    state.remoteScores = null;
    state.deleteState = "done";
  } catch {
    state.deleteState = "The record is still active. It could not be archived.";
  }
  render({ focus: "#record-status" });
}

async function boot() {
  render();
  try {
    const [indexResponse, configResponse, referenceResponse] = await Promise.all([
      fetch("data/index.json"),
      fetch("data/config.json"),
      fetch("data/reference.json"),
    ]);
    if (!indexResponse.ok) throw new Error("index");
    state.index = await indexResponse.json();
    state.config = configResponse.ok ? await configResponse.json() : { leaderboardUrl: "", supabaseUrl: "", supabaseAnonKey: "" };
    await restoreAccount();
    if (referenceResponse.ok) {
      try {
        const data = await referenceResponse.json();
        state.reference = Array.isArray(data.topics) ? data : null;
      } catch {
        state.reference = null;
      }
    }
    if (!Array.isArray(state.index.lessons)) throw new Error("index");
    state.loading = false;
    await syncRoute();
  } catch {
    state.loading = false;
    state.bootError = "lessons";
    render();
  }
}

document.addEventListener("click", onClick);
document.addEventListener("submit", onSubmit);
document.addEventListener("keydown", onKeydown);
document.addEventListener("change", (event) => {
  if (event.target.name !== "gdpr") return;
  const button = event.target.form?.querySelector("[data-record-save]");
  if (button) button.disabled = !event.target.checked;
});
document.addEventListener("input", (event) => {
  if (event.target.name === "gdpr") {
    const button = event.target.form?.querySelector("[data-record-save]");
    if (button) button.disabled = !event.target.checked;
    return;
  }
  if (event.target.id === "ref-find") {
    filterReference(event.target.value);
    return;
  }
  if (event.target.id !== "answer" || !state.quiz?.note) return;
  state.quiz.note = "";
  document.querySelector(".form-note")?.remove();
});
window.addEventListener("hashchange", () => {
  if (state.index) void syncRoute();
});

boot();
