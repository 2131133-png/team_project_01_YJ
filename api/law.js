// 관련 법령 조문 실시간 조회 — 국가법령정보 공동활용 Open API(open.law.go.kr)
// 환경변수 LAW_OC(Open API 신청 때 쓴 이메일 아이디)가 있어야 실시간으로 가져온다.
// 키가 없거나 조회에 실패하면 국가법령정보센터 원문 주소만 돌려준다(화면이 이 주소로 안내).
// 보안: guides.js 에 실린 법령·조문만 조회한다(아무 주소나 대신 불러 주지 않는다).
import { GUIDES } from './_lib/guides.js';

const TIMEOUT_MS = 8000;
const BASE = 'https://www.law.go.kr/DRF';
const cache = new Map(); // 같은 조문을 반복 조회하지 않게(서버가 살아 있는 동안)

const ALLOWED = new Map();
for (const g of Object.values(GUIDES)) {
  for (const l of g.laws || []) ALLOWED.set(`${l.name}|${l.jo.no}|${l.jo.branch || ''}`, l);
}

const joLabel = (jo) => `제${jo.no}조${jo.branch ? `의${jo.branch}` : ''}`;
export const lawUrl = (name, jo) => encodeURI(`https://www.law.go.kr/법령/${name}/${joLabel(jo)}`);

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`국가법령정보 응답 ${r.status}`);
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error('국가법령정보 응답 형식 오류(등록되지 않은 서버일 수 있어요)'); }
}

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

// 조문·항·호·목 안의 글을 순서대로 모은다
function collect(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { const t = node.trim(); if (t) out.push(t); return out; }
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out; }
  for (const k of ['조문내용', '항내용', '호내용', '목내용']) if (typeof node[k] === 'string') collect(node[k], out);
  for (const k of ['항', '호', '목']) if (node[k] != null) collect(node[k], out);
  return out;
}

async function fetchArticle(oc, law) {
  const q = encodeURIComponent(law.name);
  const found = await getJson(`${BASE}/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&query=${q}`);
  const list = asArray(found?.LawSearch?.law);
  const hit = list.find((x) => x['법령명한글'] === law.name && (!x['현행연혁코드'] || x['현행연혁코드'] === '현행')) || list.find((x) => x['법령명한글'] === law.name);
  if (!hit) throw new Error('법령을 찾지 못했어요');
  const mst = hit['법령일련번호'];
  const full = await getJson(`${BASE}/lawService.do?OC=${encodeURIComponent(oc)}&target=law&MST=${encodeURIComponent(mst)}&type=JSON`);
  const root = full?.['법령'];
  const units = asArray(root?.['조문']?.['조문단위']);
  const unit = units.find((u) => u['조문여부'] === '조문'
    && String(u['조문번호']) === String(law.jo.no)
    && String(u['조문가지번호'] || '') === String(law.jo.branch || ''));
  if (!unit) throw new Error('해당 조문을 찾지 못했어요');
  const info = root?.['기본정보'] || {};
  return {
    law: { name: law.name, dept: info['소관부처']?.['content'] || info['소관부처'] || hit['소관부처명'] || '', effective: info['시행일자'] || hit['시행일자'] || '' },
    article: { label: joLabel(law.jo), title: unit['조문제목'] || '', text: collect(unit).join('\n') },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 만 받아요' });
  const name = String(req.body?.name || '');
  const no = Number(req.body?.jo?.no);
  const branch = req.body?.jo?.branch ? Number(req.body.jo.branch) : '';
  const law = ALLOWED.get(`${name}|${no}|${branch}`);
  if (!law) return res.status(400).json({ error: '조회할 수 없는 법령이에요' });

  const url = lawUrl(law.name, law.jo);
  const oc = process.env.LAW_OC;
  if (!oc) return res.status(200).json({ mode: 'link', url, reason: '실시간 조회가 아직 연결되지 않았어요' });

  const key = `${law.name}|${law.jo.no}|${law.jo.branch || ''}`;
  try {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return res.status(200).json({ mode: 'live', url, ...hit.data });
    const data = await fetchArticle(oc, law);
    cache.set(key, { at: Date.now(), data });
    console.log(`[law] 성공 ${key}`);
    return res.status(200).json({ mode: 'live', url, ...data });
  } catch (e) {
    console.log(`[law] 실패 ${key} — ${e.message}`);
    return res.status(200).json({ mode: 'link', url, reason: '지금은 국가법령정보센터에서 바로 가져오지 못했어요' });
  }
}
