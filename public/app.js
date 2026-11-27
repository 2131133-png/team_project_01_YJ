// 중고거래 피해 대응 길잡이 — 화면 동작
// 사실 정리(AI 또는 버튼) → 서버 규칙표 분류(/api/classify) → 결과·증거 정리표
// 화면에는 API 키가 없다. AI 는 /api/extract 가 부른다.

const FIELDS = {
  crisis:    { label: '위기 표현', values: ['있음', '없음'] },
  situation: { label: '상황 구분', values: ['중고거래 피해', '착오송금', '보이스피싱 등 다른 피해', '모름'] },
  payment:   { label: '송금 방법', values: ['계좌이체', '플랫폼 안전결제', '직거래 현장 결제', '모름'] },
  receipt:   { label: '수령 상태', values: ['못 받음', '배송 중이라고 함', '설명과 상태가 다름', '전혀 다른 물건이 옴', '배송 중 파손', '쿠폰·번호가 이미 사용됨·없음', '모름'] },
  contact:   { label: '연락 상태', values: ['연락됨', '답 없음·차단', '판매 글·계정 사라짐', '모름'] },
  fakePost:  { label: '가짜 판매 글 정황', values: ['남의 사진이었음', '다른 피해 글을 봄', '없음', '모름'] },
  product:   { label: '상품 종류', values: ['실물', '비실물(쿠폰·상품권·티켓)', '모름'] },
};

// 되묻는 질문 (기획서 〈표 5〉 「값이 '모름'이면」 칸)
const QUESTIONS = {
  situation: { q: '어떤 일이 있었나요? 가장 가까운 것을 눌러 주세요.', opts: [
    ['중고거래 피해', '중고 물건을 사고 돈을 보냈는데 문제가 생겼어요'],
    ['착오송금', '계좌번호나 금액을 잘못 입력해서 보냈어요'],
    ['보이스피싱 등 다른 피해', '문자·전화를 받고 인증번호를 알려 주거나 링크를 눌렀어요'],
    ['모름', '잘 모르겠어요'],
  ] },
  // 첫 질문에 '잘 모르겠어요'를 고른 분께 한 번 더 쉽게 묻는다(값은 상황 구분 칸에 들어감)
  tradeCheck: { field: 'situation', q: '괜찮아요. 하나만 여쭤볼게요.\n중고 물건이나 쿠폰·상품권을 사려고 누군가에게 돈을 보낸 적이 있나요?', opts: [
    ['중고거래 피해', '네, 사려고 돈을 보냈어요'],
    ['모름', '아니요 / 잘 모르겠어요'],
  ] },
  payment: { q: '돈은 어떻게 보내셨나요?', opts: ['계좌이체', '플랫폼 안전결제', '직거래 현장 결제', '모름'] },
  receipt: { q: '물건은 받으셨나요?', opts: [
    ['못 받음', '못 받음'], ['배송 중이라고 함', '아직 배송 중이라고 함'], ['설명과 상태가 다름', '받았는데 설명과 다름'],
    ['전혀 다른 물건이 옴', '전혀 다른 물건이 옴'], ['배송 중 파손', '배송 중 파손됨'],
    ['쿠폰·번호가 이미 사용됨·없음', '쿠폰·번호가 이미 사용됐거나 없음'], ['모름', '잘 모르겠어요'],
  ] },
  contact: { q: '지금 판매자와 연락이 되나요?', opts: ['연락됨', '답 없음·차단', '판매 글·계정 사라짐', '모름'] },
  product: { q: '무엇을 사셨나요?', opts: ['실물', '비실물(쿠폰·상품권·티켓)', '모름'] },
  fakePost: { q: '판매 글이 수상했던 점이 있었나요?', opts: ['남의 사진이었음', '다른 피해 글을 봄', '없음', '모름'] },
};

const CRISIS_WORDS = ['죽고 싶', '죽고싶', '죽을래', '자살', '자해', '극단적', '살기 싫', '살기싫', '살고 싶지 않', '사라지고 싶', '뛰어내리', '목숨', '끝내고 싶', '다 끝내', '없어지고 싶',
  '죽어버리', '죽어 버리', '죽을 것 같', '죽을것 같', '죽고만 싶', '죽는 게 낫', '죽는게 낫', '죽어야', '살 의미', '살아갈 의미', '살 자신', '삶을 끝', '못 살겠', '못살겠', '자결', '유서', '생을 마감', '세상을 떠나']; // 서버 api/_lib/rules.js 의 CRISIS_WORDS 와 같게 유지

const $ = (s) => document.querySelector(s);
const DEBUG = new URLSearchParams(location.search).has('debug'); // ?debug 면 AI 기술 정보 표시
const log = $('#log');
const state = {
  facts: Object.fromEntries(Object.keys(FIELDS).map((k) => [k, k === 'crisis' ? '없음' : '모름'])),
  asked: new Set(),
  buttonMode: false,
  pending: null,     // 지금 되묻는 항목
  stage: 1,          // 진행 상황 띠: 1 상황 답하기 · 2 기관 확인 · 3 정리표 받기 · 4 모두 끝
  photos: [],        // 증거 사진 { file, url } — 이 화면 메모리에만 둔다
  onPhotos: null,
  hist: [],          // 「이전 단계」용: 질문·확인 화면이 뜰 때마다 쌓는 되돌릴 지점
  result: null,
  aiNote: '',
  busy: false,
};

// ---------- 공통 ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}
// 페이지 맨 아래가 아니라 방금 생긴 말풍선까지만 내린다.
// (휴대폰에서는 대화 아래에 안내 카드가 있어 맨 아래로 내리면 대화가 가려진다)
function scrollEnd(node) {
  if (!node) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' }));
}
function bot(text) { const m = el('div', { class: 'msg bot' }, text); log.append(m); scrollEnd(m); return m; }
function user(text) { const m = el('div', { class: 'msg user' }, text); log.append(m); scrollEnd(m); }
function botWide(node) { const m = el('div', { class: 'msg bot wide' }, node); log.append(m); scrollEnd(m); return m; }
let toastTimer;
function toast(t) { const n = $('#toast'); n.textContent = t; n.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove('show'), 2600); }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('복사했어요'); } catch { toast('복사하지 못했어요. 직접 선택해 복사하세요'); } }
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
  return r.json();
}

