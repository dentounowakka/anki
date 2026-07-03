const STORAGE_KEY = "anki-web-app-state-v1";
const ALL_DECKS = "__all__";

const state = {
  cards: [],
  settings: { deckFilter: ALL_DECKS, rangeStart: 1, rangeEnd: 1, orderMode: "sequential", directionMode: "frontToBack", search: "" },
  quiz: { deck: [], index: 0, answerVisible: false, currentDirection: "frontToBack" },
  pendingCsv: { rows: [], hasHeader: false },
};

const $ = (id) => document.getElementById(id);
const normalizeDeck = (name) => (name || "未分類").trim() || "未分類";

function readCsvRows(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') { cell += '"'; i++; }
    else if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function looksLikeHeader(row) {
  return row.map((v) => v.toLowerCase()).some((v) => ["front", "back", "question", "answer", "image", "photo", "deck", "表", "裏", "問題", "答え", "写真", "画像", "デッキ"].includes(v));
}

function guessColumn(labels, fallback, ...names) {
  const lowered = labels.map((label) => label.toLowerCase());
  const found = names.map((name) => lowered.indexOf(name)).find((index) => index >= 0);
  return found ?? Math.min(fallback, Math.max(labels.length - 1, 0));
}

function setOptions(select, labels, includeNone = false) {
  select.innerHTML = "";
  if (includeNone) select.append(new Option("使用しない", "-1"));
  labels.forEach((label, index) => select.append(new Option(label, String(index))));
}

function prepareCsvImport(text) {
  const rows = readCsvRows(text);
  if (!rows.length) {
    $("storageStatus").textContent = "CSVに読み込める行がありません。";
    return;
  }
  const hasHeader = looksLikeHeader(rows[0]);
  const labels = hasHeader ? rows[0] : rows[0].map((_, index) => `列 ${index + 1}`);
  state.pendingCsv = { rows, hasHeader };
  setOptions($("frontColumn"), labels);
  setOptions($("backColumn"), labels);
  setOptions($("imageColumn"), labels, true);
  $("frontColumn").value = String(guessColumn(labels, 0, "front", "question", "表", "問題"));
  $("backColumn").value = String(guessColumn(labels, 1, "back", "answer", "裏", "答え"));
  $("imageColumn").value = String(guessColumn(["使用しない", ...labels], 0, "image", "photo", "写真", "画像") - 1);
  $("csvPreview").textContent = `${hasHeader ? rows.length - 1 : rows.length}件のカード候補があります。列を選んで読み込んでください。`;
  $("csvMapping").classList.remove("hidden");
}

function importMappedCsv() {
  const { rows, hasHeader } = state.pendingCsv;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const frontIndex = Number($("frontColumn").value);
  const backIndex = Number($("backColumn").value);
  const imageIndex = Number($("imageColumn").value);
  const deck = normalizeDeck($("importDeckName").value);
  const imported = dataRows.map((cols) => ({
    id: crypto.randomUUID(),
    deck,
    front: cols[frontIndex] || "",
    back: cols[backIndex] || "",
    image: imageIndex >= 0 ? cols[imageIndex] || "" : "",
    stats: { good: 0, again: 0 },
  })).filter((card) => card.front || card.back);
  state.cards = [...state.cards, ...imported];
  state.settings.deckFilter = deck;
  state.settings.rangeStart = 1;
  state.settings.rangeEnd = state.cards.filter((card) => normalizeDeck(card.deck) === deck).length || 1;
  $("csvMapping").classList.add("hidden");
  saveAndRender();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards: state.cards, settings: state.settings }));
  $("storageStatus").textContent = `${state.cards.length}枚のカードをブラウザに保存しました。`;
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    state.cards = (parsed.cards || []).map((card) => ({ deck: "未分類", ...card, stats: { good: 0, again: 0, ...(card.stats || {}) } }));
    state.settings = { ...state.settings, ...(parsed.settings || {}) };
    $("storageStatus").textContent = "前回保存したカードを自動で読み込みました。";
  } catch {
    $("storageStatus").textContent = "保存データを読み込めませんでした。";
  }
}

