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

const CRISIS_WORDS = ['죽고 싶', '죽고싶', '죽을래', '자살', '자해', '극단적', '살기 싫', '살기싫', '살고 싶지 않', '사라지고 싶', '뛰어내리', '목숨', '끝내고 싶', '다 끝내', '없어지고 싶'];

const $ = (s) => document.querySelector(s);
const DEBUG = new URLSearchParams(location.search).has('debug'); // ?debug 면 AI 기술 정보 표시
const log = $('#log');
const state = {
  facts: Object.fromEntries(Object.keys(FIELDS).map((k) => [k, k === 'crisis' ? '없음' : '모름'])),
  asked: new Set(),
  buttonMode: false,
  pending: null,     // 지금 되묻는 항목
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
  $('#ledgerCount').textContent = `${filled} / 6`;

  // 휴대폰용 띠: 같은 내용을 짧게(위기 칸은 109 상자로 따로 보이므로 뺌)
  $('#miniCount').textContent = `${filled} / 6`;
  $('#miniBar').style.width = `${(filled / 6) * 100}%`;
  $('#miniList').replaceChildren(...Object.entries(FIELDS).filter(([k]) => k !== 'crisis').map(([k, f]) => {
    const v = state.facts[k];
    return el('div', { class: 'item' }, el('dt', {}, f.label), el('dd', { class: v === '모름' ? 'unknown' : '' }, v));
  }));
}