// ---------- 사실 장부(시그니처) ----------
const prevLedger = {};
function renderLedger() {
  const dl = $('#ledger');
  dl.replaceChildren();
  let known = 0;
  for (const [k, f] of Object.entries(FIELDS)) {
    const v = state.facts[k];
    const unknown = v === '모름' || (k === 'crisis' && v === '없음');
    if (!unknown || k === 'crisis') known += k === 'crisis' ? 1 : 1;
    const dd = el('dd', { class: [unknown ? 'unknown' : '', k === 'crisis' && v === '있음' ? 'alert' : '', prevLedger[k] !== undefined && prevLedger[k] !== v ? 'fresh' : ''].join(' ') }, k === 'crisis' && v === '없음' ? '감지 안 됨' : v);
    dl.append(el('div', { class: 'item' }, el('dt', {}, f.label), dd));
    prevLedger[k] = v;
  }
  const filled = Object.entries(state.facts).filter(([k, v]) => k !== 'crisis' && v !== '모름').length;
  $('#ledgerCount').textContent = `${filled} / 6칸`;

  // 휴대폰용 띠: 같은 내용을 짧게(위기 칸은 109 상자로 따로 보이므로 뺌)
  $('#miniCount').textContent = `${filled} / 6칸`;
  $('#miniBar').style.width = `${(filled / 6) * 100}%`;
  $('#miniList').replaceChildren(...Object.entries(FIELDS).filter(([k]) => k !== 'crisis').map(([k, f]) => {
    const v = state.facts[k];
    return el('div', { class: 'item' }, el('dt', {}, f.label), el('dd', { class: v === '모름' ? 'unknown' : '' }, v));
  }));
}