function getDeckNames() {
  return [...new Set(state.cards.map((card) => normalizeDeck(card.deck)))].sort((a, b) => a.localeCompare(b, "ja"));
}

function getVisibleCards() {
  const query = state.settings.search.trim().toLowerCase();
  return state.cards.filter((card) => {
    const inDeck = state.settings.deckFilter === ALL_DECKS || normalizeDeck(card.deck) === state.settings.deckFilter;
    const matchesSearch = !query || [card.front, card.back, card.deck].some((value) => (value || "").toLowerCase().includes(query));
    return inDeck && matchesSearch;
  });
}

function syncSettingsFromInputs() {
  state.settings = {
    ...state.settings,
    deckFilter: $("deckFilter").value,
    rangeStart: Number($("rangeStart").value) || 1,
    rangeEnd: Number($("rangeEnd").value) || getVisibleCards().length || 1,
    orderMode: $("orderMode").value,
    directionMode: $("directionMode").value,
    search: $("cardSearch").value,
  };
}

function renderSettings() {
  const deckFilter = $("deckFilter");
  const deckNames = getDeckNames();
  deckFilter.innerHTML = "";
  deckFilter.append(new Option(`すべてのデッキ（${state.cards.length}枚）`, ALL_DECKS));
  deckNames.forEach((name) => deckFilter.append(new Option(`${name}（${state.cards.filter((card) => normalizeDeck(card.deck) === name).length}枚）`, name)));
  if (![ALL_DECKS, ...deckNames].includes(state.settings.deckFilter)) state.settings.deckFilter = ALL_DECKS;
  deckFilter.value = state.settings.deckFilter;
  const visibleCount = getVisibleCards().length;
  $("rangeStart").value = state.settings.rangeStart;
  $("rangeEnd").value = Math.min(Math.max(state.settings.rangeEnd, 1), visibleCount || 1);
  $("rangeEnd").max = visibleCount || 1;
  $("rangeStart").max = visibleCount || 1;
  $("orderMode").value = state.settings.orderMode;
  $("directionMode").value = state.settings.directionMode;
  $("cardSearch").value = state.settings.search;
}

function renderEditors() {
  const list = $("cardList");
  const visibleCards = getVisibleCards();
  list.innerHTML = "";
  $("cardCount").textContent = `${visibleCards.length} / ${state.cards.length}枚`;
  visibleCards.forEach((card) => {
    const index = state.cards.indexOf(card);
    const node = $("cardEditorTemplate").content.firstElementChild.cloneNode(true);
    node.querySelector(".card-number").textContent = `#${index + 1}`;
    node.querySelector(".deck-input").value = normalizeDeck(card.deck);
    node.querySelector(".front-input").value = card.front;
    node.querySelector(".back-input").value = card.back;
    const preview = node.querySelector(".preview");
    if (card.image) { preview.src = card.image; preview.classList.remove("hidden"); }
    node.querySelector(".deck-input").addEventListener("change", (e) => { card.deck = normalizeDeck(e.target.value); saveAndRender(); });
    node.querySelector(".front-input").addEventListener("input", (e) => { card.front = e.target.value; saveState(); });
    node.querySelector(".back-input").addEventListener("input", (e) => { card.back = e.target.value; saveState(); });
    node.querySelector(".delete-card").addEventListener("click", () => { state.cards.splice(index, 1); saveAndRender(); });
    node.querySelector(".remove-image").addEventListener("click", () => { card.image = ""; saveAndRender(); });
    node.querySelector(".image-input").addEventListener("change", (e) => addImage(card, e.target.files[0]));
    list.appendChild(node);
  });
}

function addImage(card, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { card.image = reader.result; saveAndRender(); };
  reader.readAsDataURL(file);
}

