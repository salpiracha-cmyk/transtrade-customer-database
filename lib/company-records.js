// Company consolidation keeps original records recoverable and every contact route.
export function uniqueValues(values) {
  const seen = new Set();
  return values.map(v => String(v || '').trim()).filter(v => {
    const key = v.toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function photoReferences(customer) {
  return uniqueValues([customer.sourcePhoto, ...(Array.isArray(customer.sourcePhotos) ? customer.sourcePhotos : []), ...(customer.contactPeople || []).flatMap(p => [p.sourcePhoto, ...(p.sourcePhotos || [])])]);
}

export function consolidateFields(primary, customers) {
  const output = {};
  for (const field of ['email', 'mobile', 'phone']) {
    output[field] = uniqueValues([primary, ...customers].flatMap(c => String(c[field] || '').split(/[;,\n|]+/))).join('; ');
  }
  output.sourcePhotos = uniqueValues([primary, ...customers].flatMap(photoReferences));
  output.sourcePhoto = primary.sourcePhoto || output.sourcePhotos[0] || '';
  output.companyAliases = uniqueValues(customers.flatMap(c => [c.company, ...(c.companyAliases || [])]));
  const contactFields = ['person', 'role', 'email', 'mobile', 'phone', 'address', 'city', 'sourceId', 'sourcePhoto', 'sourceFile', 'sourceSheet'];
  const contacts = customers.flatMap(c => Array.isArray(c.contactPeople) && c.contactPeople.length ? c.contactPeople : [{ recordId: c.id, ...Object.fromEntries(contactFields.map(f => [f, c[f] || ''])) }]);
  output.contactPeople = [...new Map(contacts.map(c => [JSON.stringify(c), c])).values()];
  const variants = ['company', 'person', 'role', 'country', 'city', 'website', 'address', 'priority', 'sourceId', 'sourceFile', 'sourceSheet'];
  output.mergeDetails = uniqueValues(customers.flatMap(c => [
    ...(c.mergeDetails || []),
    ...variants.filter(f => c[f] && c[f] !== primary[f]).map(f => `${f}: ${c[f]} (record ${c.id})`)
  ]));
  return output;
}

export function companyIdentity(customer) {
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const company = normalize(customer.company);
  const country = normalize(customer.country);
  // Placeholder labels never establish business identity.
  if (!company || !country || company === country || /^(unknown|unresolved|n a)$/.test(country) || /^(unknown|unresolved|no company|n a|company|contact|customer|s r l|general trading l l c|general trading llc)$/.test(company) || /^(independent|handwritten)\b/.test(company)) return '';
  return `${country}|${company}`;
}

export function companyGroups(customers) {
  const buckets = new Map();
  for (const c of customers.filter(c => !c.archivedAt)) {
    const key = companyIdentity(c);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  return [...buckets.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({key, ids: rows.map(c => c.id), company: rows[0].company, country: rows[0].country, records: rows.length}));
}
