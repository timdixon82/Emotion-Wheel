// Run with: node tests/context-analysis.cjs
// Exercises production data helpers without a browser or external dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const names = ['ensureEntryIdentity', 'mergeBackupEntries', 'sortCountRows', 'countValues', 'getAppropriateCounts', 'getAlignmentCounts', 'getVisibleAppropriateRows', 'getVisibleAlignmentRows', 'getLevelCounts', 'normalizeTags', 'getContextCounts', 'getEntryPathLabel', 'getRecordedLevel', 'displayValue', 'formatDateTime', 'getLogRows', 'csvEscape', 'getEntryKey', 'getIntensityComparison', 'getRecordingAlignment', 'convertRatingEntries', 'getScaleConversionWarning', 'normalizeLoadedEntry', 'getBackupEntriesFromText'];
const context = vm.createContext({ Intl, crypto: require('node:crypto').webcrypto, ratingScale: 10, dataSchemaVersion: 3 });
for (const name of names) {
  const source = html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`));
  assert(source, `Missing helper: ${name}`);
  vm.runInContext(source[0], context);
}
for (let expected = 1; expected <= 10; expected++) {
  for (let actual = 1; actual <= 10; actual++) {
    assert.equal(context.getIntensityComparison(expected, actual), expected === actual ? 'Aligned' : 'Not aligned');
  }
}
assert.equal(context.getIntensityComparison(7, 8), 'Not aligned');
assert.equal(context.getIntensityComparison(Math.ceil(7 / 2), Math.ceil(8 / 2)), 'Aligned');
const savedAlignment = { timestamp: '2026-10-04T10:00:00Z', inner: 'Fear', expectedIntensity: 7, actualIntensity: 8, intensityAlignment: 'Aligned' };
assert.equal(context.getAlignmentCounts([savedAlignment]).find(row => row.label === 'Aligned').count, 1);
assert.equal(context.getLogRows([savedAlignment])[1][8], 'Aligned');
assert.equal(context.normalizeLoadedEntry(savedAlignment).intensityAlignment, 'Aligned');
assert.equal(context.normalizeLoadedEntry({ ...savedAlignment, intensityAlignment: undefined }).intensityAlignment, 'Not aligned');
assert.equal(savedAlignment.expectedIntensity, 7);
assert.equal(savedAlignment.actualIntensity, 8);
assert.equal(savedAlignment.intensityAlignment, 'Aligned');
assert.equal(context.getRecordingAlignment(7, 8, savedAlignment), 'Aligned');
assert.equal(context.getRecordingAlignment(7, 9, savedAlignment), 'Not aligned');
assert.equal(context.getRecordingAlignment(7, 7, savedAlignment), 'Aligned');
assert.equal(context.getRecordingAlignment(7, 8, null), 'Not aligned');
console.log('PASS: equality-only alignment for new ratings; saved alignment preserved in charts/exports/imports.');
const originals = Array.from({ length: 10 }, (_, index) => ({
  id: `record-${index}`, timestamp: '2026-10-04T10:00:00Z', inner: 'Fear',
  expectedIntensity: index + 1, actualIntensity: 10 - index, bucketLevel: index + 1,
  intensityAlignment: 'Saved old result', extension: { retained: true }
}));
const originalText = JSON.stringify(originals);
const reduced = context.convertRatingEntries(originals, 10, 5);
assert.equal(JSON.stringify(reduced.map(entry => entry.bucketLevel)), '[1,1,2,2,3,3,4,4,5,5]');
assert.equal(JSON.stringify(originals), originalText);
assert(reduced.every((entry, index) => entry.id === originals[index].id && entry.timestamp === originals[index].timestamp && entry.extension.retained));
const increased = context.convertRatingEntries(reduced, 5, 10);
assert.equal(JSON.stringify(increased.map(entry => entry.bucketLevel)), '[2,2,4,4,6,6,8,8,10,10]');
assert(increased.every(entry => entry.intensityAlignment === (entry.expectedIntensity === entry.actualIntensity ? 'Aligned' : 'Not aligned')));
const missingRatings = context.convertRatingEntries([{ inner: 'Happy' }, { expectedIntensity: null, actualIntensity: '', bucketLevel: null }], 10, 5);
assert.equal(missingRatings[0].expectedIntensity, undefined);
assert.equal(missingRatings[1].expectedIntensity, null);
assert.equal(missingRatings[1].actualIntensity, '');
assert.equal(missingRatings[1].bucketLevel, null);
for (const invalid of [0, 11, 1.5, 'invalid']) assert.throws(() => context.convertRatingEntries([{ expectedIntensity: invalid }], 10, 5), /Invalid/);
assert.throws(() => context.getBackupEntriesFromText(JSON.stringify({ ratingScale: 7, entries: [] })), /scale/);
assert.equal(context.getBackupEntriesFromText(JSON.stringify({ entries: [] })).ratingScale, 10);
assert.equal(context.getBackupEntriesFromText(JSON.stringify({ ratingScale: 5, entries: [{ ...savedAlignment, expectedIntensity: 6 }] })).skipped, 1);
console.log('PASS: every conversion boundary, both directions, recalculated equality, missing ratings, unknown field preservation and scale-aware backup validation.');

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
assert(rows[0].includes('Tags') && rows[0].includes('Emotion bucket level (1–10)'));
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
    storageKey: 'testLog', settingsKey: 'testSettings', schemaVersionKey: 'testSchema', dataSchemaVersion: 3, ratingScale: 10, adoptRatingScale: scale => { context.ratingScale = scale; },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value) },
    window: { confirm: () => confirmation }, captureSettings: { tags: ['Custom unused tag'] },
    loadBackupStatus: { textContent: '' }, liveStatus: { textContent: '' },
    promptBackupConflict: async () => 'both', renderAll: () => {}, getAvailableTags: () => context.captureSettings.tags,
    downloadText: (filename, text) => { savedBackup = JSON.parse(text); }
  });
  for (const name of ['parseLocalDataset', 'serializeDataset', 'loadRatingScale', 'commitRatingScaleChange', 'dataSchemaMatches', 'loadLog', 'migrateLocalDataset', 'saveLog', 'saveSettings', 'saveBackupFile', 'loadBackupFile']) {
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
  storage.set('testSchema', '3');
  for (const version of [undefined, '1', '2', '4', 'invalid']) {
    if (version === undefined) storage.delete('testSchema'); else storage.set('testSchema', version);
    assert.equal(context.dataSchemaMatches(), false);
    assert.throws(() => context.saveLog(), /upgrade/);
  }
  storage.set('testSchema', '3');
  assert.equal(context.dataSchemaMatches(), true);
  const savedBeforeBackup = JSON.stringify(context.logEntries);
  const savedRating = { ...context.logEntries[0], expectedIntensity: 7, actualIntensity: 8, intensityAlignment: 'Aligned' };
  context.logEntries = [savedRating];
  context.saveBackupFile();
  assert.equal(savedBackup.entries[0].intensityAlignment, 'Aligned');
  assert.equal(savedBackup.entries[0].expectedIntensity, 7);
  assert.equal(savedBackup.entries[0].actualIntensity, 8);
  assert.equal(JSON.stringify(context.logEntries), JSON.stringify([savedRating]));
  context.logEntries = JSON.parse(savedBeforeBackup);
  context.saveBackupFile(); assert.equal(savedBackup.version, 3); assert.equal(savedBackup.ratingScale, 10); assert.equal(savedBackup.entries[0].id, id);
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
  assert.equal(context.parseLocalDataset(null).ratingScale, 5);
  assert.equal(context.parseLocalDataset(JSON.stringify([{ expectedIntensity: 2 }])).ratingScale, 10);
  assert.equal(context.parseLocalDataset(JSON.stringify({ schemaVersion: 3, ratingScale: 5, entries: [] })).ratingScale, 5);
  const conversionSource = [{ ...context.logEntries[0], expectedIntensity: 7, actualIntensity: 8, bucketLevel: 9, intensityAlignment: 'Not aligned' }];
  context.logEntries = conversionSource;
  context.ratingScale = 10;
  context.saveLog();
  const beforeScaleChange = storage.get('testLog');
  const writeStorage = context.localStorage.setItem;
  context.localStorage.setItem = (key, value) => { if (key === 'testLog') throw new Error('Storage full'); writeStorage(key, value); };
  assert.throws(() => context.commitRatingScaleChange(5, beforeScaleChange), /Storage full/);
  assert.equal(storage.get('testLog'), beforeScaleChange);
  assert.equal(context.ratingScale, 10);
  assert.equal(context.logEntries[0].expectedIntensity, 7);
  context.localStorage.setItem = writeStorage;
  assert.throws(() => context.commitRatingScaleChange(5, 'outdated'), /changed/);
  const down = context.commitRatingScaleChange(5, beforeScaleChange);
  assert.equal(down[0].expectedIntensity, 4);
  assert.equal(down[0].actualIntensity, 4);
  assert.equal(down[0].bucketLevel, 5);
  assert.equal(down[0].intensityAlignment, 'Aligned');
  assert.equal(JSON.parse(storage.get('testLog')).ratingScale, 5);
  assert.equal(JSON.parse(storage.get('testLogBeforeRatingScaleChange')).rawEntries, beforeScaleChange);
  context.logEntries = down; context.ratingScale = 5;
  assert.equal(context.loadRatingScale(), 5);
  const up = context.commitRatingScaleChange(10, storage.get('testLog'));
  assert.equal(up[0].expectedIntensity, 8);
  assert.equal(up[0].actualIntensity, 8);
  assert.equal(up[0].intensityAlignment, 'Aligned');
  context.logEntries = up; context.ratingScale = 10;
  // Import conversion applies only to incoming records, with explicit consent.
  const existing = JSON.stringify(context.logEntries);
  confirmation = false;
  await context.loadBackupFile(file(JSON.stringify({ ratingScale: 5, entries: [{ ...second, expectedIntensity: 3, actualIntensity: 4, bucketLevel: 5 }] })), 'merge');
  assert.equal(JSON.stringify(context.logEntries), existing);
  confirmation = true;
  await context.loadBackupFile(file(JSON.stringify({ ratingScale: 5, entries: [{ ...second, expectedIntensity: 3, actualIntensity: 4, bucketLevel: 5 }] })), 'merge');
  const imported = context.logEntries.find(entry => entry.id === second.id);
  assert.equal(imported.expectedIntensity, 6); assert.equal(imported.actualIntensity, 8); assert.equal(imported.bucketLevel, 10);
  assert.equal(imported.intensityAlignment, 'Not aligned');
  assert.equal(JSON.stringify(context.logEntries[0]), JSON.stringify(JSON.parse(existing)[0]));
  const fiveBackup = JSON.stringify({ ratingScale: 5, entries: [{ ...second, expectedIntensity: 3, actualIntensity: 4, bucketLevel: 5, intensityAlignment: 'Aligned' }] });
  await context.loadBackupFile(file(fiveBackup), 'replace');
  assert.equal(context.ratingScale, 5);
  assert.equal(context.logEntries[0].intensityAlignment, 'Aligned');
  context.saveBackupFile(); assert.equal(savedBackup.ratingScale, 5);
  await context.loadBackupFile(file(JSON.stringify(savedBackup)), 'replace');
  assert.equal(context.ratingScale, 5);
  assert.equal(context.logEntries[0].expectedIntensity, 3);
  console.log('PASS: atomic scale commit, exact recovery snapshot, stale conversion blocked, storage failure preserves originals, metadata survives reopening/backups and consented cross-scale imports.');
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
