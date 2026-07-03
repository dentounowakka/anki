const STORAGE_KEY = "anki-web-app-state-v1";

const state = {
  cards: [],
  settings: { rangeStart: 1, rangeEnd: 1, orderMode: "sequential", directionMode: "frontToBack" },
  quiz: { deck: [], index: 0, answerVisible: false, currentDirection: "frontToBack" },
};

const $ = (id) => document.getElementById(id);

function parseCsv(text) {
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

  const [first = []] = rows;
  const hasHeader = first.map((v) => v.toLowerCase()).some((v) => ["front", "back", "question", "answer", "image", "表", "裏"].includes(v));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const headers = hasHeader ? first.map((v) => v.toLowerCase()) : [];
  const findIndex = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
  const frontIndex = hasHeader ? findIndex("front", "question", "表", "問題") ?? 0 : 0;
  const backIndex = hasHeader ? findIndex("back", "answer", "裏", "答え") ?? 1 : 1;
  const imageIndex = hasHeader ? findIndex("image", "photo", "写真", "画像") : 2;

  return dataRows.map((cols) => ({
    id: crypto.randomUUID(),
    front: cols[frontIndex] || "",
    back: cols[backIndex] || "",
    image: imageIndex >= 0 ? cols[imageIndex] || "" : "",
    stats: { good: 0, again: 0 },
  })).filter((card) => card.front || card.back);
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
    state.cards = parsed.cards || [];
    state.settings = { ...state.settings, ...(parsed.settings || {}) };
    $("storageStatus").textContent = "前回保存したカードを自動で読み込みました。";
  } catch {
    $("storageStatus").textContent = "保存データを読み込めませんでした。";
  }
}

function syncSettingsFromInputs() {
  state.settings = {
    rangeStart: Number($("rangeStart").value) || 1,
    rangeEnd: Number($("rangeEnd").value) || state.cards.length || 1,
    orderMode: $("orderMode").value,
    directionMode: $("directionMode").value,
  };
}

function renderSettings() {
  $("rangeStart").value = state.settings.rangeStart;
  $("rangeEnd").value = Math.max(state.settings.rangeEnd, state.cards.length || 1);
  $("rangeEnd").max = state.cards.length || 1;
  $("rangeStart").max = state.cards.length || 1;
  $("orderMode").value = state.settings.orderMode;
  $("directionMode").value = state.settings.directionMode;
}

function renderEditors() {
  const list = $("cardList");
  list.innerHTML = "";
  $("cardCount").textContent = `${state.cards.length}枚`;
  state.cards.forEach((card, index) => {
    const node = $("cardEditorTemplate").content.firstElementChild.cloneNode(true);
    node.querySelector(".card-number").textContent = `#${index + 1}`;
    node.querySelector(".front-input").value = card.front;
    node.querySelector(".back-input").value = card.back;
    const preview = node.querySelector(".preview");
    if (card.image) { preview.src = card.image; preview.classList.remove("hidden"); }
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
  const start = Math.max(1, Math.min(state.settings.rangeStart, state.cards.length));
  const end = Math.max(start, Math.min(state.settings.rangeEnd, state.cards.length));
  let deck = state.cards.slice(start - 1, end);
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
    $("questionText").textContent = state.cards.length ? "範囲を選んで開始してください" : "CSVを読み込んでください";
    $("answerText").textContent = "";
    $("cardImage").classList.add("hidden");
    return;
  }
  const frontFirst = state.quiz.currentDirection === "frontToBack";
  $("questionLabel").textContent = frontFirst ? "問題（表）" : "問題（裏）";
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
  state.settings.rangeEnd = state.cards.length || 1;
  saveState();
  renderSettings();
  renderEditors();
  renderQuiz();
}

function bindEvents() {
  $("csvFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.cards = parseCsv(await file.text());
    saveAndRender();
  });
  $("loadTextCsv").addEventListener("click", () => { state.cards = parseCsv($("csvText").value); saveAndRender(); });
  $("addBlankCard").addEventListener("click", () => { state.cards.push({ id: crypto.randomUUID(), front: "", back: "", image: "", stats: { good: 0, again: 0 } }); saveAndRender(); });
  $("startQuiz").addEventListener("click", buildDeck);
  $("showAnswer").addEventListener("click", () => { state.quiz.answerVisible = true; renderQuiz(); });
  $("nextCard").addEventListener("click", nextCard);
  $("markGood").addEventListener("click", () => { const card = state.quiz.deck[state.quiz.index]; if (card) card.stats.good++; saveState(); nextCard(); });
  $("markAgain").addEventListener("click", () => { const card = state.quiz.deck[state.quiz.index]; if (card) card.stats.again++; saveState(); nextCard(); });
  $("resetAll").addEventListener("click", () => { if (confirm("保存済みカードと設定を削除しますか？")) { localStorage.removeItem(STORAGE_KEY); state.cards = []; saveAndRender(); } });
  ["rangeStart", "rangeEnd", "orderMode", "directionMode"].forEach((id) => $(id).addEventListener("change", () => { syncSettingsFromInputs(); saveState(); }));
}

loadState();
bindEvents();
renderSettings();
renderEditors();
renderQuiz();
