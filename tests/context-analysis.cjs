// Run with: node tests/context-analysis.cjs
// Exercises production data helpers without a browser or external dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const names = ['ensureEntryIdentity', 'mergeBackupEntries', 'sortCountRows', 'countValues', 'getAppropriateCounts', 'getAlignmentCounts', 'getVisibleAppropriateRows', 'getVisibleAlignmentRows', 'getLevelCounts', 'normalizeTags', 'getContextCounts', 'getEntryPathLabel', 'getRecordedLevel', 'displayValue', 'formatDateTime', 'getLogRows', 'csvEscape', 'getEntryKey', 'getIntensityComparison', 'normalizeLoadedEntry', 'getBackupEntriesFromText'];
const context = vm.createContext({ Intl, crypto: require('node:crypto').webcrypto });
for (const name of names) {
  const source = html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`));
  assert(source, `Missing helper: ${name}`);
  vm.runInContext(source[0], context);
}
const entries = [
  { timestamp: '2026-10-02T10:00:00Z', inner: 'Fear', tags: ['Work', 'work', 'Family'], bucketLevel: 10, comment: 'Test, "quoted" note', physicalSensations: ['Previously recorded sensation'], extension: { keep: true } },
  { timestamp: '2026-10-02T11:00:00Z', inner: 'Happy', tags: ['WORK'], bucketLevel: 1 },
  { timestamp: '2026-10-01T10:00:00Z', inner: 'Sad' }
];
context.logEntries = entries;
const tags = context.getContextCounts(entries, 'tags');
assert.equal(tags.find(row => row.label.toLowerCase() === 'work').count, 2);
assert.equal(tags.find(row => row.label === 'Family').count, 1);
const buckets = context.getContextCounts(entries, 'bucketLevel');
assert.equal(JSON.stringify(buckets.map(row => row.label)), '["1","10"]');
assert.equal(buckets.reduce((sum, row) => sum + row.count, 0), 2);
const rows = context.getLogRows(entries);
assert(rows.every(row => row.length === 13));
assert(rows[0].includes('Tags') && rows[0].includes('Emotion bucket level'));
assert.equal(rows[1][11], '10');
assert.equal(rows[3][11], 'Not recorded');
assert.equal(context.csvEscape('Test, "quoted" note'), '"Test, ""quoted"" note"');
const restored = context.getBackupEntriesFromText(JSON.stringify({ entries, tags: ['Work', 'Custom tag'] }));
assert.equal(restored.validEntries.length, 3);
assert.equal(restored.skipped, 0);
assert.equal(restored.validEntries[0].extension.keep, true);
assert.equal(restored.validEntries[0].physicalSensations[0], 'Previously recorded sensation');
assert.equal(restored.validEntries[0].bucketLevel, 10);
assert(restored.tags.includes('Custom tag'));
assert.equal(context.getEntryKey(restored.validEntries[0]), context.getEntryKey(entries[0]));
assert.notEqual(context.getEntryKey(entries[0]), context.getEntryKey({ ...entries[0], bucketLevel: 9 }));
console.log('PASS: tag deduplication/counts, bucket boundaries/missing values, log export columns, CSV escaping, legacy and extended backup preservation, merge identity.');

const ordered = context.sortCountRows([{ label: 'Zulu', count: 2 }, { label: 'Low', count: 1 }, { label: 'Alpha', count: 2 }, { label: 'Highest', count: 8 }]);
assert.equal(JSON.stringify(ordered.map(row => row.label)), '["Highest","Alpha","Zulu","Low"]');
for (const rows of [context.getVisibleAppropriateRows(entries), context.getVisibleAlignmentRows(entries), tags]) {
  assert(rows.every((row, index) => !index || rows[index - 1].count >= row.count));
}
console.log('PASS: frequency sorting, alphabetical ties, reflection ordering, numeric bucket ordering.');

for (const name of ['getCheckedFilterValues', 'getDateKey', 'getFilteredLogEntries']) {
  vm.runInContext(html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`))[0], context);
}
const selected = values => ({ querySelectorAll: () => values.map(value => ({ value })) });
Object.assign(context, {
  logExpectedFilter: selected([]), logActualFilter: selected([]), logAlignmentFilter: selected([]),
  logInnerFilter: selected(['Anger', 'Fear']), logTagFilter: selected(['tag:family']),
  logBucketFilter: selected(['8', '9', '10']), logTagMatch: { value: 'any' },
  logSearch: { value: '' }, logLevelFilter: { value: '' }, logPathFilter: { value: '' },
  logDateFrom: { value: '2026-09-01' }, logDateTo: { value: '2026-09-30' },
  logEntries: [
    { timestamp: '2026-09-01T10:00:00Z', inner: 'Anger', tags: ['Family'], bucketLevel: 8 },
    { timestamp: '2026-09-15T10:00:00Z', inner: 'Fear', tags: ['Family', 'Work'], bucketLevel: 9 },
    { timestamp: '2026-09-30T23:59:00Z', inner: 'Fear', tags: ['Family'], bucketLevel: 10 },
    { timestamp: '2026-09-15T10:00:00Z', inner: 'Happy', tags: ['Family'], bucketLevel: 8 },
    { timestamp: '2026-10-01T00:00:00Z', inner: 'Fear', tags: ['Family'], bucketLevel: 10 },
    { timestamp: '2026-09-15T10:00:00Z', inner: 'Anger', tags: ['Work'], bucketLevel: 7 }
  ]
});
assert.equal(context.getFilteredLogEntries().length, 3);
context.logTagFilter = selected(['tag:family', 'tag:work']);
context.logTagMatch.value = 'all';
assert.equal(context.getFilteredLogEntries().length, 1);
context.logInnerFilter = selected([]); context.logTagFilter = selected([]); context.logBucketFilter = selected([]);
assert.equal(context.getFilteredLogEntries().length, 5);
console.log('PASS: Family + Anger/Fear + bucket 8/9/10 + inclusive date range, all-tag matching, empty selections.');

