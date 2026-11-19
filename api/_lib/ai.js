// AI 호출: CLAUDE_API_KEY → GROQ_API_KEY → GEMINI_API_KEY 순서.
// 키 비어 있음 · 오류 · 시간 초과면 다음으로 넘어가고, 시도한 기록(tried)을 남긴다.
// 모델 이름은 코드에 박지 않고 각 키로 모델 목록을 조회해 고른다(404 면 모델 이름부터 의심).
import Anthropic from '@anthropic-ai/sdk';

const TIMEOUT_MS = 8000;
const modelCache = {};

class AiError extends Error {
  constructor(reason, detail) { super(reason); this.reason = reason; this.detail = detail; }
}

function reasonFromStatus(status) {
  if (status === 401 || status === 403) return '승인 안 됨(키 확인)';
  if (status === 404) return '모델 이름 의심(404)';
  if (status === 429) return '사용량 초과';
  return `오류 ${status}`;
}

async function fetchJson(url, opts = {}) {
  let r;
  try {
    r = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new AiError(e.name === 'TimeoutError' ? '시간 초과' : '연결 실패', e.message);
  }
  if (!r.ok) throw new AiError(reasonFromStatus(r.status), (await r.text()).slice(0, 200));
  return r.json();
}

// ---------- Claude (공식 SDK) ----------
async function callClaude(system, user) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new AiError('키 비어 있음');
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  try {
    if (!modelCache.claude) {
      const ids = [];
      for await (const m of client.models.list()) ids.push(m.id);
      modelCache.claude = ids.includes('claude-opus-5-5') ? 'claude-opus-5-5' : ids[0];
      if (!modelCache.claude) throw new AiError('모델 목록 비어 있음');
    }
    const msg = await client.beta.messages.create({
      model: modelCache.claude,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (msg.stop_reason === 'refusal') throw new AiError('답변 거절(refusal)');
    return { text: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), model: msg.model };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.NotFoundError) { delete modelCache.claude; throw new AiError('모델 이름 의심(404)'); }
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError('시간 초과');
    if (e instanceof Anthropic.APIError && e.status) throw new AiError(reasonFromStatus(e.status), e.message);
    throw new AiError('연결 실패', e.message);
  }
}

// ---------- Groq ----------
async function callGroq(system, user) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new AiError('키 비어 있음');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (!modelCache.groq) {
    const list = await fetchJson('https://api.groq.com/openai/v1/models', { headers });
    const ids = (list.data || []).map((m) => m.id).filter((id) => !/whisper|tts|guard/i.test(id));
    modelCache.groq = ids.find((id) => id.includes('llama-3.3-70b')) || ids.find((id) => id.includes('llama')) || ids[0];
    if (!modelCache.groq) throw new AiError('모델 목록 비어 있음');
  }
  try {
    const data = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers,
      body: JSON.stringify({
        model: modelCache.groq, temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    return { text: data.choices?.[0]?.message?.content || '', model: modelCache.groq };
  } catch (e) {
    if (e.reason?.includes('404')) delete modelCache.groq;
    throw e;
  }
}

// ---------- Gemini ----------
async function callGemini(system, user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError('키 비어 있음');
  const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  if (!modelCache.gemini) {
    const list = await fetchJson(`${base}/models?pageSize=200`, { headers });
    const ok = (list.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name);
    modelCache.gemini = ok.find((n) => /flash/.test(n) && !/lite|image|tts|live/.test(n)) || ok[0];
    if (!modelCache.gemini) throw new AiError('모델 목록 비어 있음');
  }
  try {
    const data = await fetchJson(`${base}/${modelCache.gemini}:generateContent`, {
      method: 'POST', headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    return { text: data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '', model: modelCache.gemini.replace('models/', '') };
  } catch (e) {
    if (e.reason?.includes('404')) delete modelCache.gemini;
    throw e;
  }
}

const PROVIDERS = [
  { name: 'Claude', env: 'CLAUDE_API_KEY', call: callClaude },
  { name: 'Groq', env: 'GROQ_API_KEY', call: callGroq },
  { name: 'Gemini', env: 'GEMINI_API_KEY', call: callGemini },
];

export function keyStatus() {
  return PROVIDERS.map((p) => ({ name: p.name, env: p.env, hasKey: Boolean(process.env[p.env]) }));
}

// 앞에서부터 차례로 시도. 성공하면 { text, provider, model, tried }, 모두 실패하면 { text:null, tried }
export async function askAi(system, user) {
  const tried = [];
  for (const p of PROVIDERS) {
    try {
      const r = await p.call(system, user);
      if (!r.text) throw new AiError('빈 응답');
      tried.push({ name: p.name, ok: true });
      return { ...r, provider: p.name, tried };
    } catch (e) {
      const reason = e.reason || '오류';
      if (reason.includes('404')) console.warn(`[ai] ${p.name} 404 — 모델 이름부터 확인하세요`);
      tried.push({ name: p.name, ok: false, reason });
    }
  }
  return { text: null, provider: null, tried };
}
