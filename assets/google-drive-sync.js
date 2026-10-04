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
  function reconcile(base, local, remote, options = {}) {
    const collect = options.collect;
    function pick(baseValue,localValue,remoteValue,name) {
      try { return choose(baseValue,localValue,remoteValue,name); } catch(error) {
        const selection=options.choices?.[name];
        if(selection==='local')return localValue;
        if(selection==='remote')return remoteValue;
        if(collect) { if(!collect.some(item=>item.key===name))collect.push({key:name,local:localValue,remote:remoteValue,base:baseValue});return localValue; }
        throw error;
      }
    }
    const left = content(local), right = content(remote), ancestor = base && content(base);
    if (ancestor && (left.ratingScale !== ancestor.ratingScale || right.ratingScale !== ancestor.ratingScale) &&
        canonical(left) !== canonical(ancestor) && canonical(right) !== canonical(ancestor) && canonical(left) !== canonical(right)) {
      if(options.choices?.dataset)return resolveUsingCopy(local,remote,options.choices.dataset);
      if(collect){collect.push({key:'dataset',local,remote,base});return local;}
      conflict('A rating scale changed alongside other edits. Sync paused for review.');
    }
    const b = index(ancestor?.entries || []), l = index(left.entries), r = index(right.entries);
    for (const source of [local, remote]) {
      if (source.driveSync && (source.driveSync.version !== 1 || !Array.isArray(source.driveSync.deletedIds) || source.driveSync.deletedIds.some(id => typeof id !== 'string' || !id))) conflict('The sync deletion markers need review.');
    }
    const deleted = new Set([...(base?.driveSync?.deletedIds || []), ...(local.driveSync?.deletedIds || []), ...(remote.driveSync?.deletedIds || [])]);
    const entries = [];
    for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
      const value = ancestor ? pick(b.get(id), l.get(id), r.get(id), `record ${id}`) :
        !l.has(id) ? r.get(id) : !r.has(id) ? l.get(id) : pick(undefined, l.get(id), r.get(id), `record ${id}`);
      if (deleted.has(id) && value && (!ancestor || canonical(value) !== canonical(b.get(id)))) {
        const selection=options.choices?.[`record ${id}`];
        if(selection && (selection==='local'?local:remote).entries.some(entry=>entry.id===id) && !(selection==='local'?local:remote).driveSync?.deletedIds?.includes(id))deleted.delete(id);
        else if(collect){if(!collect.some(item=>item.key===`record ${id}`))collect.push({key:`record ${id}`,local:local.driveSync?.deletedIds?.includes(id)?undefined:l.get(id),remote:remote.driveSync?.deletedIds?.includes(id)?undefined:r.get(id),base:b.get(id)});}
        else if(!selection)conflict(`A deleted record ${id} was also edited. Sync paused.`);
      }
      if (value && !deleted.has(id)) entries.push(value);
      else if (b.has(id)) deleted.add(id);
    }
    const merged = {};
    for (const key of new Set([...Object.keys(ancestor || {}), ...Object.keys(left), ...Object.keys(right)])) {
      if (key === 'entries' || key === 'tags') continue;
      merged[key] = !['version','schemaVersion','ratingScale','settings'].includes(key) && left[key] === undefined ? right[key] : pick(ancestor?.[key], left[key], right[key], key);
    }
    merged.entries = entries.sort((a,b) => String(a.id).localeCompare(String(b.id)));
    merged.tags = pick(ancestor?.tags, left.tags || [], right.tags || [], 'the tag list');
    merged.driveSync = { version: 1, deletedIds: [...deleted].sort() };
    return merged;
  }
  function resolveUsingCopy(local, remote, side) {
    if (!['local','remote'].includes(side)) throw new Error('Choose a copy to resolve the conflict.');
    const chosen = JSON.parse(JSON.stringify(side === 'local' ? local : remote));
    const ids = new Set(chosen.entries.map(entry=>entry.id));
    const deleted = new Set([...(local.driveSync?.deletedIds || []), ...(remote.driveSync?.deletedIds || [])]);
    for (const entry of [...local.entries,...remote.entries]) if (!ids.has(entry.id)) deleted.add(entry.id);
    for (const id of ids) deleted.delete(id);
    chosen.driveSync={version:1,deletedIds:[...deleted].sort()};
    return chosen;
  }
  function getConflicts(base,local,remote){const collect=[];reconcile(base,local,remote,{collect});return collect;}
  // Upgrade supported historical copies in memory before comparing their content.
  // Stable IDs match records already upgraded on another device; no ratings are converted here.
  async function prepareSchemas(base,local,remote,targetSchema,cryptoApi=globalThis.crypto) {
    const copies=[base,local,remote].filter(Boolean);
    const identity=entry=>canonical([entry.timestamp,entry.inner,entry.middle||'',entry.outer||'']);
    const idsByIdentity=new Map();
    for(const copy of copies) {
      const version=copy.schemaVersion === undefined?1:copy.schemaVersion;
      if(!Number.isInteger(version) || version<1 || version>targetSchema)throw new Error('A copy requires a newer or unsupported app version. Update the app before syncing; both copies are kept.');
      for(const entry of copy.entries)if(entry.id){const key=identity(entry);const ids=idsByIdentity.get(key)||new Set();ids.add(entry.id);idsByIdentity.set(key,ids);}
    }
    async function upgrade(copy) {
      if(!copy)return null;
      const result=JSON.parse(JSON.stringify(copy));
      const seen=new Set();
      for(const entry of result.entries) {
        if(!entry.id) {
          if(!entry.timestamp || !entry.inner)throw new Error('An older record cannot be identified safely. Save a backup and review it before syncing.');
          const key=identity(entry),matches=idsByIdentity.get(key);
          if(matches?.size>1)throw new Error('Older records have ambiguous identities. Both copies are kept for review.');
          if(matches?.size===1)entry.id=[...matches][0];
          else {
            const digest=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(key));
            const hex=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
            entry.id=`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
          }
          entry.legacyIdentity=true;
        }
        if(seen.has(entry.id))throw new Error('Older records have duplicate identities. Both copies are kept for review.');
        seen.add(entry.id);
        entry.createdAt ||= entry.timestamp;entry.modifiedAt ||= entry.createdAt;
      }
      result.version=3;result.schemaVersion=targetSchema;
      result.ratingScale ??= 10;result.tags ??= [];
      delete result.recovery;
      return result;
    }
    return {base:await upgrade(base),local:await upgrade(local),remote:await upgrade(remote),upgraded:copies.some(copy=>(copy.schemaVersion??1)!==targetSchema || copy.entries.some(entry=>!entry.id))};
  }
  const exports = { reconcile, getConflicts, resolveUsingCopy, prepareSchemas, canonical, content };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.EmotionWheelSync = exports;
})(globalThis);
