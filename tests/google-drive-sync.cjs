'use strict';
const assert = require('node:assert/strict');
const { reconcile, getConflicts, canonical, content } = require('../assets/google-drive-sync.js');
const record = (id, note='original') => ({id, inner:'Happy', timestamp:'2026-10-04T10:00:00Z', comment:note, extra:{kept:true}});
const snapshot = entries => ({version:3,schemaVersion:2,ratingScale:5,settings:{captureMode:'phase1'},tags:['Work'],entries});
const base = snapshot([record('one'),record('two')]);
const restoredCopy={...snapshot([record('restored')]),driveSync:{version:1,deletedIds:['one','two'],restoreRevision:'restore-test'}};
assert.deepEqual(reconcile(base,base,restoredCopy),restoredCopy,'Unchanged older devices adopt a restored dataset');
const offlineEdits=structuredClone(base);offlineEdits.entries.push(record('offline'));
assert.throws(()=>reconcile(base,offlineEdits,restoredCopy),/backup was restored/);
assert.equal(getConflicts(base,offlineEdits,restoredCopy)[0].key,'dataset');
assert.deepEqual(reconcile(base,offlineEdits,restoredCopy,{choices:{dataset:'remote'}}).entries,restoredCopy.entries);
assert.equal(reconcile(base,offlineEdits,restoredCopy,{choices:{dataset:'remote'}}).driveSync.restoreRevision,'restore-test');
assert.equal(reconcile(restoredCopy,snapshot([record('restored')]),restoredCopy).driveSync.restoreRevision,'restore-test','Normal sync retains the restore marker');
const local = structuredClone(base), remote = structuredClone(base);
local.entries[0].comment='local edit'; remote.entries.push(record('three'));
const before=canonical([base,local,remote]);
const merged = reconcile(base,local,remote);
assert.equal(merged.entries.length,3); assert.equal(merged.entries[0].comment,'local edit');
assert.equal(canonical([base,local,remote]),before,'Inputs remain unchanged');
const removed=structuredClone(base); removed.entries.pop();
const deletion=reconcile(base,removed,base); assert.equal(deletion.entries.length,1); assert.deepEqual(deletion.driveSync.deletedIds,['two']);
assert.equal(reconcile(base,base,removed).entries.length,1);
const editDeleted=structuredClone(base); editDeleted.entries[1].comment='other device';
assert.throws(()=>reconcile(base,removed,editDeleted),/Both devices/);
const collision=structuredClone(base); collision.entries[0].comment='remote edit';
assert.throws(()=>reconcile(base,local,collision),/Both devices/);
const conflicts=getConflicts(base,local,collision);
assert.equal(conflicts.length,1);assert.equal(conflicts[0].key,'record one');
const choices={'record one':'remote'};
const withOtherLocal=structuredClone(local);withOtherLocal.entries.push(record('local-only'));
const withOtherRemote=structuredClone(collision);withOtherRemote.entries.push(record('remote-only'));
const resolved=reconcile(base,withOtherLocal,withOtherRemote,{choices});
assert.equal(resolved.entries.find(entry=>entry.id==='one').comment,'remote edit');
assert(resolved.entries.some(entry=>entry.id==='local-only'));assert(resolved.entries.some(entry=>entry.id==='remote-only'));
assert.equal(reconcile(base,removed,editDeleted,{choices:{'record two':'local'}}).entries.length,1);
assert.equal(reconcile(base,removed,editDeleted,{choices:{'record two':'remote'}}).entries.length,2);
const markedDeletion={...removed,driveSync:{version:1,deletedIds:['two']}};
assert(!reconcile(base,markedDeletion,editDeleted,{choices:{'record two':'remote'}}).driveSync.deletedIds.includes('two'));
const scale=structuredClone(base); scale.ratingScale=10;
assert.throws(()=>reconcile(base,local,scale),/rating scale/);
assert.equal(reconcile(base,base,scale).ratingScale,10);
const settings=structuredClone(base); settings.settings.captureMode='phase3';
const other=structuredClone(base); other.settings.captureMode='phase2';
assert.throws(()=>reconcile(base,settings,other),/settings/);
assert.equal(reconcile(null,snapshot([record('new')]),base).entries.length,3);
assert.throws(()=>reconcile(null,snapshot([record('two')]),deletion),/deleted/);
assert.throws(()=>reconcile(base,snapshot([record('one'),record('one')]),remote),/unique/);
assert.equal(canonical(content({...base,exportedAt:'today'})),canonical(content({...base,exportedAt:'yesterday'})));
console.log('PASS: two-way additions, edits, deletions, tombstones, first-device joins, scale/settings conflicts and unknown fields preserve both inputs.');
// Production local application: stale edits and storage failures cannot silently replace data.
const fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const applySource = html.match(/function applyDriveSyncSnapshot\([\s\S]*?\n}/)[0];
const store = new Map([['records',JSON.stringify(base)],['settings',JSON.stringify(base.settings)]]);
let failWrite = false;
const ctx = vm.createContext({
  editingEntry:null,pendingRatingScaleChange:null,ratingScale:5,logEntries:structuredClone(base.entries),captureSettings:structuredClone(base.settings),storageKey:'records',settingsKey:'settings',
  dataSchemaMatches:()=>true,
  getBackupSnapshot:()=>({ ...structuredClone(base),entries:structuredClone(ctx.logEntries),settings:structuredClone(ctx.captureSettings),ratingScale:ctx.ratingScale }),
  getBackupEntriesFromText:text=>{const value=JSON.parse(text); return {validEntries:value.entries,ratingScale:value.ratingScale,skipped:0};},
  normalizeSettings:value=>value,serializeDataset:(entries,ratingScale)=>JSON.stringify({entries,ratingScale}),
  adoptRatingScale:value=>{ctx.ratingScale=value;},renderAll(){},
  localStorage:{getItem:key=>store.get(key)??null,removeItem:key=>store.delete(key),setItem(key,value){ if(failWrite && key==='records'){failWrite=false;throw new Error('Synthetic quota failure');} store.set(key,value);}}
});
vm.runInContext(applySource,ctx);
ctx.editingEntry={id:'one'};
assert.throws(()=>ctx.applyDriveSyncSnapshot(remote,base),/Finish the current edit/); ctx.editingEntry=null;
ctx.logEntries[0].comment='unsynced edit';
assert.throws(()=>ctx.applyDriveSyncSnapshot(remote,base),/Local data changed/); ctx.logEntries=structuredClone(base.entries);
failWrite=true;
assert.throws(()=>ctx.applyDriveSyncSnapshot(remote,base),/quota/);
assert.deepEqual(JSON.parse(store.get('records')),base); assert.deepEqual(ctx.logEntries,base.entries);
assert.deepEqual(JSON.parse(store.get('recordsBeforeDriveSync')),base);
ctx.applyDriveSyncSnapshot(remote,base);
assert.equal(ctx.logEntries.length,3); assert.equal(ctx.logEntries[0].extra.kept,true);
console.log('PASS: real local-apply code rejects active/stale edits, retains a recovery snapshot, rolls back a failed write and applies validated remote changes.');

