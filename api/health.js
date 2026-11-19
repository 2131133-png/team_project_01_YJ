// 어느 AI 키가 들어 있는지만 알려 준다(키 값은 절대 내보내지 않음)
import { keyStatus } from './_lib/ai.js';

export default function handler(req, res) {
  res.status(200).json({ ok: true, ai: keyStatus() });
}
