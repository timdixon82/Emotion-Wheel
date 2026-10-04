/* Three-way reconciliation for a user's own dataset. No network on load. */
(function (root) {
  'use strict';
  const canonical = value => JSON.stringify(sort(value));
  function sort(value) {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
    return value;
  }
  function conflict(message) { const error = new Error(message); error.code = 'sync-conflict'; throw error; }
  function choose(base, local, remote, name) {
    if (canonical(local) === canonical(remote)) return local;
    if (canonical(local) === canonical(base)) return remote;
    if (canonical(remote) === canonical(base)) return local;
    conflict(`Both devices changed ${name}. Sync paused; both copies are kept.`);
  }
  function index(entries) {
    const result = new Map();
    for (const entry of entries) {
      if (!entry.id || result.has(entry.id)) conflict('Sync requires unique record IDs. Save a backup and review the file first.');
      result.set(entry.id, entry);
    }
    return result;
  }
  function content(snapshot) {
    const { exportedAt, driveSync, ...data } = snapshot;
    return { ...data, entries: [...snapshot.entries].sort((a, b) => String(a.id).localeCompare(String(b.id))) };
  }
  function reconcile(base, local, remote) {
    const left = content(local), right = content(remote), ancestor = base && content(base);
    if (ancestor && (left.ratingScale !== ancestor.ratingScale || right.ratingScale !== ancestor.ratingScale) &&
        canonical(left) !== canonical(ancestor) && canonical(right) !== canonical(ancestor) && canonical(left) !== canonical(right)) {
      conflict('A rating scale changed alongside other edits. Sync paused for review.');
    }
    const b = index(ancestor?.entries || []), l = index(left.entries), r = index(right.entries);
    for (const source of [local, remote]) {
      if (source.driveSync && (source.driveSync.version !== 1 || !Array.isArray(source.driveSync.deletedIds) || source.driveSync.deletedIds.some(id => typeof id !== 'string' || !id))) conflict('The sync deletion markers need review.');
    }
    const deleted = new Set([...(base?.driveSync?.deletedIds || []), ...(local.driveSync?.deletedIds || []), ...(remote.driveSync?.deletedIds || [])]);
    const entries = [];
    for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
      const value = ancestor ? choose(b.get(id), l.get(id), r.get(id), `record ${id}`) :
        !l.has(id) ? r.get(id) : !r.has(id) ? l.get(id) : choose(undefined, l.get(id), r.get(id), `record ${id}`);
      if (deleted.has(id) && value && (!ancestor || canonical(value) !== canonical(b.get(id)))) conflict(`A deleted record ${id} was also edited. Sync paused.`);
      if (value && !deleted.has(id)) entries.push(value);
      else if (b.has(id)) deleted.add(id);
    }
    const merged = {};
    for (const key of new Set([...Object.keys(ancestor || {}), ...Object.keys(left), ...Object.keys(right)])) {
      if (key === 'entries' || key === 'tags') continue;
      merged[key] = !['version','schemaVersion','ratingScale','settings'].includes(key) && left[key] === undefined ? right[key] : choose(ancestor?.[key], left[key], right[key], key);
    }
    merged.entries = entries.sort((a,b) => String(a.id).localeCompare(String(b.id)));
    merged.tags = choose(ancestor?.tags, left.tags || [], right.tags || [], 'the tag list');
    merged.driveSync = { version: 1, deletedIds: [...deleted].sort() };
    return merged;
  }
  const exports = { reconcile, canonical, content };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.EmotionWheelSync = exports;
})(globalThis);