context.logEntries[0].expectedIntensity = 8; context.logEntries[0].actualIntensity = 9; context.logEntries[0].intensityAlignment = 'Aligned';
context.logExpectedFilter = selected(['8', '9']); context.logActualFilter = selected(['9', '10']); context.logAlignmentFilter = selected(['Aligned']);
assert.equal(context.getFilteredLogEntries().length, 1);
context.logAlignmentFilter = selected(['Not aligned']); assert.equal(context.getFilteredLogEntries().length, 0);
context.logExpectedFilter = selected(['__missing']); context.logActualFilter = selected([]); context.logAlignmentFilter = selected(['__missing']);
assert.equal(context.getFilteredLogEntries().length, 4);
console.log('PASS: expected/actual intensity combinations, alignment and missing values.');

(async () => {
  const storage = new Map(); let confirmation = true; let savedBackup;
  Object.assign(context, {
    storageKey: 'testLog', settingsKey: 'testSettings', schemaVersionKey: 'testSchema', dataSchemaVersion: 2, 
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value) },
    window: { confirm: () => confirmation }, captureSettings: { tags: ['Custom unused tag'] },
    loadBackupStatus: { textContent: '' }, liveStatus: { textContent: '' },
    promptBackupConflict: async () => 'both', renderAll: () => {}, getAvailableTags: () => context.captureSettings.tags,
    downloadText: (filename, text) => { savedBackup = JSON.parse(text); }
  });
  for (const name of ['dataSchemaMatches', 'loadLog', 'migrateLocalDataset', 'saveLog', 'saveSettings', 'saveBackupFile', 'loadBackupFile']) {
    vm.runInContext(html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`))[0], context);
  }
  const legacy = { timestamp: '2026-09-01T10:00:00Z', inner: 'Fear', comment: 'Keep me', tags: ['Family'], bucketLevel: 10, extension: { kept: true } };
  storage.set('testLog', JSON.stringify([legacy]));
  context.logEntries = context.loadLog();
  assert.equal(context.logEntries[0].id, undefined);
  assert.equal(storage.get('testLog'), JSON.stringify([legacy]));
  context.migrateLocalDataset(); const id = context.logEntries[0].id;
  assert.match(id, /^[0-9a-f-]{36}$/i);
  assert.equal(context.loadLog()[0].id, id);
  assert.equal(context.logEntries[0].createdAt, legacy.timestamp);
  assert.equal(context.logEntries[0].modifiedAt, legacy.timestamp);
  assert.equal(JSON.parse(JSON.parse(storage.get('testLogBeforeSchemaMigration')).rawEntries)[0].comment, 'Keep me');
  storage.set('testSchema', '1');
  assert.throws(() => context.saveLog(), /upgrade/);
  assert.throws(() => context.saveSettings(), /upgrade/);
  const lockedBefore = storage.get('testLog');
  await context.loadBackupFile({ name: 'blocked.json', text: async () => { throw new Error('Must not read while locked'); } }, 'replace');
  assert.equal(storage.get('testLog'), lockedBefore);
  storage.set('testSchema', '2');
  for (const version of [undefined, '1', '3', 'invalid']) {
    if (version === undefined) storage.delete('testSchema'); else storage.set('testSchema', version);
    assert.equal(context.dataSchemaMatches(), false);
    assert.throws(() => context.saveLog(), /upgrade/);
  }
  storage.set('testSchema', '2');
  assert.equal(context.dataSchemaMatches(), true);
  context.saveBackupFile(); assert.equal(savedBackup.version, 2); assert.equal(savedBackup.entries[0].id, id);
  const firstBackup = JSON.stringify(savedBackup);
  const file = text => ({ name: 'test.json', text: async () => text });
  await context.loadBackupFile(file(firstBackup), 'merge'); assert.equal(context.logEntries.length, 1);
  const second = context.ensureEntryIdentity({ ...legacy, timestamp: '2026-09-02T10:00:00Z' });
  await context.loadBackupFile(file(JSON.stringify({entries: [second, second]})), 'merge'); assert.equal(context.logEntries.length, 2);
  await context.loadBackupFile(file(JSON.stringify({entries:[legacy]})), 'merge'); assert.equal(context.logEntries.length, 2);
  const edited = { ...context.logEntries[0], comment: 'Edited elsewhere', modifiedAt:'2026-10-02T12:00:00Z' };
  await context.loadBackupFile(file(JSON.stringify({entries:[edited]})), 'merge'); assert.equal(context.logEntries.length, 3);
  assert(context.logEntries.some(entry=>entry.conflictOf === id && entry.comment === 'Edited elsewhere'));
  await context.loadBackupFile(file(JSON.stringify({entries:[edited]})), 'merge'); assert.equal(context.logEntries.length, 3);
  context.promptBackupConflict = async () => 'cancel';
  const beforeCancel = JSON.stringify(context.logEntries);
  await context.loadBackupFile(file(JSON.stringify({entries:[{...edited,comment:'Another edit'}]})), 'merge');
  assert.equal(JSON.stringify(context.logEntries), beforeCancel);
  context.promptBackupConflict = async () => 'local';
  await context.loadBackupFile(file(JSON.stringify({entries:[{...edited,comment:'Another edit'}]})), 'merge');
  assert.equal(context.logEntries[0].comment, 'Keep me');
  context.promptBackupConflict = async () => 'incoming';
  await context.loadBackupFile(file(JSON.stringify({entries:[{...edited,comment:'Chosen backup version'}]})), 'merge');
  assert.equal(context.logEntries[0].comment, 'Chosen backup version');
  assert.equal(context.logEntries[0].id, id);
  const before = JSON.stringify(context.logEntries);
  confirmation = false; await context.loadBackupFile(file(firstBackup), 'replace'); assert.equal(JSON.stringify(context.logEntries), before);
  confirmation = true; await context.loadBackupFile(file(firstBackup), 'replace'); assert.equal(context.logEntries.length, 1);
  assert.equal(context.logEntries[0].id, id); assert(context.logEntries[0].extension.kept);
  assert.equal(JSON.parse(storage.get('testLogBeforeReplacement')).entries.length, 3);
  await context.loadBackupFile(file('{broken'), 'replace'); assert.equal(context.logEntries.length, 1);
  await context.loadBackupFile(file(JSON.stringify({entries:[{inner:'invalid'}]})), 'replace'); assert.equal(context.logEntries.length, 1);
  context.saveBackupFile(); const roundTrip = JSON.stringify(savedBackup);
  await context.loadBackupFile(file(roundTrip), 'replace'); assert.equal(context.logEntries[0].id,id);
  await context.loadBackupFile(file(JSON.stringify({entries:[]})), 'replace'); assert.equal(context.logEntries.length,0);
  await context.loadBackupFile(file(roundTrip), 'replace'); assert.equal(context.logEntries.length,1);
  const stableBeforeFailure = JSON.stringify(context.logEntries);
  const storageBeforeFailure = storage.get('testLog');
  context.localStorage.setItem = () => { throw new Error('Storage full'); };
  await context.loadBackupFile(file(JSON.stringify({entries:[second]})), 'replace');
  assert.equal(JSON.stringify(context.logEntries), stableBeforeFailure);
  assert.equal(storage.get('testLog'), storageBeforeFailure);
  storage.set('testLog', JSON.stringify([legacy]));
  assert.equal(context.loadLog().length, 1);
  assert.throws(() => context.migrateLocalDataset(), /Storage full/);
  assert.equal(storage.get('testLog'), JSON.stringify([legacy]));
  assert.equal(JSON.parse(storage.get('testLog'))[0].comment, 'Keep me');
  console.log('PASS: full browser storage retains existing records during migration and failed replacement.');
  console.log('PASS: complete migration/save/load lifecycle; stable GUIDs and dates; repeated/legacy/in-file duplicate merges; preserved conflicts; cancelled/confirmed/empty replacements; recovery snapshot; malformed/invalid files; restored backup.');
})().catch(error=>{ console.error(error); process.exitCode = 1; });