function buildDeck() {
  syncSettingsFromInputs();
  saveState();
  const candidates = getVisibleCards();
  const start = Math.max(1, Math.min(state.settings.rangeStart, candidates.length));
  const end = Math.max(start, Math.min(state.settings.rangeEnd, candidates.length));
  let deck = candidates.slice(start - 1, end);
  if (state.settings.orderMode === "random") deck = deck.sort(() => Math.random() - 0.5);
  if (state.settings.orderMode === "weakFirst") deck = deck.sort((a, b) => (b.stats.again - b.stats.good) - (a.stats.again - a.stats.good));
  state.quiz = { deck, index: 0, answerVisible: false, currentDirection: chooseDirection() };
  renderQuiz();
}

function chooseDirection() {
  return state.settings.directionMode === "mixed" ? (Math.random() > 0.5 ? "frontToBack" : "backToFront") : state.settings.directionMode;
}

function renderQuiz() {
  const card = state.quiz.deck[state.quiz.index];
  $("progressText").textContent = `${Math.min(state.quiz.index + 1, state.quiz.deck.length)} / ${state.quiz.deck.length}`;
  $("answerArea").classList.toggle("hidden", !state.quiz.answerVisible);
  if (!card) {
    $("questionText").textContent = state.cards.length ? "デッキ・検索・範囲を選んで開始してください" : "CSVを読み込んでください";
    $("answerText").textContent = "";
    $("cardImage").classList.add("hidden");
    return;
  }
  const frontFirst = state.quiz.currentDirection === "frontToBack";
  $("questionLabel").textContent = `${normalizeDeck(card.deck)} / ${frontFirst ? "問題（表）" : "問題（裏）"}`;
  $("questionText").textContent = frontFirst ? card.front : card.back;
  $("answerText").textContent = frontFirst ? card.back : card.front;
  $("cardImage").src = card.image || "";
  $("cardImage").classList.toggle("hidden", !card.image);
}

function nextCard() {
  state.quiz.index += 1;
  state.quiz.answerVisible = false;
  state.quiz.currentDirection = chooseDirection();
  if (state.quiz.index >= state.quiz.deck.length) state.quiz.index = 0;
  renderQuiz();
}

function saveAndRender() {
  state.settings.rangeEnd = Math.min(state.settings.rangeEnd || state.cards.length || 1, getVisibleCards().length || 1);
  saveState();
  renderSettings();
  renderEditors();
  renderQuiz();
}

function bindEvents() {
  $("csvFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    prepareCsvImport(await file.text());
  });
  $("loadTextCsv").addEventListener("click", () => prepareCsvImport($("csvText").value));
  $("importMappedCsv").addEventListener("click", importMappedCsv);
  $("addBlankCard").addEventListener("click", () => { state.cards.push({ id: crypto.randomUUID(), deck: normalizeDeck($("importDeckName").value), front: "", back: "", image: "", stats: { good: 0, again: 0 } }); saveAndRender(); });
  $("startQuiz").addEventListener("click", buildDeck);
  $("showAnswer").addEventListener("click", () => { state.quiz.answerVisible = true; renderQuiz(); });
  $("nextCard").addEventListener("click", nextCard);
  $("markGood").addEventListener("click", () => { const card = state.quiz.deck[state.quiz.index]; if (card) card.stats.good++; saveState(); nextCard(); });
  $("markAgain").addEventListener("click", () => { const card = state.quiz.deck[state.quiz.index]; if (card) card.stats.again++; saveState(); nextCard(); });
  $("resetAll").addEventListener("click", () => { if (confirm("保存済みカードと設定を削除しますか？")) { localStorage.removeItem(STORAGE_KEY); state.cards = []; state.settings.deckFilter = ALL_DECKS; saveAndRender(); } });
  ["deckFilter", "rangeStart", "rangeEnd", "orderMode", "directionMode"].forEach((id) => $(id).addEventListener("change", () => { syncSettingsFromInputs(); saveAndRender(); }));
  $("cardSearch").addEventListener("input", () => { syncSettingsFromInputs(); state.settings.rangeStart = 1; state.settings.rangeEnd = getVisibleCards().length || 1; saveAndRender(); });
}

loadState();
bindEvents();
renderSettings();
renderEditors();
renderQuiz();
