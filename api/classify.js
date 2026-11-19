import { classify } from './_lib/rules.js';
import { guideFor, CRISIS_GUIDE, CENTER } from './_lib/guides.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 만 받아요' });
  const c = classify(req.body?.facts || {});
  res.status(200).json({ ...c, guide: guideFor(c), crisisGuide: c.crisis ? CRISIS_GUIDE : null, center: CENTER });
}
