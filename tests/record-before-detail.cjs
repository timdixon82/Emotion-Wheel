// Record before detail: the optional questions sit after Record, and Add detail updates the same entry.
// Runs the real Record, Save detail and Undo handlers out of index.html with stubbed form controls.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
let checks = 0;
const check = (label, condition) => { checks++; assert.ok(condition, label); };
const func = name => (html.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n}`, 'm')) || assert.fail(`function ${name} not found`))[0];
const handlerBody = pattern => (html.match(pattern) || assert.fail(`handler not found: ${pattern}`))[1];
const recordBody = handlerBody(/\nrecordButton\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/);
const detailBody = handlerBody(/\nsaveDetailButton\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/);
const undoBody = handlerBody(/\nundoRecordButton\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 1. Markup order: Record, then Add detail with every optional question, then capture settings (collapsed).
{
  const at = text => { const i = html.indexOf(text); assert.ok(i > 0, `${text} not found`); return i; };
  const record = at('id="recordButton"'), reset = at('id="resetButton"');
  const detailStart = at('id="addDetailSection"'), detailEnd = html.indexOf('</section>\n', at('id="detailStatus"'));
  const capture = at('id="capture-settings"');
  const steps = at('id="outer-heading"');
  check('Record follows the steps', steps < record && reset > record);
  check('Add detail is headed "Add detail (optional)"', /<h2 id="addDetailHeading"[^>]*>Add detail \(optional\)<\/h2>/.test(html));
  for (const id of ['appropriatePanel', 'intensityPanel', 'expectedIntensityPanel', 'actualIntensityPanel', 'sensationsPanel', 'tagsPanel', 'valuesPanel', 'bucketPanel', 'entryNoteSection', 'entryComment']) {
    const position = at(`id="${id}"`);
    check(`${id} comes after Record, inside Add detail`, position > record && position > detailStart && position < detailEnd);
  }
  check('capture settings come after Add detail', capture > detailEnd);
  check('capture settings are collapsed by default', !/<details id="capture-settings"[^>]*\bopen\b/.test(html));
  check('capture settings summary shows the current phase', /captureModeSummary\.textContent = `Capture settings — \$\{modeLabels/.test(html));
  check('Add detail starts hidden', /<section id="addDetailSection"[^>]*\bhidden\b/.test(html));
  check('skip link still targets Record', /<a class="skip-link" href="#recordButton" id="skipToRecord">Skip to Record this emotion<\/a>/.test(html));
  check('Record exists once', html.split('id="recordButton"').length === 2);
  // Capture settings still decide which questions show.
  for (const [panel, setting] of [['tagsPanel', 'collectTags'], ['valuesPanel', 'collectValues'], ['bucketPanel', 'collectBucketLevel'], ['appropriatePanel', 'collectAppropriate'], ['sensationsPanel', 'collectSensations'], ['expectedIntensityPanel', 'collectExpectedIntensity'], ['actualIntensityPanel', 'collectActualIntensity']]) {
    check(`${panel} still follows ${setting}`, html.includes(`${panel}.hidden = !captureSettings.${setting};`));
  }
  // No storage change.
  check('schema version is 5', /^const dataSchemaVersion = 5;/m.test(html));
  check('storage keys are unchanged', ['emotionWheelLocalLogV1', 'emotionWheelCaptureSettingsV1', 'emotionWheelLastCongratulatedDayV1'].every(key => html.includes(`'${key}'`)));
  check('detail is never stored as a setting or key', !/localStorage\.setItem\([^)]*detail/i.test(html));
}

