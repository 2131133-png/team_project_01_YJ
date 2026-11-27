// 〈표 5〉 사실 항목과 고를 수 있는 값 · 〈표 7〉 분류 규칙표 (기획서 그대로)
// AI 는 이 값 목록 안에서만 고른다. 분류는 AI 없이 이 파일의 코드가 한다.

export const FIELDS = {
  crisis:    { label: '위기 표현', values: ['있음', '없음'] },
  situation: { label: '상황 구분', values: ['중고거래 피해', '착오송금', '보이스피싱 등 다른 피해', '모름'] },
  payment:   { label: '송금 방법', values: ['계좌이체', '플랫폼 안전결제', '직거래 현장 결제', '모름'] },
  receipt:   { label: '수령 상태', values: ['못 받음', '배송 중이라고 함', '설명과 상태가 다름', '전혀 다른 물건이 옴', '배송 중 파손', '쿠폰·번호가 이미 사용됨·없음', '모름'] },
  contact:   { label: '연락 상태', values: ['연락됨', '답 없음·차단', '판매 글·계정 사라짐', '모름'] },
  fakePost:  { label: '가짜 판매 글 정황', values: ['남의 사진이었음', '다른 피해 글을 봄', '없음', '모름'] },
  product:   { label: '상품 종류', values: ['실물', '비실물(쿠폰·상품권·티켓)', '모름'] },
};

// 위기 단어 목록(초안) — 팀이 4단계 시험 뒤 고친다. 하나라도 걸리면 '있음'
export const CRISIS_WORDS = [
  '죽고 싶', '죽고싶', '죽을래', '자살', '자해', '극단적', '살기 싫', '살기싫', '살고 싶지 않',
  '사라지고 싶', '뛰어내리', '목숨', '끝내고 싶', '다 끝내', '없어지고 싶',
  '죽어버리', '죽어 버리', '죽을 것 같', '죽을것 같', '죽고만 싶', '죽는 게 낫', '죽는게 낫', '죽어야', '살 의미', '살아갈 의미', '살 자신', '삶을 끝', '못 살겠', '못살겠', '자결', '유서', '생을 마감', '세상을 떠나',
];
// 「힘들다」처럼 평범하게 자주 쓰는 말은 단독으로는 넣지 않는다(오작동 방지). 타인을 해치겠다는 표현은 따로 정한 뒤 추가한다.

export function hasCrisisWord(text = '') {
  const t = String(text).replace(/\s+/g, ' ');
  return CRISIS_WORDS.some((w) => t.includes(w));
}

export function emptyFacts() {
  return Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, k === 'crisis' ? '없음' : '모름']));
}

// 목록에 없는 값은 버리고 '모름'(위기는 '없음')으로 둔다
export function cleanFacts(raw = {}) {
  const out = emptyFacts();
  for (const [k, f] of Object.entries(FIELDS)) {
    const v = typeof raw[k] === 'string' ? raw[k].trim() : '';
    if (f.values.includes(v)) out[k] = v;
  }
  return out;
}

const RULES = [
  { no: 1, when: (f) => f.receipt === '전혀 다른 물건이 옴', result: 'fraud', text: '전혀 다른 물건이 옴' },
  { no: 2, when: (f) => f.fakePost === '남의 사진이었음', result: 'fraud', text: '판매 글 사진이 남의 사진이었음' },
  { no: 3, when: (f) => f.fakePost === '다른 피해 글을 봄', result: 'fraud', text: '같은 판매자의 다른 피해 글을 봄' },
  { no: 4, when: (f) => f.receipt === '못 받음' && f.contact === '답 없음·차단', result: 'fraud', text: '물건을 못 받았고 판매자가 답이 없거나 차단함' },
  { no: 5, when: (f) => f.receipt === '못 받음' && f.contact === '판매 글·계정 사라짐', result: 'fraud', text: '물건을 못 받았고 판매 글·계정이 사라짐' },
  { no: 6, when: (f) => f.receipt === '쿠폰·번호가 이미 사용됨·없음', result: 'fraud', text: '받은 쿠폰·번호가 이미 사용됐거나 없음' },
  { no: 7, when: (f) => f.receipt === '설명과 상태가 다름' && f.contact === '연락됨', result: 'dispute', text: '물건이 설명과 다르고 판매자와 연락됨' },
  { no: 8, when: (f) => f.receipt === '배송 중 파손' && f.contact === '연락됨', result: 'dispute', text: '배송 중 파손됐고 판매자와 연락됨' },
];

// 순서: 위기(별도 상자) → 범위 밖 → 규칙 1~8 → 판단 어려움
export function classify(facts) {
  const f = cleanFacts(facts);
  const crisis = f.crisis === '있음';
  if (f.situation === '착오송금') return { crisis, result: 'out', variant: 'mistransfer', rule: null, ruleText: '계좌번호나 금액을 잘못 입력해 송금함(서비스 범위 밖)' };
  if (f.situation === '보이스피싱 등 다른 피해') return { crisis, result: 'out', variant: 'phishing', rule: null, ruleText: '보이스피싱 등 다른 피해(서비스 범위 밖)' };
  if (f.situation === '중고거래 피해') {
    const hit = RULES.find((r) => r.when(f));
    if (hit) return { crisis, result: hit.result, rule: hit.no, ruleText: hit.text };
  }
  return { crisis, result: 'unclear', rule: null, ruleText: '지금 알려 주신 내용만으로는 사기인지 분쟁인지 가리기 어려움' };
}

// 분류 전에 아직 모르는 항목(되물을 순서). 가짜 판매 글 정황은 되묻지 않는다
export function missingFields(facts) {
  const f = cleanFacts(facts);
  if (f.situation === '모름') return ['situation'];
  if (f.situation !== '중고거래 피해') return [];
  return ['payment', 'receipt', 'contact', 'product'].filter((k) => f[k] === '모름');
}