// ---------- 위기 ----------
function hasCrisisWord(t) { const s = t.replace(/\s+/g, ' '); return CRISIS_WORDS.some((w) => s.includes(w)); }
function showCrisis() {
  if ($('#crisisSlot').childElementCount) return;
  $('#crisisSlot').append(el('section', { class: 'crisis', role: 'alert' },
    el('h3', {}, '많이 힘드시죠. 먼저 이야기를 들어 줄 곳이 있어요'),
    el('p', {}, '자살예방 상담전화 109는 24시간 연결돼요. 통화한 뒤에도 원하시면 피해 상황 정리를 이어서 도와 드릴게요.'),
    el('a', { class: 'btn primary', href: 'tel:109' }, '☎ 109 전화하기'),
    el('p', { class: 'sources' }, '근거: 정책브리핑_자살예방_상담전화_109_통합'),
  ));
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

function ask(key) {
  state.pending = key;
  state.asked.add(key);
  const { q, opts, field = key } = QUESTIONS[key];
  bot(q);
  choiceRow(opts, (value, label) => {
    user(label);
    state.facts[field] = value;
    state.pending = null;
    state.confirmed = false; // 새 답이 생겼으니 결과 전에 다시 확인
    renderLedger();
    next();
  });
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
  if (hasCrisisWord(text)) { state.facts.crisis = '있음'; showCrisis(); renderLedger(); }
  const wait = bot('정리하고 있어요…');
  let data;
  try { data = await post('/api/extract', { text }); }
  catch (e) { wait.remove(); bot(`정리하지 못했어요(${e.message}). 버튼으로 이어서 여쭤볼게요.`); state.buttonMode = true; return next(); }
  wait.remove();

  // 이미 아는 값은 '모름'으로 덮지 않는다
  for (const [k, v] of Object.entries(data.facts)) {
    if (k === 'crisis') { if (v === '있음') state.facts.crisis = '있음'; }
    else if (v !== '모름') state.facts[k] = v;
  }
  renderLedger();
  const why = data.tried.filter((t) => !t.ok).map((t) => `${t.name}: ${t.reason}`).join(' · ');
  // 화면·내보내기 문구에는 AI 이름·모델명을 드러내지 않고 범용 표기만 쓴다
  state.aiNote = data.mode === 'live' ? 'AI 활용' : '시연 값(단어 맞추기)';
  const aiDetail = data.mode === 'live' ? `${data.provider}${data.model ? ` (${data.model})` : ''}` : '';
  if (DEBUG) {
    // 팀 시연·점검용(주소 끝에 ?debug): 어느 AI가 답했는지, 앞 순서가 왜 실패했는지
    log.append(el('p', { class: `meta ${data.mode === 'live' ? '' : 'demo'}` },
      data.mode === 'live' ? `정리한 AI: ${aiDetail}${why ? ` · 앞 순서 실패 — ${why}` : ''}` : `AI 연결 실패 — ${why || '이유 모름'} · 시연 값으로 정리했어요`));
  } else if (data.mode !== 'live') {
    // 이용자에게는 기술 문구 없이 할 일만
    log.append(el('p', { class: 'meta' }, '자동 정리가 잠시 어려워 간단히 정리했어요. 틀린 칸은 고쳐 주세요.'));
  }

  if (state.facts.crisis === '있음') {
    showCrisis();
    bot('위에 109 안내를 먼저 띄워 두었어요. 원하시면 피해 상황 정리를 이어서 도와 드릴게요.');
    choiceRow([['go', '이어서 정리하기']], () => understood());
    return;
  }
  understood();
}

// final=false: 글을 정리한 직후(모르는 칸은 이어서 버튼으로 물음)
// final=true : 결과 직전 확인. 버튼으로 잘못 고른 답도 여기서 고친다
let understoodSeq = 0;
function understood(final = false) {
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
  btn.addEventListener('click', () => {
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
  catch (e) { return bot(`분류하지 못했어요(${e.message}). 잠시 뒤 다시 시도하거나 365센터 ☎142-235로 문의하세요.`); }
  state.result = r;
  if (r.crisis) showCrisis();
  const g = r.guide;
  const isFraud = r.result === 'fraud';
  const steps = el('ol', {}, g.steps.map((s) => el('li', {}, s)));
  if (isFraud && state.facts.product.startsWith('비실물') && g.nonPhysical) steps.append(el('li', {}, g.nonPhysical));
  const box = el('section', { class: `result ${g.color}` },
    el('span', { class: 'badge' }, g.label),
    el('h3', {}, headline(r)),
    el('div', { class: 'why' },
      el('span', { class: 'why-label' }, '왜 이렇게 안내했나요?'),
      el('p', {}, r.ruleText),
      r.rule ? el('p', { class: 'why-rule' }, `판단 기준: 규칙표 ${r.rule}번`) : null),
    el('h4', { class: 'sr' }, '지금 할 일'), steps,
    el('div', { class: 'orgs' }, g.orgs.map((o) => el('div', { class: 'org' }, el('b', {}, o.name), o.link ? el('a', { href: o.link, target: '_blank', rel: 'noopener' }, o.how) : el('span', {}, o.how)))),
    el('p', { class: 'sources' }, `근거 문서: ${g.sources.join(', ')}`),
    el('p', { class: 'disclaimer' }, '※ 이 안내는 법적 판단이 아닙니다. 사기 여부는 수사기관이, 분쟁은 조정 기관이 판단해요.'),
  );
  const resultMsg = botWide(box);
  if (r.result === 'dispute') botWide(draftBox());
  if (r.result !== 'out') { botWide(sheetBox(r)); botWide(nextBox(r)); }
  const row = el('div', { class: 'row' },
    el('button', { class: 'btn outlined', type: 'button', onclick: openAgent }, '365센터 상담원 연결'),
    el('button', { class: 'btn ghost', type: 'button', onclick: restart }, '처음부터 다시'));
  log.append(row);
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

function sheetText(r, v) {
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
    '5. 필수 첨부 증거 체크리스트', ...g.checklist.map((c) => `   [ ] ${c}`), '',
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
  const refresh = () => (pre.textContent = sheetText(r, values()));
  // 정리표에 적기 시작하면 「내려받지 않음」 상태가 된다(창을 닫을 때 경고)
  Object.values(inputs).forEach((i) => i.addEventListener('input', () => { refresh(); state.unsaved = true; }));
  refresh();
  const download = () => {
    const blob = new Blob(['﻿' + pre.textContent], { type: 'text/plain;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `증거정리표_${stamp().slice(0, 10)}.txt` });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    toast('정리표를 내려받았어요');
    const first = nextSteps(r)[0];
    if (!downloaded) bot(`정리표를 내려받았어요. 다음 단계: ${first.title} — ${first.text}`);
    downloaded = true;
    state.unsaved = false;
  };
  let downloaded = false;
  return el('div', { class: 'sheet' },
    el('h3', {}, '증거 정리표'),
    el('p', { class: 'sub' }, '항상 같은 6칸 양식이에요. 진단 결과·체크리스트·제출 기관은 이미 채워 두었어요. 날짜·금액·상대방 정보는 아는 것만 적고, 나머지는 「모름」으로 남아요. 이 화면 밖으로 저장되지 않아요.'),
    // 입력 칸과 미리보기는 접어 둔다(결과 화면이 길어지지 않게). 버튼은 늘 보인다
    el('details', { class: 'sheet-fold' },
      el('summary', { class: 'btn outlined' }, '정리표 칸 채우기'),
      grid), // 미리보기(pre)는 화면에 두지 않는다 — 헷갈려서. 내려받기·복사 내용으로만 쓴다
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', onclick: download }, '정리표 내려받기(.txt)'),
      el('button', { class: 'btn outlined', type: 'button', onclick: () => copy(pre.textContent) }, '정리표 복사')));
}

// 정리표를 다 쓴 뒤 할 일 — 결과별 순서(기획서 〈표 2〉·〈표 10〉, 안내 문구는 guides.js 와 같은 근거)
function nextSteps(r) {
  const link = (name) => r.guide.orgs.find((o) => o.name.includes(name))?.link;
  const call365 = { label: '☎ 142-235 전화하기', href: 'tel:142235' };
  if (r.result === 'fraud') return [
    { title: '이체한 은행에 전화', text: '정리표의 입금 계좌를 알려 주고 지급정지가 되는지 물어보세요. 은행마다 판단이 달라요.' },
    { title: '경찰에 신고', text: '신고서를 쓸 때 정리표 내용을 옮겨 적고, 체크리스트의 캡처 파일을 첨부하세요. 경찰서 방문도 돼요.', action: { label: '사이버범죄 신고하러 가기', href: link('경찰청') } },
    { title: '막히면 365센터', text: '신고 중 모르는 것이 있으면 연락하세요.', action: call365 },
  ];
  if (r.result === 'dispute') return [
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
  return el('section', { class: 'next', 'aria-labelledby': 'nextTitle' },
    el('p', { class: 'next-eyebrow' }, `${r.guide.label} · 남은 일 ${steps.length}가지`),
    el('h3', { id: 'nextTitle' }, '정리표를 다 썼다면, 이제 이렇게 하세요'),
    el('p', { class: 'sub' }, '길잡이는 대신 접수하지 않아요. 내려받은 정리표를 들고 이 순서대로 직접 내세요.'),
    el('ol', { class: 'next-steps' }, steps.map((s, i) => el('li', {},
      el('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)),
      el('div', { class: 'body' },
        el('b', {}, s.title),
        el('p', {}, s.text),
        !s.action ? null
          : s.action.href ? el('a', { class: 'btn primary', href: s.action.href, ...(s.action.href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) }, s.action.label)
          : el('button', { class: 'btn primary', type: 'button', onclick: s.action.onclick }, s.action.label))))));
}

// ---------- 상담원 연결 ----------
function summaryText() {
  const f = state.facts, r = state.result;
  return [
    '[길잡이 정리 내용]',
    ...Object.entries(FIELDS).map(([k, x]) => `- ${x.label}: ${f[k]}`),
    `- 진단: ${r ? `${r.guide.label}${r.rule ? ` (규칙 ${r.rule})` : ''}` : '아직 진단 전'}`,
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
  state.asked = new Set(); state.buttonMode = false; state.pending = null; state.result = null; state.aiNote = ''; state.confirmed = false;
  log.replaceChildren(); $('#crisisSlot').replaceChildren();
  renderLedger(); start();
}

function start() {
  const hello = bot('안녕하세요. 중고거래 피해 대응 길잡이예요.\n어떤 일이 있었는지 들려주시면 사기·분쟁 중 어디에 가까운지 가려서, 먼저 가야 할 기관과 낼 증거 정리표를 만들어 드려요.\n');
  hello.append(
    el('span', { class: 'warn' }, '길잡이는 기관에 대신 접수하지 않아요. 신고·조정 신청은 정리표를 들고 직접 하셔야 해요.'),
    '· 결과는 법적 판단이 아닌 안내예요.\n· 돈·비밀번호·인증번호는 절대 묻지 않아요.\n\n',
    el('b', {}, '글로 쓰기 어려우시면 아래 「버튼으로 답할게요」를 눌러 주세요.'),
    ' 질문마다 고르기만 하면 돼요.\n글로 쓰실 분은 맨 아래 칸에 편하게 적어 주세요.');
  // 이 버튼은 언제나 누를 수 있다. 누르면 버튼 질문을 처음부터 다시 시작한다
  const startBtn = el('button', { class: 'chip start', type: 'button', onclick: startButtonFlow }, '버튼으로 답할게요');
  log.append(el('div', { class: 'choices' }, startBtn));
}

function startButtonFlow() {
  // 아직 안 누른 이전 질문 버튼은 닫아 두고(헷갈리지 않게), 사실 칸을 비운 뒤 처음부터 묻는다
  log.querySelectorAll('.choices button:not(.start), .understood button, .understood select').forEach((b) => (b.disabled = true));
  const crisis = state.facts.crisis;
  state.facts = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, k === 'crisis' ? crisis : '모름']));
  state.asked = new Set(); state.pending = null; state.result = null; state.aiNote = ''; state.confirmed = false;
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