// A page of stubs shared by the handlers.
const PHASES = {
  phase1: {},
  phase2: { collectAppropriate: true, collectExpectedIntensity: true, collectActualIntensity: true, collectSensations: true },
  phase3: { collectAppropriate: true, collectExpectedIntensity: true, collectActualIntensity: true, collectSensations: true, collectTags: true, collectBucketLevel: true },
  phase4: { collectAppropriate: true, collectExpectedIntensity: true, collectActualIntensity: true, collectSensations: true, collectTags: true, collectValues: true, collectBucketLevel: true },
  custom: { collectAppropriate: true, collectBucketLevel: true, collectTags: true }
};
const ALL_OFF = { collectAppropriate: false, collectExpectedIntensity: false, collectActualIntensity: false, collectSensations: false, collectTags: false, collectValues: false, collectBucketLevel: false, includeAllSensations: false };
const VALUE = { name: 'Honesty', theme: 'Connection', framework: 'personalvalues', frameworkLabel: 'Personal values' };

function makeApp(phase) {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { id, hidden: true, textContent: '', focusCount: 0, focus() { this.focusCount++; } }); return nodes.get(id); };
  const store = new Map();
  const form = { appropriate: '', sensations: [], tags: [], values: [] };
  const state = { failSave: false, renders: 0, cleared: 0 };
  const ctx = vm.createContext({
    Date, crypto: require('node:crypto').webcrypto,
    document: { getElementById: node, querySelector: () => (form.appropriate ? { value: form.appropriate } : null) },
    captureSettings: { ...ALL_OFF, ...PHASES[phase] }, ratingScale: 5, logEntries: [], editingEntry: null, detailEntry: null, lastRecordedEntry: null,
    selectedInner: null, selectedMiddle: null, selectedOuter: null,
    expectedIntensity: { value: '3' }, actualIntensity: { value: '3' }, bucketLevel: { value: '' }, entryComment: { value: '' },
    liveStatus: node('liveStatus'), detailStatus: node('detailStatus'), recordButton: node('recordButton'),
    recordConfirmation: node('recordConfirmation'), recordConfirmationHeading: node('recordConfirmationHeading'),
    recordConfirmationText: node('recordConfirmationText'), undoRecordButton: node('undoRecordButton'),
    innerButtons: { querySelector: () => node('firstInner') },
    getReviewDataset: () => null, getLoggingStreak: () => ({ loggedToday: false }), showDailyLogCongratulations() {},
    getSelectionLevel: () => (ctx.selectedOuter ? 'Outer circle' : ctx.selectedMiddle ? 'Middle circle' : 'Inner circle'),
    getSelectedSensations: () => form.sensations, getSelectedTags: () => form.tags, getSelectedValues: () => form.values,
    saveLog() { if (state.failSave) throw new Error('Storage full'); store.set('log', JSON.stringify(ctx.logEntries)); },
    renderAll() { state.renders++; },
    clearDetailFields() { state.cleared++; },
    // The real clearEntryForm and loadEntryAnswers are covered by clear-entry-form.cjs. These keep the same defaults.
    clearEntryForm() {
      ctx.selectedInner = ctx.selectedMiddle = ctx.selectedOuter = null;
      Object.assign(form, { appropriate: '', sensations: [], tags: [], values: [] });
      ctx.expectedIntensity.value = '3'; ctx.actualIntensity.value = '3'; ctx.entryComment.value = '';
      ctx.bucketLevel.value = ctx.captureSettings.collectBucketLevel ? '3' : '';
    },
    loadEntryAnswers(entry) {
      form.appropriate = entry.appropriate || ''; form.sensations = [...(entry.physicalSensations || [])];
      form.tags = [...(entry.tags || [])]; form.values = [...(entry.values || [])];
      if (entry.expectedIntensity) ctx.expectedIntensity.value = String(entry.expectedIntensity);
      if (entry.actualIntensity) ctx.actualIntensity.value = String(entry.actualIntensity);
      ctx.entryComment.value = entry.comment || '';
      ctx.bucketLevel.value = entry.bucketLevel ? String(entry.bucketLevel) : (ctx.captureSettings.collectBucketLevel ? '3' : '');
    }
  });
  vm.runInContext(html.match(/^const sensationGuides = \{[\s\S]*?\n};/m)[0], ctx);
  vm.runInContext(html.match(/^const sensationAliases = \{[\s\S]*?\n};/m)[0], ctx);
  for (const name of ['getIntensityComparison', 'getRecordingAlignment', 'applyRecordingRatings', 'getActiveSensationType', 'getEntryPathLabel', 'applyOptionalAnswers']) vm.runInContext(func(name), ctx);
  vm.runInContext(`function record() {${recordBody}\n}\nfunction saveDetail() {${detailBody}\n}\nfunction undo() {${undoBody}\n}`, ctx);
  const select = (inner, middle = null, outer = null) => { ctx.selectedInner = inner; ctx.selectedMiddle = middle; ctx.selectedOuter = outer; };
  return { ctx, form, state, node, store, select };
}