(async()=>{
  const {prepareSchemas}=require('../assets/google-drive-sync.js');
  const old=snapshot([record('one')]);old.schemaVersion=1;delete old.entries[0].id;
  const updated=structuredClone(old);updated.schemaVersion=3;updated.entries[0].id='known-upgraded-id';updated.entries[0].createdAt=updated.entries[0].timestamp;updated.entries[0].modifiedAt=updated.entries[0].timestamp;updated.entries[0].legacyIdentity=true;
  const oldBefore=canonical(old);
  const copies=await prepareSchemas(old,old,updated,3,require('node:crypto').webcrypto);
  assert.equal(copies.local.entries[0].id,'known-upgraded-id');
  assert.equal(reconcile(copies.base,copies.local,copies.remote).entries.length,1);
  assert.equal(canonical(old),oldBefore,'Schema preparation never mutates original records');
  assert.equal(copies.local.ratingScale,5,'Schema upgrades preserve the meaning of ratings');
  assert.equal(copies.local.entries[0].extra.kept,true);
  const generated=await prepareSchemas(null,old,old,3,require('node:crypto').webcrypto);
  assert.equal(generated.local.entries[0].id,generated.remote.entries[0].id);
  assert.match(generated.local.entries[0].id,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  await assert.rejects(()=>prepareSchemas(old,old,{...updated,schemaVersion:4},3),/newer or unsupported/);
  await assert.rejects(()=>prepareSchemas(null,{...old,entries:[old.entries[0],old.entries[0]]},updated,3),/duplicate identities/);
  const ambiguous=structuredClone(updated);ambiguous.entries.push({...updated.entries[0],id:'second-id'});
  await assert.rejects(()=>prepareSchemas(null,old,ambiguous,3),/ambiguous identities/);
  console.log('PASS: older schema copies match stable IDs across devices, preserve ratings and extension fields, avoid duplicate legacy records and reject future or ambiguous data.');
})().catch(error=>{console.error(error);process.exitCode=1;});
