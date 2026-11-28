// Round trip: load each schema 5 fixture through the app's real code, save it again, and check nothing stored is lost, renamed or changed.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { reconcile, prepareSchemas, getConflicts } = require('../assets/google-drive-sync.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const readFixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
// Sorted-key JSON so key order never hides or causes a difference.
const canon = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
const withoutExportedAt = value => { const copy = clone(value); delete copy.exportedAt; return copy; };

// Read the real code out of index.html, as tests/google-drive-sync.cjs does.
const constant = (name, src = html) => (src.match(new RegExp(`^const ${name} = [\\s\\S]*?;$`, 'm')) || assert.fail(`const ${name} not found in index.html`))[0];
const func = (name, src = html) => (src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n}`, 'm')) || assert.fail(`function ${name} not found in index.html`))[0];
const constantNames = ['storageKey', 'dataSchemaVersion', 'schemaVersionKey', 'settingsKey', 'defaultTags', 'valueFrameworks', 'valueCatalog', 'defaultSettings'];
const functionNames = ['parseLocalDataset', 'serializeDataset', 'dataSchemaMatches', 'normalizeSettings', 'normalizeTags', 'normalizeValues', 'valueKey',
  'isPhaseOneSettings', 'isPhaseTwoSettings', 'getAvailableTags', 'getIntensityComparison', 'getRecordedLevel', 'getSelectionLevel',
  'ensureEntryIdentity', 'migrateLocalDataset', 'applyRecordingRatings', 'applyOptionalAnswers', 'getRecordingAlignment', 'saveLog', 'loadRatingScale', 'normalizeLoadedEntry', 'getBackupEntriesFromText', 'getBackupSnapshot', 'applyDriveSyncSnapshot', 'loadSettings', 'saveSettings', 'getShowDescriptions', 'setShowDescriptions'];
const glue = `
let ratingScale = 5, captureSettings = {}, logEntries = [], editingEntry = null, detailEntry = null, pendingRatingScaleChange = null;
let selectedInner = null, selectedMiddle = null, selectedOuter = null;
function adoptRatingScale(value) { ratingScale = value; }
function renderAll() {}
function __set(settings, entries, scale) { captureSettings = settings; logEntries = entries; ratingScale = scale; }
function __get() { return { captureSettings, logEntries, ratingScale }; }
function __select(inner, middle, outer) { selectedInner = inner; selectedMiddle = middle; selectedOuter = outer; }
`;

function makeApp(src = html) {
  const constants = constantNames.map(name => constant(name, src)), functions = functionNames.map(name => func(name, src));
  const store = new Map();
  const ctx = vm.createContext({
    crypto: require('node:crypto').webcrypto, Date, JSON,
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) }
  });
  vm.runInContext([...constants, ...functions, glue].join('\n'), ctx);
  return { ctx, store, keys: { log: vm.runInContext('storageKey', ctx), schema: vm.runInContext('schemaVersionKey', ctx), settings: vm.runInContext('settingsKey', ctx) } };
}

// One known, existing behaviour: loading a backup or Drive record turns a null middle or outer emotion into an empty string.
// The local log is not normalised on load, so it keeps null. Pinned here so any other change fails.
const asNormalised = entry => ({ ...clone(entry), ...(entry.middle === null ? { middle: '' } : {}), ...(entry.outer === null ? { outer: '' } : {}) });

const localFixture = JSON.parse(readFixture('local-log-schema5.json'));
const backupFixture = JSON.parse(readFixture('backup-schema5.json'));
const driveFixture = JSON.parse(readFixture('drive-file-schema5.json'));
const expectedLoaded = backupFixture.entries.map(asNormalised);

// Fixture sanity: the same fake records in all three files, and the fixtures cover required and optional fields.
assert.equal(canon(localFixture.entries), canon(backupFixture.entries));
assert.equal(canon(driveFixture.entries), canon(backupFixture.entries));
const covered = new Set(backupFixture.entries.flatMap(entry => Object.keys(entry)));
['tags', 'values', 'physicalSensations', 'sensationGuide', 'bucketLevel', 'appropriate', 'expectedIntensity', 'actualIntensity', 'intensityAlignment', 'comment'].forEach(field => assert(covered.has(field), `fixtures cover ${field}`));
assert(backupFixture.entries.some(entry => !('comment' in entry) && !('tags' in entry) && !('bucketLevel' in entry)), 'fixtures include a record lacking optional fields');

// 1. Local log: load with the real parser, save with the real serialiser. Byte identical.
{
  const raw = readFixture('local-log-schema5.json');
  const { ctx } = makeApp();
  const dataset = ctx.parseLocalDataset(raw);
  assert.equal(ctx.serializeDataset(dataset.entries, dataset.ratingScale), JSON.stringify(JSON.parse(raw)), 'local log re-saves exactly');
  console.log('PASS: local log fixture loads and re-saves with no change.');
}

// 2. Backup file: real backup reader, then the real backup writer.
function backupRoundTrip(fixture) {
  const app = makeApp();
  const parsed = app.ctx.getBackupEntriesFromText(JSON.stringify(fixture));
  assert.equal(parsed.skipped, 0, 'no record skipped');
  assert.equal(canon(parsed.validEntries), canon(fixture.entries.map(asNormalised)), 'loaded records differ only by the pinned null-to-empty rule');
  app.ctx.__set(app.ctx.normalizeSettings(clone(fixture.settings)), parsed.validEntries, parsed.ratingScale);
  const saved = JSON.parse(JSON.stringify(app.ctx.getBackupSnapshot()));
  const expected = withoutExportedAt(fixture);
  expected.entries = fixture.entries.map(asNormalised);
  assert.equal(canon(withoutExportedAt(saved)), canon(expected), 'backup re-saves with no stored field lost, renamed or changed');
  // A second load and save changes nothing at all.
  const again = makeApp();
  const reparsed = again.ctx.getBackupEntriesFromText(JSON.stringify(saved));
  again.ctx.__set(again.ctx.normalizeSettings(clone(saved.settings)), reparsed.validEntries, reparsed.ratingScale);
  assert.equal(canon(withoutExportedAt(JSON.parse(JSON.stringify(again.ctx.getBackupSnapshot())))), canon(withoutExportedAt(saved)), 'second round trip is stable');
  return saved;
}
backupRoundTrip(backupFixture);
console.log('PASS: backup fixture loads and re-saves with no stored field lost, renamed or changed.');

// Settings: absent means off, and a stored showDescriptions flag (planned later) is carried through untouched.
{
  const { ctx } = makeApp();
  assert(!('showDescriptions' in ctx.normalizeSettings({})), 'empty settings gain no showDescriptions key');
  assert(!('showDescriptions' in ctx.normalizeSettings(clone(backupFixture.settings))), 'fixture settings gain no showDescriptions key');
  const flagged = clone(backupFixture); flagged.settings.showDescriptions = true;
  assert.equal(backupRoundTrip(flagged).settings.showDescriptions, true, 'showDescriptions true survives a backup round trip');
  console.log('PASS: settings gain no extra key, and an optional showDescriptions flag survives.');
}

// Saved settings: real load and save code.
{
  const app = makeApp();
  app.store.set(app.keys.settings, JSON.stringify(backupFixture.settings));
  const loaded = app.ctx.loadSettings();
  assert.equal(canon(loaded), canon(backupFixture.settings), 'settings load unchanged');
  app.ctx.__set(loaded, [], 5);
  app.store.set(app.keys.schema, '5'); app.store.set(app.keys.log, readFixture('local-log-schema5.json'));
  app.ctx.saveSettings();
  assert.equal(canon(JSON.parse(app.store.get(app.keys.settings))), canon(backupFixture.settings), 'settings save unchanged');
  console.log('PASS: capture settings load and save with no change.');
}

// 3a. Legacy shapes. Each loads, is normalised, and re-saves with no stored field lost and the current schema number written.
const legacyArray = JSON.parse(readFixture('local-log-legacy-array.json'));
const legacySchema4 = JSON.parse(readFixture('backup-schema4.json'));
const legacyBare = JSON.parse(readFixture('backup-no-scale-no-schema.json'));
const addedByLoad = ['id', 'createdAt', 'modifiedAt', 'legacyIdentity'];
// Every stored field of the original must be present afterwards with the same value. Backup load turns null middle or outer into an empty string; the local migration keeps null.
function assertNothingLost(originals, saved, label, nullBecomesEmpty = true) {
  assert.equal(saved.length, originals.length, `${label}: record count`);
  originals.forEach((original, index) => {
    const after = saved[index];
    for (const [key, value] of Object.entries(original)) assert.equal(canon(after[key]), canon(nullBecomesEmpty && (key === 'middle' || key === 'outer') && value === null ? '' : value), `${label}: record ${index} field ${key} kept`);
    for (const key of Object.keys(after)) assert(key in original || addedByLoad.includes(key), `${label}: record ${index} gained unexpected field ${key}`);
  });
}
{
  // Bare array local log: scale 10 assumed, real migration writes the current schema.
  const app = makeApp();
  app.store.set(app.keys.log, JSON.stringify(legacyArray));
  assert.equal(app.ctx.parseLocalDataset(JSON.stringify(legacyArray)).ratingScale, 10, 'a non-empty bare array is scale 10');
  assert.equal(app.ctx.parseLocalDataset('[]').ratingScale, 5, 'an empty bare array is scale 5');
  app.ctx.migrateLocalDataset();
  const stored = JSON.parse(app.store.get(app.keys.log));
  assert.equal(stored.schemaVersion, 5); assert.equal(stored.ratingScale, 10);
  assert.equal(app.store.get(app.keys.schema), '5');
  assertNothingLost(legacyArray, stored.entries, 'bare array local log', false);
  assert(stored.entries.every(entry => entry.legacyIdentity === true && /^[0-9a-f-]{36}$/.test(entry.id)), 'records without an id gain an id and the legacy flag');
  assert.equal(JSON.parse(app.store.get(`${app.keys.log}BeforeSchemaMigration`)).rawEntries, JSON.stringify(legacyArray), 'the original is kept byte for byte before migration');
  // A bare array is NOT a valid backup file (backups need an entries array).
  assert.throws(() => makeApp().ctx.getBackupEntriesFromText(JSON.stringify(legacyArray)), /entries array/, 'a bare array is rejected as a backup');
  console.log('PASS: bare array local log migrates as scale 10 with no field lost; a bare array is rejected as a backup.');
}
for (const [label, fixture] of [['schema 4 backup', legacySchema4], ['backup without ratingScale or schemaVersion', legacyBare]]) {
  const app = makeApp();
  const parsed = app.ctx.getBackupEntriesFromText(JSON.stringify(fixture));
  assert.equal(parsed.skipped, 0); assert.equal(parsed.ratingScale, 10, `${label}: scale 10`);
  app.ctx.__set(app.ctx.normalizeSettings({}), parsed.validEntries, parsed.ratingScale);
  const saved = JSON.parse(JSON.stringify(app.ctx.getBackupSnapshot()));
  assert.equal(saved.schemaVersion, 5, `${label}: current schema written`); assert.equal(saved.ratingScale, 10);
  assertNothingLost(fixture.entries, saved.entries, label);
  assert(saved.entries.every(entry => !entry.legacyIdentity), `${label}: records with ids are not flagged legacy`);
  assert.equal(canon(parsed.tags), canon(fixture.tags));
  // Saved to the local log by the real serialiser, then parsed again: still scale 10, schema 5, stable.
  const raw = app.ctx.serializeDataset(saved.entries, saved.ratingScale), reread = app.ctx.parseLocalDataset(raw);
  assert.equal(reread.schemaVersion, 5); assert.equal(reread.ratingScale, 10); assert.equal(canon(reread.entries), canon(saved.entries));
  console.log(`PASS: ${label} loads, normalises and re-saves with no field lost, schema 5 written.`);
}
// Backup schema 6 or later is refused; one missing schemaVersion is accepted (current behaviour).
assert.throws(() => makeApp().ctx.getBackupEntriesFromText(JSON.stringify({ ...legacySchema4, schemaVersion: 6 })), /newer version/);
// An unsupported scale is refused.
assert.throws(() => makeApp().ctx.getBackupEntriesFromText(JSON.stringify({ ...legacySchema4, ratingScale: 7 })), /rating scale/);
// A scale 10 rating in a scale 5 backup is skipped, not silently kept.
assert.equal(makeApp().ctx.getBackupEntriesFromText(JSON.stringify({ ...legacySchema4, ratingScale: 5 })).skipped, 2, 'ratings above the scale are skipped');
console.log('PASS: newer schema and unsupported or mismatched scale are refused or skipped.');

// 3d. Save path: the real Record button handler, run with stubbed form controls. A new entry stores every field the
// form collects; editing a legacy record keeps every stored field, including ones the form does not know about.
{
  const handler = (html.match(/recordButton\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/) || assert.fail('Record button handler not found'))[1];
  const SENSATIONS = ['Hot', 'Eyes wide'], TAGS = ['Work'], VALUES = [{ name: 'Honesty', theme: 'Connection', framework: 'personalvalues', frameworkLabel: 'Personal values' }];
  function recordWith(existing, { inner, middle, outer, scale = 5, editing = null }) {
    const app = makeApp();
    app.store.set(app.keys.schema, '5');
    app.store.set(app.keys.log, JSON.stringify({ schemaVersion: 5, ratingScale: scale, entries: existing }));
    vm.runInContext(`
      var getReviewDataset = () => null, getLoggingStreak = () => ({ loggedToday: false });
      var document = { querySelector: () => ({ value: 'Yes' }), getElementById: () => ({ hidden: false, textContent: '' }) };
      var expectedIntensity = { value: '3' }, actualIntensity = { value: '4' }, bucketLevel = { value: '2' }, entryComment = { value: ' A fake note ' };
      var getSelectedSensations = () => ${JSON.stringify(SENSATIONS)}, getActiveSensationType = () => 'Anxiety';
      var getSelectedTags = () => ${JSON.stringify(TAGS)}, getSelectedValues = () => ${JSON.stringify(VALUES)};
      var liveStatus = {}, recordConfirmation = { focus() {} }, recordConfirmationHeading = {}, recordConfirmationText = {}, undoRecordButton = {}, lastRecordedEntry = null;
      var clearEntryForm = () => {}, getEntryPathLabel = () => '', showDailyLogCongratulations = () => {};
      var recordButton = { focus() {} }, detailStatus = {}, loadEntryAnswers = () => {};
      captureSettings = { collectAppropriate: true, collectExpectedIntensity: true, collectActualIntensity: true, collectSensations: true, collectTags: true, collectValues: true, collectBucketLevel: true };
      logEntries = ${JSON.stringify(existing)}; ratingScale = ${scale};
      function __record() {${handler}}
    `, app.ctx);
    app.ctx.__select(inner, middle, outer);
    if (editing !== null) vm.runInContext(`editingEntry = logEntries[${editing}]`, app.ctx);
    app.ctx.__record();
    return { stored: JSON.parse(app.store.get(app.keys.log)), app };
  }
  // New entry: every collected field is stored under its expected name.
  const created = recordWith([], { inner: 'Fear', middle: 'Anxious', outer: 'Worried' }).stored;
  assert.equal(created.schemaVersion, 5); assert.equal(created.entries.length, 1);
  const fresh = created.entries[0];
  assert.deepEqual(Object.keys(fresh).sort(), ['actualIntensity', 'appropriate', 'bucketLevel', 'comment', 'createdAt', 'expectedIntensity', 'id', 'inner', 'intensityAlignment', 'level', 'middle', 'modifiedAt', 'outer', 'physicalSensations', 'sensationGuide', 'tags', 'timestamp', 'values'], 'a new record stores exactly these fields');
  assert.equal(fresh.level, 'Outer circle'); assert.equal(fresh.comment, 'A fake note'); assert.equal(fresh.bucketLevel, 2); assert.equal(fresh.appropriate, 'Yes');
  assert.equal(canon(fresh.physicalSensations), canon(SENSATIONS)); assert.equal(canon(fresh.tags), canon(TAGS)); assert.equal(canon(fresh.values), canon(VALUES)); assert.equal(fresh.sensationGuide, 'Anxiety');
  assert.equal(fresh.expectedIntensity, 3); assert.equal(fresh.actualIntensity, 4); assert.equal(fresh.intensityAlignment, 'Not aligned');
  // Inner only: middle and outer are stored as null, the app's own convention.
  const inner = recordWith([], { inner: 'Sad', middle: null, outer: null }).stored.entries[0];
  assert.equal(inner.level, 'Inner circle'); assert.equal(inner.middle, null); assert.equal(inner.outer, null);
  // Editing a legacy record (scale 10, extra unknown field) keeps its id, timestamp and unknown fields.
  const legacy = { id: '00000000-0000-4000-8000-000000000777', timestamp: '2024-03-01T09:00:00.000Z', createdAt: '2024-03-01T09:00:00.000Z', modifiedAt: '2024-03-01T09:00:00.000Z', level: 'Inner circle', inner: 'Sad', middle: null, outer: null, legacyExtra: 'kept', expectedIntensity: 7, actualIntensity: 9 };
  const edited = recordWith([legacy], { inner: 'Sad', middle: 'Guilty', outer: null, scale: 10, editing: 0 }).stored;
  assert.equal(edited.ratingScale, 10); assert.equal(edited.entries.length, 1);
  const after = edited.entries[0];
  assert.equal(after.id, legacy.id); assert.equal(after.createdAt, legacy.createdAt); assert.equal(after.timestamp, legacy.timestamp); assert.equal(after.legacyExtra, 'kept');
  assert.equal(after.level, 'Middle circle'); assert.equal(after.middle, 'Guilty');
  console.log('PASS: the Record handler stores every collected field and keeps unknown fields when editing a legacy record.');
}

// 3e. Normalising tidies stored values: text numbers become numbers, non-text sensations are dropped, alignment is derived.
{
  const { ctx } = makeApp();
  const loaded = ctx.normalizeLoadedEntry({ id: '00000000-0000-4000-8000-000000000555', timestamp: '2024-03-01T09:00:00.000Z', inner: 'Sad', expectedIntensity: '4', actualIntensity: '4', bucketLevel: '3', physicalSensations: ['Hot', 5], tags: ['Work', 'Work'] }, 10);
  assert.equal(loaded.bucketLevel, 3); assert.equal(loaded.expectedIntensity, 4); assert.equal(loaded.intensityAlignment, 'Aligned');
  assert.equal(canon(loaded.physicalSensations), canon(['Hot'])); assert.equal(canon(loaded.tags), canon(['Work']));
  assert.equal(loaded.level, 'Inner circle');
  console.log('PASS: normalising converts and filters stored values as expected.');
}

// 3. Drive file: schema check, three-way merge with itself, and the real local apply step.
(async () => {
  const prepared = await prepareSchemas(driveFixture, driveFixture, driveFixture, 5);
  assert.equal(prepared.upgraded, false, 'a schema 5 Drive file needs no upgrade');
  for (const copy of [prepared.base, prepared.local, prepared.remote]) assert.equal(canon(copy), canon(driveFixture), 'prepareSchemas changes nothing');
  const merged = reconcile(prepared.base, prepared.local, prepared.remote);
  assert.equal(canon(withoutExportedAt(merged)), canon(withoutExportedAt(driveFixture)), 'reconcile with itself changes nothing');

  const app = makeApp();
  app.store.set(app.keys.schema, '5'); app.store.set(app.keys.log, readFixture('local-log-schema5.json'));
  const parsed = app.ctx.getBackupEntriesFromText(JSON.stringify(driveFixture));
  app.ctx.__set(app.ctx.normalizeSettings(clone(driveFixture.settings)), parsed.validEntries, parsed.ratingScale);
  const expectedLocal = JSON.parse(JSON.stringify(app.ctx.getBackupSnapshot()));
  app.ctx.applyDriveSyncSnapshot(merged, expectedLocal);
  const storedLog = JSON.parse(app.store.get(app.keys.log));
  assert.equal(storedLog.schemaVersion, 5); assert.equal(storedLog.ratingScale, 5);
  assert.equal(canon(storedLog.entries), canon(driveFixture.entries.map(asNormalised)), 'Drive apply stores every field');
  assert.equal(canon(JSON.parse(app.store.get(app.keys.settings))), canon(driveFixture.settings), 'Drive apply stores settings unchanged');
  console.log('PASS: Drive fixture survives schema check, self merge and local apply with no change.');

  // 3b. Two different versions merged: one side edits, the other side edits, and both edit.
  {
    const withEdit = (data, index, change) => { const copy = clone(data); copy.entries[index] = { ...copy.entries[index], ...change, modifiedAt: '2026-02-01T00:00:00.000Z' }; return copy; };
    const find = (data, n) => data.entries.find(entry => entry.id.endsWith(String(n)));
    const base = driveFixture;
    const local = withEdit(base, 0, { comment: 'Edited here only' });       // record 1: local only
    const remote = withEdit(base, 1, { comment: 'Edited there only' });     // record 2: remote only
    const merged = reconcile(base, local, remote);
    assert.equal(find(merged, 1).comment, 'Edited here only', 'local-only edit kept');
    assert.equal(find(merged, 2).comment, 'Edited there only', 'remote-only edit kept');
    assert.equal(canon(find(merged, 3)), canon(find(base, 3)), 'untouched record unchanged');
    assert.equal(canon(find(merged, 4)), canon(find(base, 4)), 'untouched record unchanged');
    assert.equal(merged.entries.length, base.entries.length);
    // Both sides edit the same record the same way: no conflict. Differently: conflict, and getConflicts names it.
    const same = reconcile(base, withEdit(base, 2, { comment: 'Same' }), withEdit(base, 2, { comment: 'Same' }));
    assert.equal(find(same, 3).comment, 'Same');
    const bothLocal = withEdit(local, 2, { comment: 'Mine' }), bothRemote = withEdit(remote, 2, { comment: 'Theirs' });
    assert.throws(() => reconcile(base, bothLocal, bothRemote), error => error.code === 'sync-conflict' && /record 00000000-0000-4000-8000-000000000003/.test(error.message));
    assert.deepEqual(getConflicts(base, bothLocal, bothRemote).map(item => item.key), ['record 00000000-0000-4000-8000-000000000003']);
    assert.equal(find(reconcile(base, bothLocal, bothRemote, { choices: { 'record 00000000-0000-4000-8000-000000000003': 'remote' } }), 3).comment, 'Theirs');
    // A record added on one side and one deleted on the other.
    const added = clone(base); added.entries.push({ ...clone(base.entries[2]), id: '00000000-0000-4000-8000-000000000009', comment: 'New' });
    const removed = clone(base); removed.entries = removed.entries.filter(entry => !entry.id.endsWith('4')); removed.driveSync = { version: 1, deletedIds: ['00000000-0000-4000-8000-000000000004'] };
    const addDel = reconcile(base, added, removed);
    assert(find(addDel, 9) && !find(addDel, 4), 'an add on one side and a delete on the other both apply');
    console.log('PASS: Drive merge of two different versions: local only, remote only, both same, both different, add and delete.');
  }

  // 3c. The app writes null for an unused middle or outer, but normalizeLoadedEntry (backup load, Drive apply) turns null
  // into an empty string. Reconcile compares null, undefined and '' in middle or outer as equal and never rewrites a stored value.
  {
    const nullSide = clone(driveFixture);                 // record 2 has outer: null (as the app writes it)
    const emptySide = clone(driveFixture); emptySide.entries[1].outer = '';   // same record after normalisation
    assert.equal(nullSide.entries[1].outer, null);
    // A null versus empty string difference is not an edit: no conflict, and the stored value already there is kept.
    const adopted = reconcile(nullSide, nullSide, emptySide);
    assert.equal(adopted.entries[1].outer, null, 'a null versus empty string difference is not a remote edit; the local stored value is kept');
    const base = clone(driveFixture); base.entries[1].comment = 'older';
    assert.doesNotThrow(() => reconcile(base, emptySide, nullSide), 'null versus empty string with a different base is not a conflict');
    assert.doesNotThrow(() => reconcile(null, emptySide, nullSide), 'no base: null versus empty string is not a conflict');
    assert.deepEqual(getConflicts(null, emptySide, nullSide).map(item => item.key), []);
    // The merged output keeps whichever stored value was already there (the local side when both are equal in meaning).
    assert.equal(reconcile(base, emptySide, nullSide).entries[1].outer, '');
    assert.equal(reconcile(base, nullSide, emptySide).entries[1].outer, null);
    // Middle behaves the same way, and undefined counts as equal too.
    const midNull = clone(driveFixture); midNull.entries[1].middle = null;
    const midEmpty = clone(driveFixture); midEmpty.entries[1].middle = '';
    assert.doesNotThrow(() => reconcile(null, midNull, midEmpty));
    const outerUndef = clone(driveFixture); outerUndef.entries[1].outer = undefined;
    assert.doesNotThrow(() => reconcile(null, outerUndef, emptySide));
    // A genuine edit to a different field on both sides still conflicts, even with a null versus empty string difference.
    const editA = clone(nullSide); editA.entries[1].comment = 'Mine';
    const editB = clone(emptySide); editB.entries[1].comment = 'Theirs';
    assert.throws(() => reconcile(nullSide, editA, editB), error => error.code === 'sync-conflict');
    assert.deepEqual(getConflicts(nullSide, editA, editB).map(item => item.key), ['record 00000000-0000-4000-8000-000000000002']);
    // A real change of the value (null to a name) is still an edit.
    const named = clone(nullSide); named.entries[1].outer = 'Ashamed';
    assert.equal(reconcile(nullSide, nullSide, named).entries[1].outer, 'Ashamed');
    console.log('PASS: null versus empty string is not an edit or conflict in Drive reconcile; real edits still conflict; stored values kept.');
  }

  // 5. showDescriptions: stored as true or absent, never false (addendum 1, section 5).
  {
    const withKey = clone(backupFixture); withKey.settings.showDescriptions = true;
    const oldHtml = html.replace(/\n  \/\/ showDescriptions is stored only as true[\s\S]*?else delete normalized\.showDescriptions;/, '');
    assert.notEqual(oldHtml, html, 'old-code simulation strips the new normalizeSettings rule');
    const oldApp = makeApp(oldHtml);
    // Old code keeps and re-saves the key with no other change.
    const oldParsed = oldApp.ctx.getBackupEntriesFromText(JSON.stringify(withKey));
    oldApp.ctx.__set(oldApp.ctx.normalizeSettings(clone(withKey.settings)), oldParsed.validEntries, oldParsed.ratingScale);
    const oldSaved = JSON.parse(JSON.stringify(oldApp.ctx.getBackupSnapshot()));
    assert.equal(oldSaved.settings.showDescriptions, true, 'old code keeps the key');
    assert.equal(canon(withoutExportedAt(oldSaved)), canon(Object.assign(withoutExportedAt(withKey), { entries: withKey.entries.map(asNormalised) })), 'old code re-saves the file with no churn');
    // New code reads the file the old code saved: identical.
    assert.equal(canon(withoutExportedAt(backupRoundTrip(oldSaved))), canon(withoutExportedAt(oldSaved)), 'new code reads old-saved file unchanged');
    // Old code applies a Drive snapshot with the key: stored settings keep it.
    const driveWithKey = clone(driveFixture); driveWithKey.settings.showDescriptions = true;
    for (const [label, application] of [['old', oldApp], ['new', makeApp()]]) {
      application.store.set(application.keys.schema, '5'); application.store.set(application.keys.log, readFixture('local-log-schema5.json'));
      const parsed = application.ctx.getBackupEntriesFromText(JSON.stringify(driveFixture));
      application.ctx.__set(application.ctx.normalizeSettings(clone(driveFixture.settings)), parsed.validEntries, parsed.ratingScale);
      const expectedLocal = JSON.parse(JSON.stringify(application.ctx.getBackupSnapshot()));
      application.ctx.applyDriveSyncSnapshot(driveWithKey, expectedLocal);
      assert.equal(JSON.parse(application.store.get(application.keys.settings)).showDescriptions, true, `${label} code stores the Drive settings key`);
    }
    // Absent, false and non-boolean values are stored as absent; only true is kept.
    const { ctx: current } = makeApp();
    for (const value of [undefined, false, 'true', 1, null, {}, []]) {
      assert(!('showDescriptions' in current.normalizeSettings({ showDescriptions: value })), `${JSON.stringify(value)} is dropped`);
    }
    assert.equal(current.normalizeSettings({ showDescriptions: true }).showDescriptions, true);
    // Helpers and a toggle round trip: on then off returns the stored settings byte-identical.
    const app = makeApp();
    app.store.set(app.keys.settings, JSON.stringify(backupFixture.settings));
    app.store.set(app.keys.schema, '5'); app.store.set(app.keys.log, readFixture('local-log-schema5.json'));
    app.ctx.__set(app.ctx.loadSettings(), [], 5);
    const startText = app.store.get(app.keys.settings);
    assert.equal(app.ctx.getShowDescriptions(), false, 'absent means off');
    app.ctx.setShowDescriptions(true);
    assert.equal(app.ctx.getShowDescriptions(), true);
    assert.equal(JSON.parse(app.store.get(app.keys.settings)).showDescriptions, true);
    assert(Object.keys(JSON.parse(app.store.get(app.keys.settings))).pop() === 'showDescriptions', 'key is added last');
    assert.equal(app.ctx.loadSettings().showDescriptions, true, 'reload keeps the preference');
    app.ctx.setShowDescriptions(false);
    assert.equal(app.store.get(app.keys.settings), startText, 'toggle on then off is byte-identical');
    app.ctx.setShowDescriptions('yes');
    assert.equal(app.ctx.getShowDescriptions(), false, 'a non-boolean value never turns it on');
    // No description text reaches any output.
    app.ctx.setShowDescriptions(true);
    assert(!/description/i.test(app.store.get(app.keys.settings).replace('showDescriptions', '')), 'no description text stored');
    console.log('PASS: showDescriptions is stored as true or absent, and old and new code carry it unchanged.');
  }

  // 4. Stored level text. Heading renames must never touch these strings.
  const levels = ['Inner circle', 'Middle circle', 'Outer circle'];
  const { ctx } = makeApp();
  assert.deepEqual([ctx.getRecordedLevel({ inner: 'Sad' }), ctx.getRecordedLevel({ inner: 'Sad', middle: 'Guilty' }), ctx.getRecordedLevel({ inner: 'Sad', middle: 'Guilty', outer: 'Ashamed' })], levels);
  ctx.__select('Sad', null, null); assert.equal(ctx.getSelectionLevel(), levels[0]);
  ctx.__select('Sad', 'Guilty', null); assert.equal(ctx.getSelectionLevel(), levels[1]);
  ctx.__select('Sad', 'Guilty', 'Ashamed'); assert.equal(ctx.getSelectionLevel(), levels[2]);
  assert.equal(ctx.getRecordedLevel({ level: 'Middle circle', inner: 'Sad' }), 'Middle circle', 'a stored level is kept as stored');
  for (const entry of backupFixture.entries) assert(levels.includes(entry.level), `fixture level ${entry.level} is a stored level string`);
  for (const entry of ctx.getBackupEntriesFromText(JSON.stringify(backupFixture)).validEntries) assert(levels.includes(entry.level));
  levels.forEach(text => assert(html.includes(`'${text}'`), `index.html still stores '${text}'`));
  console.log('PASS: stored level strings are Inner circle, Middle circle and Outer circle.');
})().catch(error => { console.error(error); process.exit(1); });