// What the user types into the optional questions, honouring the phase (a question that is off is never answered).
function fill(app, answers) {
  const { ctx, form } = app;
  form.appropriate = answers.appropriate; form.sensations = [...answers.sensations]; form.tags = [...answers.tags]; form.values = [...answers.values];
  ctx.expectedIntensity.value = String(answers.expected); ctx.actualIntensity.value = String(answers.actual);
  ctx.bucketLevel.value = String(answers.bucket); ctx.entryComment.value = answers.comment;
}
const ANSWERS = [
  { appropriate: 'Yes', sensations: ['Hot', 'Eyes wide'], tags: ['Work'], values: [VALUE], expected: 4, actual: 2, bucket: 5, comment: '  A fake note  ' },
  { appropriate: 'No', sensations: [], tags: [], values: [], expected: 3, actual: 3, bucket: 3, comment: '' },
  { appropriate: 'Yes', sensations: ['Tense'], tags: ['Family', 'Work'], values: [], expected: 5, actual: 5, bucket: 1, comment: 'Only a note' }
];
const PATHS = [['Fear', 'Anxious', 'Worried'], ['Sad', 'Guilty', null], ['Happy', null, null]];
const normalise = entry => JSON.stringify({ ...entry, id: 'ID', createdAt: 'T', modifiedAt: 'T', timestamp: 'T' });

