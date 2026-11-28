// Check that clearEntryForm clears every entry field, including values, and that all three exit paths use it.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');

const box = checked => ({ checked, type: 'checkbox' });
const group = items => ({ querySelectorAll: () => items, replaceChildren() {}, append() {} });
const radios = [box(true), box(false)];
const values = [box(true), box(true)];
const tags = [box(true)];
const sensations = [box(true), box(true)];
let bucketRendered = 0;
const context = vm.createContext({
  document: { querySelectorAll: () => radios },
  ratingScale: 5, selectedInner: 'Happy', selectedMiddle: 'Joyful', selectedOuter: 'Proud',
  expectedIntensity: { value: '5' }, actualIntensity: { value: '1' },
  entryComment: { value: 'note' }, bucketLevel: { value: '4' }, newTag: { value: 'draft' },
  tagStatus: { textContent: 'Added' },
  tagsButtons: group(tags), valuesButtons: group(values), sensationsButtons: group(sensations),
  renderBucketLevel() { bucketRendered++; }
});
// clearEntryForm clears the selection, then calls clearDetailFields for every optional answer (split out when Add detail moved after Record).
vm.runInContext(html.match(/function clearDetailFields\(\) \{[\s\S]*?\n}/)[0], context);
vm.runInContext(html.match(/function clearEntryForm\(\) \{[\s\S]*?\n}/)[0], context);
context.clearEntryForm();

assert.equal(context.selectedInner, null);
assert.equal(context.selectedMiddle, null);
assert.equal(context.selectedOuter, null);
assert.ok(radios.every(input => !input.checked), 'appropriate response cleared');
assert.equal(context.expectedIntensity.value, '3');
assert.equal(context.actualIntensity.value, '3');
assert.equal(context.entryComment.value, '');
assert.equal(context.bucketLevel.value, '');
assert.equal(bucketRendered, 1);
assert.ok(tags.every(input => !input.checked), 'tags cleared');
assert.equal(context.newTag.value, '');
assert.equal(context.tagStatus.textContent, '');
assert.ok(sensations.every(input => !input.checked), 'sensations cleared');
assert.ok(values.every(input => !input.checked), 'values cleared');

// All three paths must call clearEntryForm and then redraw.
const recordHandler = html.match(/lastRecordedEntry = entry;[\s\S]*?recordButton\.focus\(\);/)[0];
assert.match(recordHandler, /clearEntryForm\(\);\s*renderAll\(\);/, 'Record clears then redraws');
assert.match(html.match(/resetButton\.addEventListener\('click'[\s\S]*?\n}\);/)[0], /clearEntryForm\(\);\s*renderAll\(\);/, 'Reset clears then redraws');
assert.match(html.match(/function startNewEntry\(\) \{[\s\S]*?\n}/)[0], /clearEntryForm\(\);\s*renderAll\(\);/, 'Start a new entry clears then redraws');

// Edit mode still loads saved values after clearing.
assert.match(html.match(/function prepareEntry\([\s\S]*?\n}/)[0], /clearEntryForm\(\);[\s\S]*loadEntryAnswers\(entry\);/, 'edit mode loads saved answers');
assert.match(html.match(/function loadEntryAnswers\([\s\S]*?\n}/)[0], /renderValues\(entry\.values \|\| \[\]\);/, 'saved values are loaded');
console.log('clear-entry-form tests passed');