// ---------- 진행 상황 띠 ----------
// 앞으로만 나아간다(reset 일 때만 처음으로). sheet=false 면 「정리표 받기」 칸을 숨긴다(범위 밖 결과는 정리표가 없다)
function setStage(n, { reset = false, sheet = true } = {}) {
  if (!reset && n <= state.stage) return;
  state.stage = n;
  const bar = $('#steps');
  bar.classList.toggle('no-sheet', !sheet);
  bar.querySelectorAll('li').forEach((li) => {
    const k = Number(li.dataset.step);
    li.classList.toggle('done', k < n);
    li.classList.toggle('current', k === n);
    li.querySelector('.dot').textContent = k < n ? '✓' : String(k);
    if (k === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

// ---------- 위기 ----------
function hasCrisisWord(t) { const s = t.replace(/\s+/g, ' '); return CRISIS_WORDS.some((w) => s.includes(w)); }
function crisisBox() {
  return el('section', { class: 'crisis', role: 'alert' },
    el('h3', {}, '많이 힘드시죠. 먼저 이야기를 들어 줄 곳이 있어요'),
    el('p', {}, '자살예방 상담전화 109는 24시간 연결돼요. 통화한 뒤에도 원하시면 피해 상황 정리를 이어서 도와 드릴게요.'),
    el('a', { class: 'btn primary', href: 'tel:109' }, '☎ 109 전화하기'));
}
// 위쪽 고정 상자는 한 번만 만들고, inline 이면 지금 보고 있는 대화 아래에도 바로 띄운다(아래에서 쓰는 중에도 보이게)
function showCrisis({ inline = false, scroll = true } = {}) {
  if (!$('#crisisSlot').childElementCount) $('#crisisSlot').append(crisisBox());
  if (inline) { botWide(crisisBox()); return; }
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- 질문 ----------
function choiceRow(opts, onPick) {
  const row = el('div', { class: 'choices' });
  for (const o of opts) {
    const [value, label] = Array.isArray(o) ? o : [o, o];
    row.append(el('button', { class: 'chip', type: 'button', onclick: (e) => {
      row.querySelectorAll('button').forEach((b) => (b.disabled = true));
      e.currentTarget.classList.add('picked');
      onPick(value, label);
    } }, label));
  }
  log.append(row); scrollEnd(row);
  return row;
}

// ---------- 이전 단계 · 처음으로 ----------
function snapshot() { return { facts: { ...state.facts }, asked: new Set(state.asked), confirmed: state.confirmed, n: log.children.length }; }
function restoreSnapshot(s) {
  state.facts = { ...s.facts }; state.asked = new Set(s.asked); state.confirmed = s.confirmed; state.pending = null;
  while (log.children.length > s.n) log.lastElementChild.remove();
  renderLedger();
}
function goBack() {
  state.hist.pop();                 // 지금 화면
  const prev = state.hist.pop();    // 바로 전 화면
  if (!prev) return restart();
  restoreSnapshot(prev);
  next();
}
function navRow() {
  const row = el('div', { class: 'nav-row' },
    state.hist.length > 1 ? el('button', { class: 'btn outlined', type: 'button', onclick: goBack }, '← 이전 단계') : null,
    el('button', { class: 'btn ghost', type: 'button', onclick: restart }, '처음으로 돌아가기'));
  log.append(row); scrollEnd(row);
  return row;
}

function ask(key) {
  state.hist.push(snapshot());
  state.pending = key;
  state.asked.add(key);
  const { q, opts, field = key } = QUESTIONS[key];
  bot(q);
  let nav;
  choiceRow(opts, (value, label) => {
    nav.remove();
    user(label);
    state.facts[field] = value;
    state.pending = null;
    state.confirmed = false; // 새 답이 생겼으니 결과 전에 다시 확인
    renderLedger();
    next();
  });
  nav = navRow();
}

function missing() {
  const f = state.facts;
  if (f.situation === '모름') {
    if (!state.asked.has('situation')) return ['situation'];
    if (!state.asked.has('tradeCheck')) return ['tradeCheck'];
    return [];
  }
  if (f.situation !== '중고거래 피해') return [];
  const keys = ['payment', 'receipt', 'contact', 'product'];
  if (state.buttonMode) keys.push('fakePost'); // 자유 입력에서는 되묻지 않음(기획서)
  return keys.filter((k) => f[k] === '모름' && !state.asked.has(k));
}

function next() {
  const m = missing();
  if (m.length) return ask(m[0]);
  if (!state.confirmed) return understood(true); // 결과 전에 한 번 확인
  classifyNow();
}

// ---------- 자유 입력 ----------
async function onText(text) {
  user(text);
  const crisisNow = hasCrisisWord(text);
  if (crisisNow) { state.facts.crisis = '있음'; showCrisis({ inline: true }); renderLedger(); }
  // 결과가 나온 뒤의 글은 새 사건이 아니라 궁금한 점으로 보고 답한다. 위기 표현이 있으면 AI 에 보내지 않고 109 안내만 한다
  if (state.result && !state.result.crisis) return crisisNow ? undefined : answerQuestion(text);
  // 결과 전: 인사·감사·감정만 고정 문구로 받고, 사건 설명이면 그대로 정리한다(서버 api/ask.js 의 stage 'pre')
  if (!crisisNow) {
    try {
      const d = await post('/api/ask', { question: text, facts: state.facts, stage: 'pre' });
      if (d.kind !== 'event') { showReply(d); return; }
      if (d.prefix) bot(d.prefix);
    } catch { /* 못 받으면 사건 설명으로 보고 이어간다 */ }
  }
  const wait = bot('정리하고 있어요…');
  let data;
  try { data = await post('/api/extract', { text }); }
  catch { wait.remove(); bot('잠시 문제가 생겼어요. 버튼으로 이어서 여쭤볼게요.'); state.buttonMode = true; return next(); }
  wait.remove();

  // 이미 아는 값은 '모름'으로 덮지 않는다
  for (const [k, v] of Object.entries(data.facts)) {
    if (k === 'crisis') { if (v === '있음') state.facts.crisis = '있음'; }
    else if (v !== '모름') state.facts[k] = v;
  }
  renderLedger();
  const why = data.tried.filter((t) => !t.ok).map((t) => `${t.name}: ${t.reason}`).join(' · ');
  // 화면·내보내기 문구에는 AI 이름·모델명을 드러내지 않고 범용 표기만 쓴다
  state.aiNote = 'AI 활용';
  if (DEBUG) {
    // 팀 시연·점검용(주소 끝에 ?debug): 어느 AI가 답했는지, 앞 순서가 왜 실패했는지
    log.append(el('p', { class: `meta ${data.mode === 'live' ? '' : 'demo'}` },
      data.mode === 'live' ? `AI 활용${why ? ` · 앞 순서 실패 — ${why}` : ''}` : `AI 연결 실패 — ${why || '이유 모름'} · 시연 값으로 정리했어요`));
  } else if (data.mode !== 'live') {
    // 이용자에게는 기술 문구 없이 할 일만
    log.append(el('p', { class: 'meta' }, '자동 정리가 잠시 어려워 간단히 정리했어요. 틀린 칸은 고쳐 주세요.'));
  } else {
    log.append(el('p', { class: 'meta' }, 'AI 활용'));
  }

  if (state.facts.crisis === '있음') {
    showCrisis({ scroll: false }); // 글에서 감지된 경우 대화 아래에 이미 띄웠으므로 화면을 위로 끌고 가지 않는다
    bot('109 안내를 먼저 띄워 두었어요. 원하시면 피해 상황 정리를 이어서 도와 드릴게요.');
    choiceRow([['go', '이어서 정리하기']], () => understood());
    return;
  }
  understood();
}

// ---------- 결과 뒤 질문 ----------
async function answerQuestion(text, faqId) {
  const wait = bot('답을 찾고 있어요…');
  try {
    const d = await post('/api/ask', { question: text, facts: state.facts, stage: 'post', faqId });
    wait.remove();
    showReply(d);
  } catch {
    wait.remove();
    bot('잠시 문제가 생겼어요. 조금 뒤 다시 시도하거나 365센터 ☎142-235로 문의해 주세요.');
  }
}

// 서버가 돌려준 답을 그린다: 말풍선 → 바로 연결(전화·링크) → 안내 문구 → 관련 질문 버튼
function showReply(d) {
  bot(d.answer);
  if (d.links?.length) {
    const box = el('div', { class: 'quick-links' }, d.links.map((o) => el('div', { class: 'quick' },
      el('a', { class: 'btn outlined', href: o.tel ? `tel:${o.tel.replace(/[^0-9]/g, '')}` : o.href, ...(o.tel ? {} : { target: '_blank', rel: 'noopener' }) },
        `${o.name}${o.tel ? ` ☎${o.tel}` : ''}`),
      o.note ? el('span', { class: 'quick-note' }, o.note) : null)));
    botWide(box);
  }
  if (d.notice) log.append(el('p', { class: 'meta' }, d.notice));
  if (d.related?.length) {
    bot(d.relatedLabel || '이런 질문도 많이 해요.');
    faqRow({ faq: d.related });
  }
}

// final=false: 글을 정리한 직후(모르는 칸은 이어서 버튼으로 물음)
// final=true : 결과 직전 확인. 버튼으로 잘못 고른 답도 여기서 고친다
let understoodSeq = 0;
function understood(final = false) {
  if (final) state.hist.push(snapshot());
  const keys = ['situation', 'payment', 'receipt', 'contact', 'fakePost', 'product'];
  const n = ++understoodSeq;
  const grid = el('div', { class: 'fact-grid' });
  const selects = {};
  for (const k of keys) {
    const s = el('select', { id: `f${n}-${k}` }, FIELDS[k].values.map((v) => { const o = el('option', { value: v }, v); if (state.facts[k] === v) o.selected = true; return o; }));
    selects[k] = s;
    grid.append(el('div', { class: 'field' }, el('label', { for: `f${n}-${k}` }, FIELDS[k].label), s));
  }
  const btn = el('button', { class: 'btn primary', type: 'button' }, final ? '맞아요, 결과 보기' : '맞아요, 계속하기');
  const box = el('div', { class: 'understood' },
    el('h3', {}, final ? '이렇게 정리했어요. 맞나요?' : '이렇게 이해했어요'),
    el('p', { class: 'sub' }, final
      ? '잘못 누른 답이 있으면 그 칸을 눌러 바로 고쳐 주세요. 다 맞으면 아래 버튼을 눌러 주세요.'
      : '틀린 칸은 고쳐 주세요. 모르는 칸은 버튼으로 다시 여쭤볼게요.'),
    grid, btn);
  botWide(box);
  const nav = final ? navRow() : null;
  btn.addEventListener('click', () => {
    nav?.remove();
    for (const k of keys) { state.facts[k] = selects[k].value; selects[k].disabled = true; }
    btn.disabled = true;
    renderLedger();
    // 고친 결과 아직 안 물은 칸이 생기면 그것부터 묻고, 없으면 확인 끝
    state.confirmed = missing().length === 0;
    next();
  });
}

// ---------- 분류와 결과 ----------
async function classifyNow() {
  let r;
  try { r = await post('/api/classify', { facts: state.facts }); }
  catch { return bot('잠시 문제가 생겼어요. 조금 뒤 다시 시도하거나 365센터 ☎142-235로 문의해 주세요.'); }
  state.result = r;
  if (r.crisis) showCrisis();
  const g = r.guide;
  const isFraud = r.result === 'fraud';
  // 첫 단계는 위의 「지금 가장 먼저 할 일」 상자에 크게 보여 주므로 목록은 2번부터 잇는다
  const steps = el('ol', g.steps.length > 1 ? { start: '2' } : {}, g.steps.slice(1).map((s) => el('li', {}, s)));
  if (isFraud && state.facts.product.startsWith('비실물') && g.nonPhysical) steps.append(el('li', {}, g.nonPhysical));
  const box = el('section', { class: `result ${g.color}` },
    el('span', { class: 'badge' }, g.label),
    el('h3', {}, headline(r)),
    g.steps[0] ? el('div', { class: 'first-step' },
      el('span', { class: 'first-label' }, '지금 가장 먼저 할 일'),
      el('p', {}, g.steps[0])) : null,
    el('div', { class: 'why' },
      el('span', { class: 'why-label' }, '왜 이렇게 안내했나요?'),
      el('p', {}, r.ruleText)),
    el('h4', { class: 'sr' }, '지금 할 일'), steps,
    el('div', { class: 'orgs' }, g.orgs.map((o) => el('div', { class: 'org' }, el('b', {}, o.name), o.link ? el('a', { href: o.link, target: '_blank', rel: 'noopener' }, o.how) : el('span', {}, o.how)))),
    el('p', { class: 'disclaimer' }, '※ 이 안내는 법적 판단이 아닙니다. 사기 여부는 수사기관이, 분쟁은 조정 기관이 판단해요.'),
  );
  const resultMsg = botWide(box);
  if (r.result === 'dispute') botWide(draftBox());
  if (r.result !== 'out') { botWide(sheetBox(r)); botWide(nextBox(r)); }
  const laws = lawBox(r);
  if (laws) botWide(laws);
  setStage(2, { sheet: r.result !== 'out' });
  const row = el('div', { class: 'row' },
    el('button', { class: 'btn outlined', type: 'button', onclick: openAgent }, '365센터 상담원 연결'),
    el('button', { class: 'btn ghost', type: 'button', onclick: restart }, '처음부터 다시'));
  log.append(row);
  bot('궁금한 점이 있으면 맨 아래 칸에 편하게 물어보세요.\n이러한 질문이 있을 수 있어요. 눌러서 바로 물어볼 수도 있어요.');
  faqRow(r);
  // 정리표·다음 단계까지 붙은 뒤, 결과 상자 맨 위에서 읽기 시작하게 한다
  requestAnimationFrame(() => resultMsg.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
}

function headline(r) {
  return { fraud: '사기가 의심되는 상황이에요', dispute: '거래 분쟁으로 보여요', unclear: '상담원과 함께 확인이 필요해요' }[r.result]
    || (r.variant === 'mistransfer' ? '착오송금은 은행과 예금보험공사로 가세요' : '보이스피싱이면 지금 112에 신고하세요');
}

function draftBox() {
  const ta = el('textarea', { id: 'draft', rows: 6 },
    `안녕하세요. [거래 날짜]에 [상품명]을 구매한 사람입니다.\n받은 물건이 판매 글 설명과 달라(상태: ${state.facts.receipt}) 환불을 요청드립니다.\n판매 글 캡처와 받은 물건 사진을 함께 보내 드립니다.\n[답변 기한]까지 답을 주시면 감사하겠습니다.`);
  return el('div', { class: 'sheet draft' },
    el('h3', {}, '판매자에게 보낼 요청 메시지 초안'),
    el('p', { class: 'sub' }, '[ ] 칸을 고친 뒤 복사해 거래 앱 대화창에 보내세요.'),
    el('div', { class: 'field' }, el('label', { for: 'draft' }, '메시지'), ta),
    el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn outlined', type: 'button', onclick: () => copy(ta.value) }, '메시지 복사')));
}

// ---------- 증거 정리표(6칸 고정) ----------
const SHEET_INPUTS = [
  ['timeline', '사건 타임라인', '예: 10/02 14:10 150,000원 계좌이체', true],
  ['amount', '피해 금액', '예: 150,000원 (계좌이체 1회)'],
  ['app', '거래 앱 / 닉네임 / 프로필 ID', '예: OO 앱 / OO마켓 / #ab12cd'],
  ['account', '입금 계좌 (은행·예금주)', '예: OO은행 (예금주 홍OO)'],
  ['phone', '상대방 연락처', '모르면 비워 두세요'],
];

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sheetText(r, v, files = []) {
  const g = r.guide, val = (x) => (x && x.trim()) || '모름';
  const line = '='.repeat(50);
  const orgs = g.orgs.map((o, i) => `${'①②③④⑤'[i]} ${o.name} : ${o.how}${o.link ? ` ${o.link.replace(/^https?:\/\//, '')}` : ''}`);
  const tl = val(v.timeline).split('\n').map((s) => `   - ${s}`).join('\n');
  return [
    line, '[온라인피해365센터] 중고거래 피해 제출용 증거 정리표', line,
    `작성일시 : ${stamp()} (중고거래 피해 대응 길잡이)`, '',
    `1. 진단 결과 : ${g.label} (이유: ${r.ruleText})`, '',
    '2. 사건 타임라인', tl, '',
    `3. 피해 금액 : ${val(v.amount)}${state.facts.payment !== '모름' ? ` / 송금 방법: ${state.facts.payment}` : ''}`, '',
    '4. 상대방 정보',
    `   - 거래 앱 / 닉네임 / 프로필 ID : ${val(v.app)}`,
    `   - 입금 계좌 : ${val(v.account)}`,
    `   - 연락처 : ${val(v.phone)}`, '',
    '5. 필수 첨부 증거 체크리스트', ...g.checklist.map((c) => `   [ ] ${c}`),
    ...(files.length ? [`   첨부한 사진 ${files.length}장: ${files.map((f) => f.name).join(', ')}`] : []), '',
    '6. 우선 제출 기관 (순서)', ...orgs.map((o) => `   ${o}`),
    '-'.repeat(50),
    '※ 위 내용은 피해자가 확인·수정한 것입니다. 원본 캡처 파일을 함께 내세요.',
    '※ 본 정리표는 안내용이며 법적 효력을 갖지 않습니다.', line,
  ].join('\n');
}

// 타임라인 한 줄 만들기: 날짜·시간을 고르고 무슨 일인지 적으면 「11/19 14:10 내용」으로 쌓인다
function timelineAdder(textarea) {
  const p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const date = el('input', { type: 'date', 'aria-label': '날짜', value: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` });
  const time = el('input', { type: 'time', 'aria-label': '시간(모르면 비워 두기)' });
  const what = el('input', { 'aria-label': '무슨 일', placeholder: '예: 30,000원 계좌이체' });
  const add = el('button', { class: 'btn outlined', type: 'button' }, '타임라인에 추가');
  add.addEventListener('click', () => {
    if (!what.value.trim()) { what.focus(); return toast('무슨 일이 있었는지 적어 주세요'); }
    const [, m, d] = (date.value || '').split('-');
    const line = [m && d ? `${m}/${d}` : '', time.value, what.value.trim()].filter(Boolean).join(' ');
    textarea.value = textarea.value.trim() ? `${textarea.value.trim()}\n${line}` : line;
    textarea.dispatchEvent(new Event('input'));
    what.value = ''; time.value = ''; what.focus();
  });
  what.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add.click(); } });
  return el('div', { class: 'tl-adder' }, date, time, what, add);
}

// ---------- 내려받기 도우미(PDF·ZIP은 필요할 때만 라이브러리를 불러온다) ----------
const LIBS = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};
const libLoads = {};
function loadLib(name) {
  libLoads[name] ||= new Promise((resolve, reject) => {
    const s = el('script', { src: LIBS[name] });
    s.onload = resolve;
    s.onerror = () => { delete libLoads[name]; reject(new Error('내려받기 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요')); };
    document.head.append(s);
  });
  return libLoads[name];
}
function saveBlob(blob, filename) {
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileDate = () => stamp().slice(0, 10);

// PDF: 정리표를 A4 너비의 깔끔한 화면으로 그린 뒤 쪽마다 잘라 붙인다(한글 글꼴은 화면 글꼴을 그대로 쓴다)
function pdfNode(r, v, files) {
  const g = r.guide, val = (x) => (x && x.trim()) || '모름';
  const sec = (title, ...kids) => el('section', { style: 'margin:0 0 14px;' }, el('h2', { style: 'font-size:15px;margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid #ccc;' }, title), ...kids);
  const line = (t) => el('p', { style: 'margin:2px 0;font-size:13.5px;line-height:1.6;white-space:pre-wrap;' }, t);
  const tl = val(v.timeline).split('\n').map((s) => line(`• ${s}`));
  const orgs = g.orgs.map((o, i) => line(`${'①②③④⑤'[i]} ${o.name} : ${o.how}${o.link ? ` (${o.link.replace(/^https?:\/\//, '')})` : ''}`));
  return el('div', { style: 'position:fixed;left:-10000px;top:0;width:794px;padding:0 44px;box-sizing:border-box;background:#fff;color:#000;font-family:var(--font);' },
    el('header', { style: 'padding-top:4px;margin-bottom:14px;' },
      el('p', { style: 'font-size:12px;color:#666;margin:0;' }, '온라인피해 365센터 · 중고거래 피해 대응 길잡이'),
      el('h1', { style: 'font-size:22px;margin:2px 0 4px;' }, '증거 정리표'),
      el('p', { style: 'font-size:12px;color:#666;margin:0;' }, `작성일시 ${stamp()}`)),
    sec('1. 진단 결과', line(`${g.label}`), line(`이유: ${r.ruleText}`)),
    sec('2. 사건 타임라인', ...tl),
    sec('3. 피해 금액', line(`${val(v.amount)}${state.facts.payment !== '모름' ? ` / 송금 방법: ${state.facts.payment}` : ''}`)),
    sec('4. 상대방 정보', line(`거래 앱 / 닉네임 / 프로필 ID : ${val(v.app)}`), line(`입금 계좌 : ${val(v.account)}`), line(`연락처 : ${val(v.phone)}`)),
    sec('5. 필수 첨부 증거 체크리스트', ...g.checklist.map((c) => line(`☐ ${c}`)),
      ...(files.length ? [line(`첨부한 사진 ${files.length}장: ${files.map((f) => f.name).join(', ')}`)] : [])),
    sec('6. 우선 제출 기관 (순서)', ...orgs),
    el('footer', { style: 'font-size:11.5px;color:#666;margin-top:8px;' },
      el('p', { style: 'margin:2px 0;' }, '※ 위 내용은 피해자가 확인·수정한 것입니다. 원본 캡처 파일을 함께 내세요.'),
      el('p', { style: 'margin:2px 0;' }, '※ 본 정리표는 안내용이며 법적 효력을 갖지 않습니다.')));
}

async function makePdfBlob(r, v, files) {
  await Promise.all([loadLib('html2canvas'), loadLib('jspdf')]);
  const node = pdfNode(r, v, files);
  document.body.append(node);
  try {
    await document.fonts?.ready;
    const SCALE = 2, W = 794, PAGE_H = Math.round(W * 297 / 210), MARGIN = 40, BODY_H = PAGE_H - 2 * MARGIN;
    // 쪽을 나눌 수 있는 곳 = 각 덩어리(머리글·항목·맺음말)의 아래쪽 끝
    const blocks = [...node.children].map((c) => c.offsetTop + c.offsetHeight);
    const total = node.scrollHeight;
    // html2canvas 는 oklch() 색을 못 읽는다 — 복제된 문서의 바탕만 흰색으로 덮어 읽기 오류를 피한다
    const canvas = await window.html2canvas(node, {
      scale: SCALE, backgroundColor: '#fff', useCORS: true,
      onclone: (doc) => { for (const e of [doc.documentElement, doc.body]) e.style.setProperty('background', '#fff', 'important'); },
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    let start = 0, page = 0;
    while (start < total - 1) {
      let end = start + BODY_H;
      if (end >= total) end = total;
      else { const fit = blocks.filter((b) => b > start + 40 && b <= end); if (fit.length) end = Math.max(...fit); }
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = Math.max(1, Math.round((end - start) * SCALE));
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, Math.round(start * SCALE), canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      if (page) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, MARGIN * 210 / W, 210, (end - start) * 210 / W);
      start = end; page += 1;
    }
    return pdf.output('blob');
  } finally { node.remove(); }
}

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const MAX_PHOTOS = 20, MAX_PHOTO_BYTES = 15 * 1048576;

// 증거 사진 칸은 정리표 상자와 「할 일 1번」 두 곳에 있고, 같은 사진 목록을 함께 쓴다(이 화면 안 메모리에서만)
const photoViews = new Set();
function renderAllPhotos() { photoViews.forEach((f) => f()); state.onPhotos?.(); }
function resetPhotos() { state.photos.forEach((p) => URL.revokeObjectURL(p.url)); state.photos = []; photoViews.clear(); state.onPhotos = null; }
function photoPicker(id) {
  const list = el('ul', { class: 'photo-list', 'aria-label': '첨부한 증거 사진' });
  const input = el('input', { type: 'file', id, accept: 'image/*', multiple: '' });
  const render = () => list.replaceChildren(...state.photos.map((p, i) => el('li', {},
    el('img', { src: p.url, alt: '' }),
    el('span', { class: 'photo-name' }, `${p.file.name} (${fmtSize(p.file.size)})`),
    el('button', { class: 'btn ghost', type: 'button', 'aria-label': `${p.file.name} 빼기`, onclick: () => { URL.revokeObjectURL(p.url); state.photos.splice(i, 1); renderAllPhotos(); state.unsaved = true; } }, '빼기'))));
  input.addEventListener('change', () => {
    for (const f of input.files) {
      if (!f.type.startsWith('image/')) { toast(`${f.name}: 사진 파일만 올릴 수 있어요`); continue; }
      if (f.size > MAX_PHOTO_BYTES) { toast(`${f.name}: 15MB보다 커서 뺐어요`); continue; }
      if (state.photos.length >= MAX_PHOTOS) { toast(`사진은 ${MAX_PHOTOS}장까지 넣을 수 있어요`); break; }
      state.photos.push({ file: f, url: URL.createObjectURL(f) });
    }
    input.value = '';
    renderAllPhotos(); state.unsaved = true;
  });
  photoViews.add(render); render();
  return el('div', { class: 'photo-box' },
    el('label', { for: id, class: 'photo-label' }, '📷 증거 사진 올리기 (선택)'),
    el('p', { class: 'sub' }, `캡처·사진을 고르면 「사진 포함 ZIP」에 정리표와 함께 담아요. 최대 ${MAX_PHOTOS}장. 사진은 이 기기 안에서만 쓰이고 서버로 보내지 않아요.`),
    input, list);
}

function sheetBox(r) {
  const grid = el('div', { class: 'fact-grid' });
  const inputs = {};
  for (const [k, label, ph, multi] of SHEET_INPUTS) {
    const extra = k === 'amount' ? { inputmode: 'numeric' } : k === 'phone' ? { inputmode: 'tel', type: 'tel' } : {};
    const input = multi ? el('textarea', { id: `s-${k}`, rows: 3, placeholder: ph }) : el('input', { id: `s-${k}`, placeholder: ph, ...extra });
    inputs[k] = input;
    const field = el('div', { class: `field ${multi ? 'full' : ''}` }, el('label', { for: `s-${k}` }, label));
    if (k === 'timeline') field.append(timelineAdder(input));
    field.append(input);
    grid.append(field);
  }
  // 피해 금액: 숫자만 넣으면 30,000원 처럼 바꿔 준다(입력칸을 벗어날 때)
  inputs.amount.addEventListener('blur', () => {
    const digits = inputs.amount.value.replace(/[^\d]/g, '');
    if (!digits || /[가-힣a-zA-Z]/.test(inputs.amount.value.replace(/원/g, ''))) return; // 설명을 섞어 쓴 경우는 그대로
    inputs.amount.value = `${Number(digits).toLocaleString('ko-KR')}원`;
    inputs.amount.dispatchEvent(new Event('input'));
  });

  const pre = el('pre', { 'aria-label': '정리표 미리보기' });
  const values = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
  const files = () => state.photos.map((p) => p.file);
  const refresh = () => (pre.textContent = sheetText(r, values(), files()));
  state.onPhotos = refresh;
  // 정리표에 적기 시작하면 「내려받지 않음」 상태가 된다(창을 닫을 때 경고)
  Object.values(inputs).forEach((i) => i.addEventListener('input', () => { refresh(); state.unsaved = true; }));
  refresh();

  let downloaded = false;
  const done = (msg) => {
    toast(msg);
    setStage(4);
    const first = nextSteps(r)[0];
    if (!downloaded) bot(`정리표를 내려받았어요. 다음 단계: ${first.title} — ${first.text}`);
    downloaded = true;
    state.unsaved = false;
  };
  // 시간이 걸리는 내려받기(PDF·ZIP)는 버튼에 「만드는 중…」을 보여 주고 실패하면 이유를 알려 준다
  const busyBtn = (label, fn) => {
    const b = el('button', { class: 'btn outlined', type: 'button' }, label);
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true; b.textContent = '만드는 중…';
      try { await fn(); } catch (e) { toast(e.message || '만들지 못했어요. 다시 시도해 주세요'); } finally { b.disabled = false; b.textContent = label; }
    });
    return b;
  };
  const downloadTxt = () => { saveBlob(new Blob(['﻿' + pre.textContent], { type: 'text/plain;charset=utf-8' }), `증거정리표_${fileDate()}.txt`); done('정리표를 내려받았어요'); };
  const pdfBtn = busyBtn('PDF로 내려받기', async () => {
    saveBlob(await makePdfBlob(r, values(), files()), `증거정리표_${fileDate()}.pdf`);
    done('PDF로 내려받았어요');
  });
  const zipBtn = busyBtn('사진 포함 ZIP 내려받기', async () => {
    await loadLib('jszip');
    const zip = new window.JSZip();
    zip.file('증거정리표.txt', '﻿' + pre.textContent);
    try { zip.file('증거정리표.pdf', await makePdfBlob(r, values(), files())); } catch { toast('PDF는 빼고 묶었어요(만들지 못함)'); }
    const folder = zip.folder('증거사진');
    state.photos.forEach((p, i) => folder.file(`${String(i + 1).padStart(2, '0')}_${p.file.name}`, p.file));
    saveBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `증거자료_${fileDate()}.zip`);
    done(state.photos.length ? `사진 ${state.photos.length}장을 묶어 내려받았어요` : 'ZIP으로 내려받았어요(사진 없이)');
  });

  const box = el('div', { class: 'sheet' },
    el('h3', {}, '증거 정리표'),
    el('p', { class: 'sub' }, '항상 같은 6칸 양식이에요. 진단 결과·체크리스트·제출 기관은 이미 채워 두었어요. 날짜·금액·상대방 정보는 아는 것만 적고, 나머지는 「모름」으로 남아요. 이 화면 밖으로 저장되지 않아요.'),
    // 입력 칸과 미리보기는 접어 둔다(결과 화면이 길어지지 않게). 버튼은 늘 보인다
    el('details', { class: 'sheet-fold' },
      el('summary', { class: 'btn outlined' }, '정리표 칸 채우기'),
      grid), // 미리보기(pre)는 화면에 두지 않는다 — 헷갈려서. 내려받기·복사 내용으로만 쓴다
    photoPicker('photoInput'),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', onclick: downloadTxt }, '정리표 내려받기(.txt)'),
      pdfBtn, zipBtn,
      el('button', { class: 'btn outlined', type: 'button', onclick: () => copy(pre.textContent) }, '정리표 복사')));
  // 정리표를 만지기 시작하면 「정리표 받기」 단계로 넘어간다
  for (const ev of ['focusin', 'click']) box.addEventListener(ev, () => setStage(3));
  return box;
}

// 정리표를 다 쓴 뒤 할 일 — 결과별 순서(기획서 〈표 2〉·〈표 10〉, 안내 문구는 guides.js 와 같은 근거)
function nextSteps(r) {
  const link = (name) => r.guide.orgs.find((o) => o.name.includes(name))?.link;
  const call365 = { label: '☎ 142-235 전화하기', href: 'tel:142235' };
  // 정리표 5번(첨부 증거)을 먼저 갖춘 뒤에 기관으로 간다 — 바로 신고부터 안내하지 않는다
  const prep = {
    title: '첨부할 증거부터 모으기',
    text: '기관에 가기 전에 정리표 5번 항목을 하나씩 준비하세요. 휴대폰 화면 캡처와 앱의 내역 화면이면 대부분 됩니다. 파일은 한 폴더(또는 앨범)에 모아 두면 신고서에 올리기 쉬워요.',
    items: r.guide.checklist,
    photo: true,
    tip: '캡처할 때는 날짜·시간이 화면에 보이게 하고, 대화는 중간을 빼지 말고 처음부터 끝까지 이어서 찍으세요. 판매 글과 상대 프로필은 지워지기 전에 가장 먼저 남기세요.',
  };
  if (r.result === 'fraud') return [
    prep,
    { title: '이체한 은행에 전화', text: '정리표의 입금 계좌를 알려 주고 지급정지가 되는지 물어보세요. 은행마다 판단이 달라요.' },
    { title: '경찰에 신고', text: '신고서를 쓸 때 정리표 내용을 옮겨 적고, 체크리스트의 캡처 파일을 첨부하세요. 경찰서 방문도 돼요.', action: { label: '사이버범죄 신고하러 가기', href: link('경찰청') } },
    { title: '막히면 365센터', text: '신고 중 모르는 것이 있으면 연락하세요.', action: call365 },
  ];
  if (r.result === 'dispute') return [
    prep,
    { title: '판매자에게 요청', text: '요청 메시지 초안을 거래 앱 대화창으로 보내고, 보낸 화면도 캡처해 두세요.', action: { label: '요청 메시지 복사', onclick: () => copy($('#draft')?.value || '') } },
    { title: '거래 앱 고객센터', text: '답이 없거나 거절하면 정리표를 내고 1차 조정을 요청하세요.' },
    { title: '분쟁조정위원회', text: '플랫폼 조정이 안 되면 정리표와 캡처 파일로 2차 조정을 신청하세요.', action: { label: '분쟁조정 신청하러 가기', href: link('분쟁조정') } },
  ];
  return [
    { title: '365센터 상담원 연결', text: '전화로 연결하고, 길잡이가 정리한 내용을 상담원에게 알려 주세요.', action: { label: '상담원 연결 열기', onclick: openAgent } },
    { title: '증거 보관', text: '상담을 기다리는 동안 판매 글·대화·입금 내역 캡처를 지우지 말고 보관하세요.' },
  ];
}

function nextBox(r) {
  const steps = nextSteps(r);
  const progress = el('span', { class: 'next-progress', 'aria-live': 'polite' });
  const items = []; // { li, num, on, set(on) }
  const refreshProgress = () => { progress.textContent = `${items.filter((x) => x.on).length} / ${steps.length} 완료`; };
  const ol = el('ol', { class: 'next-steps' }, steps.map((s, i) => {
    const li = el('li', {});
    const num = el('button', { class: 'num', type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': `${i + 1}번 ${s.title} — 끝냈으면 눌러서 체크` }, String(i + 1));
    const item = { li, num, on: false };
    item.set = (on) => {
      item.on = on;
      li.classList.toggle('done', on);
      num.setAttribute('aria-checked', String(on));
      num.textContent = on ? '✓' : String(i + 1);
      refreshProgress();
    };
    num.addEventListener('click', () => {
      item.set(!item.on);
      // 1번 단계의 세부 항목은 단계를 체크하거나 풀면 함께 바뀐다
      li.querySelectorAll('.prep-list input').forEach((c) => { c.checked = item.on; });
    });
    items.push(item);
    // 세부 항목(증거 준비물)은 하나씩 체크할 수 있고, 모두 체크하면 단계도 체크된다
    const prepList = s.items ? el('ul', { class: 'prep-list' }, s.items.map((t) => {
      const cb = el('input', { type: 'checkbox' });
      cb.addEventListener('change', () => item.set([...prepList.querySelectorAll('input')].every((c) => c.checked)));
      return el('li', {}, el('label', {}, cb, el('span', {}, t)));
    })) : null;
    li.append(num, el('div', { class: 'body' },
      el('b', {}, s.title),
      el('p', {}, s.text),
      prepList,
      s.photo ? photoPicker('photoInputStep') : null,
      s.tip ? el('p', { class: 'prep-tip' }, s.tip) : null,
      !s.action ? null
        : s.action.href ? el('a', { class: 'btn primary', href: s.action.href, ...(s.action.href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) }, s.action.label)
        : el('button', { class: 'btn primary', type: 'button', onclick: s.action.onclick }, s.action.label)));
    return li;
  }));
  refreshProgress();
  return el('section', { class: 'next', 'aria-labelledby': 'nextTitle' },
    el('p', { class: 'next-eyebrow' }, `${r.guide.label} · 남은 일 ${steps.length}가지 · `, progress),
    el('h3', { id: 'nextTitle' }, '정리표를 다 썼다면, 이제 이렇게 하세요'),
    el('p', { class: 'sub' }, '길잡이는 대신 접수하지 않아요. 먼저 증거를 갖춘 뒤, 내려받은 정리표를 들고 이 순서대로 직접 진행하세요. 끝낸 일은 번호 단추를 눌러 체크해 두세요.'),
    ol);
}

// ---------- 자주 묻는 질문 ----------
// 결과별 질문 목록은 서버(api/_lib/faq.js)가 정한다. 못 받았을 때만 아래 기본 질문을 쓴다
function faqs(r) {
  return Array.isArray(r.faq) && r.faq.length ? r.faq : [{ id: 12, q: '365센터는 뭘 해 주나요?' }, { id: 5, q: '변호사 없이도 도움받을 수 있나요?' }];
}
function faqRow(r) {
  const row = el('div', { class: 'choices faq' }, faqs(r).map((f) => el('button', {
    class: 'chip', type: 'button',
    onclick: async () => {
      if (state.busy) return;
      state.busy = true; $('#sendBtn').disabled = true;
      user(f.q);
      try { await answerQuestion(f.q, f.id); } finally { state.busy = false; $('#sendBtn').disabled = false; }
    },
  }, f.q)));
  log.append(row); scrollEnd(row);
}

// ---------- 관련 법령 보기(국가법령정보 조회) ----------
const lawLink = (l) => encodeURI(`https://www.law.go.kr/법령/${l.name}/제${l.jo.no}조${l.jo.branch ? `의${l.jo.branch}` : ''}`);
const joText = (l) => `제${l.jo.no}조${l.jo.branch ? `의${l.jo.branch}` : ''}`;
const ymd = (s) => String(s || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');

function lawBox(r) {
  const laws = r.guide.laws || [];
  if (!laws.length) return null;
  const items = laws.map((l) => {
    const out = el('div', { class: 'law-out', 'aria-live': 'polite' });
    const btn = el('button', { class: 'btn outlined', type: 'button' }, '조문 실시간 조회');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '국가법령정보센터에서 가져오는 중…';
      out.replaceChildren();
      try {
        const d = await post('/api/law', { name: l.name, jo: l.jo });
        if (d.mode === 'live') {
          out.append(
            el('p', { class: 'law-head' }, `${d.law.name} ${d.article.label}${d.article.title ? `(${d.article.title})` : ''}`),
            el('pre', { class: 'law-text' }, d.article.text),
            el('p', { class: 'sources' }, `국가법령정보센터 실시간 조회${d.law.effective ? ` · 시행일 ${ymd(d.law.effective)}` : ''}${d.law.dept ? ` · 소관 ${d.law.dept}` : ''}`));
        } else {
          out.append(el('p', { class: 'law-note' }, `${d.reason || '지금은 가져오지 못했어요'}. 아래 「원문 보기」에서 최신 조문을 확인해 주세요.`));
        }
      } catch (e) {
        out.append(el('p', { class: 'law-note' }, `지금은 조문을 불러오지 못했어요. 아래 「원문 보기」에서 확인해 주세요.`));
      } finally { btn.disabled = false; btn.textContent = '다시 조회'; }
    });
    return el('li', {},
      el('b', {}, `${l.name} ${joText(l)}`),
      el('p', {}, l.why),
      el('div', { class: 'row' }, btn, el('a', { class: 'btn ghost', href: lawLink(l), target: '_blank', rel: 'noopener' }, '원문 보기 ↗')),
      out);
  });
  return el('details', { class: 'laws' },
    el('summary', { class: 'btn outlined' }, '관련 법령 보기'),
    el('p', { class: 'sub' }, '이 상황과 관련된 법 조문이에요. 「조문 실시간 조회」를 누르면 국가법령정보센터의 현행 조문을 바로 가져와요. 법령이 내 사건에 적용되는지는 기관이 판단해요.'),
    el('ul', { class: 'law-list' }, items));
}

// ---------- 상담원 연결 ----------
function summaryText() {
  const f = state.facts, r = state.result;
  return [
    '[길잡이 정리 내용]',
    ...Object.entries(FIELDS).map(([k, x]) => `- ${x.label}: ${f[k]}`),
    `- 진단: ${r ? `${r.guide.label}` : '아직 진단 전'}`,
    state.aiNote ? `- 정리 방식: ${state.aiNote}` : '- 정리 방식: 버튼 답변',
  ].join('\n');
}
function openAgent() { $('#agentSummary').textContent = summaryText(); $('#agentDialog').showModal(); }
$('#agentBtn').addEventListener('click', openAgent);
$('#closeAgent').addEventListener('click', () => $('#agentDialog').close());
$('#copySummary').addEventListener('click', () => copy(summaryText()));

// ---------- 시작 ----------
function restart() {
  if (state.unsaved && !confirm('작성한 증거 정리표를 아직 내려받지 않았어요.\n처음부터 하면 적은 내용이 지워져요. 그래도 처음부터 할까요?')) return;
  state.unsaved = false;
  state.facts = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, k === 'crisis' ? '없음' : '모름']));
  state.asked = new Set(); state.buttonMode = false; state.pending = null; state.result = null; state.aiNote = ''; state.confirmed = false; state.hist = []; resetPhotos(); setStage(1, { reset: true });
  log.replaceChildren(); $('#crisisSlot').replaceChildren();
  renderLedger(); start();
}

// 첫 인사의 원본은 docs/페르소나.md 의 「첫 인사」다. 서버(/api/persona)에서 읽어 오고,
// 못 읽으면(서버 오류·문서 없음) 아래 기본 문구를 그대로 쓴다. 기본 문구는 문서와 같은 글로 맞춰 둔다.
const DEFAULT_GREETING = '안녕하세요. 중고거래 피해 대응 길잡이예요. 피해 상황을 들려주시면 먼저 가야 할 기관과 낼 증거 정리표를 만들어 드려요.';

function start() {
  const intro = document.createTextNode(`${DEFAULT_GREETING}\n`);
  const hello = bot('');
  hello.append(intro);
  fetch('/api/persona').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d?.greeting && d.greeting !== DEFAULT_GREETING) intro.textContent = `${d.greeting}\n`;
  }).catch(() => { /* 기본 문구를 그대로 둔다 */ });
  hello.append(
    el('span', { class: 'warn' }, '길잡이는 기관에 대신 접수하지 않아요. 정리표를 들고 직접 신고·신청하셔야 해요.'),
    el('b', {}, '글로 쓰기 어려우시면 아래 「버튼으로 답할게요」를 눌러 주세요.'));
  // 이 버튼은 언제나 누를 수 있다. 누르면 버튼 질문을 처음부터 다시 시작한다
  const startBtn = el('button', { class: 'chip start', type: 'button', onclick: startButtonFlow }, '버튼으로 답할게요');
  log.append(el('div', { class: 'choices' }, startBtn));
}

function startButtonFlow() {
  // 아직 안 누른 이전 질문 버튼은 닫아 두고(헷갈리지 않게), 사실 칸을 비운 뒤 처음부터 묻는다
  log.querySelectorAll('.choices button:not(.start), .understood button, .understood select').forEach((b) => (b.disabled = true));
  const crisis = state.facts.crisis;
  state.facts = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, k === 'crisis' ? crisis : '모름']));
  state.asked = new Set(); state.pending = null; state.result = null; state.aiNote = ''; state.confirmed = false; state.hist = []; resetPhotos(); setStage(1, { reset: true });
  state.buttonMode = true;
  renderLedger();
  user('버튼으로 답할게요');
  next();
}

$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('#input').value.trim();
  if (!t || state.busy) return;
  $('#input').value = '';
  state.busy = true; $('#sendBtn').disabled = true;
  try { await onText(t); } finally { state.busy = false; $('#sendBtn').disabled = false; }
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});

// 큰 글씨 — 화면 전체를 1.2배로. 이 기기에서만 기억한다(피해 내용은 저장하지 않음)
function setLarge(on) {
  document.documentElement.classList.toggle('large', on);
  $('#textSize').setAttribute('aria-pressed', String(on));
  $('#textSize').textContent = on ? '보통 글씨' : '큰 글씨';
  try { localStorage.setItem('largeText', on ? '1' : '0'); } catch { /* 저장 못 해도 화면은 바뀜 */ }
}
$('#textSize').addEventListener('click', () => {
  const on = !document.documentElement.classList.contains('large');
  setLarge(on);
  toast(on ? '글씨를 크게 했어요' : '글씨를 원래 크기로 했어요');
});
try { if (localStorage.getItem('largeText') === '1') setLarge(true); } catch { /* 무시 */ }

// 전화 버튼(tel:) — 휴대폰은 바로 전화, PC(마우스 기기)는 걸 수 없으니 번호를 복사해 준다
const CANT_CALL = matchMedia('(hover: hover) and (pointer: fine)').matches;
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[href^="tel:"]');
  if (!a || !CANT_CALL) return;
  e.preventDefault();
  const raw = a.getAttribute('href').slice(4);
  const num = raw.length === 6 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw; // 142235 → 142-235
  try { await navigator.clipboard.writeText(num); toast(`${num} 번호를 복사했어요. 휴대폰이나 전화기로 걸어 주세요`); }
  catch { toast(`☎ ${num} — 휴대폰이나 전화기로 걸어 주세요`); }
});

// 정리표를 적고 내려받지 않은 채 창을 닫거나 새로고침하면 브라우저 확인 창을 띄운다
// (브라우저 정책상 확인 창의 문구는 바꿀 수 없다)
window.addEventListener('beforeunload', (e) => {
  if (!state.unsaved) return;
  e.preventDefault();
  e.returnValue = '';
});

renderLedger();
start();
