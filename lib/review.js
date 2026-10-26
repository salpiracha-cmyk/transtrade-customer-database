import crypto from 'node:crypto';

export const isReview = c => c.reviewStatus === 'pending';
export const reviewFields = ['company','person','role','country','city','phone','mobile','email','website','address','notes','sourceType','sourceId','sourcePhoto'];
export const reviewKey = c => JSON.stringify(reviewFields.map(k => String(c[k] ?? '').trim()));
export const reviewFingerprint = customers => crypto.createHash('sha256').update(JSON.stringify(customers)).digest('hex');

// Match the full exported contact projection, never a name alone. Preserve every live field.
export function previewReviewPlan(customers, plan, excluded = () => false) {
  if (plan?.schema !== 'tti-review-plan-v1' || !Array.isArray(plan.entries) || plan.entries.length > 20000) throw new Error('Invalid Review plan');
  const index = new Map();
  for (const c of customers.filter(c => !c.archivedAt)) {
    const key = reviewKey(c);
    index.set(key, [...(index.get(key) || []), c]);
  }
  const used = new Set();
  const decisions = plan.entries.map(entry => {
    if (!entry.expected || !reviewFields.every(k => typeof entry.expected[k] === 'string') || typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error('Invalid Review entry');
    const matches = index.get(reviewKey(entry.expected)) || [];
    let status = matches.length === 0 ? 'changed-or-absent' : matches.length > 1 ? 'ambiguous' : 'ready';
    const c = matches.length === 1 ? matches[0] : null;
    if (c && isReview(c)) status = 'already-in-review';
    else if (c && c.reviewStatus === 'resolved') status = 'previously-resolved';
    else if (c && excluded(c)) status = 'outside-buyer-list';
    else if (c && used.has(c.id)) status = 'duplicate-plan-entry';
    if (c) used.add(c.id);
    return {row:entry.row, id:c?.id, company:entry.expected.company, reason:entry.reason, status};
  });
  return {fingerprint:reviewFingerprint(customers), ready:decisions.filter(d=>d.status==='ready').length, decisions};
}