(async () => {
  // 2. Record plus Add detail saves exactly what the old way saved, across every phase, depth and set of answers.
  let compared = 0;
  for (const phase of Object.keys(PHASES)) for (const selection of PATHS) for (const answers of ANSWERS) {
    const old = makeApp(phase);                       // the old way: answer first, then Record
    old.ctx.clearEntryForm(); old.select(...selection); fill(old, answers); old.ctx.record();
    assert.equal(old.ctx.logEntries.length, 1);

    const next = makeApp(phase);                      // the new way: Record with the defaults, then Add detail
    next.ctx.clearEntryForm(); next.select(...selection); next.ctx.record();
    assert.equal(next.ctx.logEntries.length, 1, 'Record saves at once');
    const first = next.ctx.logEntries[0];
    assert.equal(next.ctx.detailEntry, first, 'Add detail is bound to the saved entry');
    assert.equal(next.ctx.selectedInner, null, 'the selection is cleared after Record');
    await sleep(5);
    fill(next, answers); next.ctx.saveDetail();

    assert.equal(next.ctx.logEntries.length, 1, `${phase}: one entry, never a second`);
    const saved = next.ctx.logEntries[0], reference = old.ctx.logEntries[0];
    assert.equal(normalise(saved), normalise(reference), `${phase} ${selection}: Record plus Add detail matches the old save byte for byte`);
    assert.deepEqual(Object.keys(saved), Object.keys(reference), 'same fields in the same order');
    assert.equal(saved.id, first.id); assert.equal(saved.createdAt, first.createdAt); assert.equal(saved.timestamp, first.timestamp);
    assert.notEqual(saved.modifiedAt, first.modifiedAt, 'modifiedAt is updated');
    assert.equal(next.store.get('log'), JSON.stringify(next.ctx.logEntries), 'the saved log holds the updated entry');
    compared++;
  }
  check(`Record plus Add detail equals the old save in ${compared} phase, depth and answer combinations`, compared === 45);

  // 3. Record alone saves the capture defaults, the same as an untouched form did before.
  {
    const app = makeApp('phase4');
    app.ctx.clearEntryForm(); app.select('Fear', 'Anxious', 'Worried'); app.ctx.record();
    const entry = app.ctx.logEntries[0];
    assert.deepEqual(Object.keys(entry).sort(), ['actualIntensity', 'appropriate', 'bucketLevel', 'createdAt', 'expectedIntensity', 'id', 'inner', 'intensityAlignment', 'level', 'middle', 'modifiedAt', 'outer', 'physicalSensations', 'sensationGuide', 'tags', 'timestamp', 'values']);
    check('Record alone stores the defaults and no new field', entry.expectedIntensity === 3 && entry.actualIntensity === 3 && entry.bucketLevel === 3 && entry.appropriate === '' && entry.sensationGuide === 'Anxiety' && !('comment' in entry));
    const phase1 = makeApp('phase1'); phase1.ctx.clearEntryForm(); phase1.select('Sad'); phase1.ctx.record();
    assert.deepEqual(Object.keys(phase1.ctx.logEntries[0]).sort(), ['createdAt', 'id', 'inner', 'level', 'outer', 'middle', 'modifiedAt', 'timestamp'].sort());
    check('Phase 1 Record stores only the emotion fields', true);
  }

  // 4. Focus, status and confirmation after Record.
  {
    const app = makeApp('phase2');
    app.ctx.clearEntryForm(); app.select('Fear', 'Anxious', 'Worried'); app.ctx.record();
    check('focus is put on Record, not on the confirmation', app.node('recordButton').focusCount === 1 && app.node('recordConfirmation').focusCount === 0);
    check('one status says recorded, selection cleared and Add detail available', /^Recorded Fear then Anxious then Worried\. The selection is cleared\. Add detail is available below\.$/.test(app.node('liveStatus').textContent));
    check('the confirmation shows with Undo', app.node('recordConfirmation').hidden === false && app.node('recordConfirmationText').textContent === 'Fear then Anxious then Worried was saved on this device.');
    check('the daily streak message still runs after Record', /showDailyLogCongratulations\(loggedTodayBeforeSave, now\)/.test(recordBody));
    check('Save detail never runs the streak message', !/showDailyLogCongratulations/.test(detailBody));
    check('Record is not given a second entry when pressed with nothing selected', (() => { app.ctx.record(); return app.ctx.logEntries.length === 1 && /Choose an emotion first/.test(app.node('liveStatus').textContent); })());
  }

  // 5. Undo removes only the just-recorded entry, also after Add detail replaced the saved object.
  {
    const app = makeApp('phase2');
    const other = { id: 'other-entry', timestamp: '2026-01-01T00:00:00.000Z', inner: 'Sad', middle: null, outer: null };
    app.ctx.logEntries = [other];
    app.ctx.clearEntryForm(); app.select('Happy'); app.ctx.record();
    fill(app, ANSWERS[0]); app.ctx.saveDetail();
    app.ctx.undo();
    check('Undo after Add detail removes the new entry only', app.ctx.logEntries.length === 1 && app.ctx.logEntries[0] === other);
    check('Undo closes Add detail', app.ctx.detailEntry === null && app.state.cleared === 1);
  }

  // 6. Failures and a removed entry never lose data or add a second entry.
  {
    const app = makeApp('phase2');
    app.ctx.clearEntryForm(); app.select('Happy'); app.ctx.record();
    const saved = app.ctx.logEntries[0];
    fill(app, ANSWERS[0]); app.state.failSave = true; app.ctx.saveDetail();
    check('a failed Add detail save keeps the entry and the typed answers', app.ctx.logEntries[0] === saved && app.ctx.entryComment.value === '  A fake note  ' && /could not be saved/.test(app.node('detailStatus').textContent));
    app.state.failSave = false;
    app.ctx.logEntries = [];                          // deleted in the log meanwhile
    app.ctx.saveDetail();
    check('Add detail for a deleted entry saves nothing and says so', app.ctx.logEntries.length === 0 && /no longer in your log/.test(app.node('detailStatus').textContent));
    app.ctx.logEntries = [{ ...saved }];              // replaced by a sync: a different object with the same id
    app.ctx.saveDetail();
    check('Add detail finds the entry by id after a sync replaced it', app.ctx.logEntries.length === 1 && app.ctx.logEntries[0].id === saved.id && app.ctx.logEntries[0].comment === 'A fake note');
  }

  // 7. Which entry the details belong to, and a new entry carries nothing over.
  {
    const spy = { cleared: 0, sensations: 0, hidden: null };
    const ctx = vm.createContext({
      selectedInner: null, selectedMiddle: null, selectedOuter: null, editingEntry: null, detailEntry: null,
      recordButton: { disabled: false, textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
      addDetailSection: { hidden: true }, saveDetailActions: { hidden: true }, addDetailIntro: { textContent: '' }, detailStatus: { textContent: 'old' },
      selectionText: { textContent: '' }, liveStatus: { textContent: '' }, getReviewDataset: () => null,
      getSelectionPath: () => [ctx.selectedInner, ctx.selectedMiddle, ctx.selectedOuter].filter(Boolean), getSelectionLevel: () => 'Inner circle',
      clearDetailFields() { spy.cleared++; }, renderSensations() { spy.sensations++; }
    });
    for (const name of ['getEntryPathLabel', 'renderAddDetail', 'renderSelection']) vm.runInContext(func(name), ctx);
    ctx.renderSelection();
    check('nothing selected and no saved entry: Add detail is hidden and Record is aria-disabled', ctx.addDetailSection.hidden && ctx.recordButton.attrs['aria-disabled'] === 'true' && ctx.recordButton.disabled === false);
    ctx.selectedInner = 'Sad'; ctx.renderSelection();
    check('an entry in progress shows Add detail, saved with Record', !ctx.addDetailSection.hidden && ctx.saveDetailActions.hidden && /pressing? Record|press Record this emotion/.test(ctx.addDetailIntro.textContent) && ctx.recordButton.attrs['aria-disabled'] === 'false');
    ctx.selectedInner = null; ctx.detailEntry = { id: 'x', inner: 'Fear', middle: 'Anxious', outer: null }; ctx.renderSelection();
    check('after Record, Add detail names the saved entry and offers Save detail', !ctx.addDetailSection.hidden && !ctx.saveDetailActions.hidden && /Fear then Anxious/.test(ctx.addDetailIntro.textContent) && /does not create a second entry/.test(ctx.addDetailIntro.textContent));
    ctx.selectedInner = 'Happy'; ctx.renderSelection();
    check('choosing a new emotion closes the old details and clears the answers', ctx.detailEntry === null && spy.cleared === 1 && spy.sensations === 1 && ctx.detailStatus.textContent === '' && ctx.saveDetailActions.hidden);
    check('the status says the old Add detail is closed', /Add detail for Fear then Anxious is closed/.test(ctx.liveStatus.textContent));
    check('Reset, Start a new entry and Edit all end the details', [/resetButton\.addEventListener\('click'[\s\S]*?detailEntry = null;[\s\S]*?\n\}\);/, /function startNewEntry\(\) \{[\s\S]*?detailEntry = null;/, /function prepareEntry\([\s\S]*?detailEntry = null;/].every(pattern => pattern.test(html)));
    check('Record handler binds Add detail after renderAll and loads the saved answers', /detailEntry = entry;[\s\S]*?clearEntryForm\(\);\s*renderAll\(\);\s*loadEntryAnswers\(entry\);/.test(recordBody));
  }

  // 8. Step buttons that are selected show more than colour.
  check('selected step buttons get a tick and a thicker double border', /\.button-grid button\[aria-pressed="true"\] \{ border-width: 4px; border-style: double;/.test(html) && /\.button-grid button\[aria-pressed="true"\]::before \{ content: "\\2713/.test(html));

  console.log(`record-before-detail: ok (${checks} checks, ${compared} comparisons)`);
})().catch(error => { console.error(error); process.exit(1); });
