// Check the emotion descriptions data file against the emotions array in index.html.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const dataPath = path.join(root, 'assets/emotion-descriptions.js');
const dataSource = fs.readFileSync(dataPath, 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const D = new Function(`${dataSource}\nreturn EMOTION_DESCRIPTIONS;`)();
const emotions = JSON.parse(html.match(/const emotions = (\[\[.*?\]\]);/)[1]);

const expected = new Set();
const levels = { inner: new Set(), middle: new Set(), outer: new Set() };
for (const [a, b, c] of emotions) {
  levels.inner.add(a); levels.middle.add(`${a}|${b}`); levels.outer.add(`${a}|${b}|${c}`);
}
for (const s of Object.values(levels)) for (const k of s) expected.add(k);
assert.deepEqual([levels.inner.size, levels.middle.size, levels.outer.size], [6, 36, 72]);

// Frozen, and exactly the expected keys (no missing, no extra or stale).
assert.ok(Object.isFrozen(D), 'object is frozen');
const keys = Object.keys(D);
assert.equal(keys.length, 114, '114 descriptions');
for (const k of expected) assert.ok(k in D, `missing description: ${k}`);
for (const k of keys) assert.ok(expected.has(k), `extra or stale key: ${k}`);
assert.equal(new Set(keys).size, keys.length, 'no duplicate keys');
// Duplicate keys in the source text collapse in an object, so also count them in the source.
const sourceKeys = [...dataSource.matchAll(/^ {2}"([^"]+)": "/gm)].map(m => m[1]);
assert.equal(sourceKeys.length, 114, '114 key lines in source');
assert.equal(new Set(sourceKeys).size, 114, 'no duplicate key lines in source');

// Word-count cap: the longest approved entry is 26 words (split on whitespace). Do not trim text to fit.
const WORD_CAP = 26;
for (const [k, v] of Object.entries(D)) {
  assert.equal(typeof v, 'string', `${k}: text is a string`);
  assert.ok(v.trim().length > 0, `${k}: not empty`);
  assert.equal(v, v.trim(), `${k}: no leading or trailing space`);
  assert.ok(!/PLACEHOLDER|TODO|TBD|FIXME|lorem|XXX/i.test(v), `${k}: no placeholder text`);
  assert.ok(!/[—–]/.test(v), `${k}: no em or en dashes`);
  const sentences = v.split(/(?<=[.!?])\s+/).filter(Boolean);
  assert.ok(sentences.length >= 1 && sentences.length <= 2, `${k}: one or two sentences`);
  assert.ok(/[.!?]$/.test(v), `${k}: ends with sentence punctuation`);
  const words = v.split(/\s+/).length;
  assert.ok(words <= WORD_CAP, `${k}: ${words} words exceeds cap ${WORD_CAP}`);
}

// Words that sit under two parents have one entry per path.
// Abandoned: middle Sad|Abandoned plus outer Sad|Lonely|Abandoned. Inferior and Inadequate: two outer paths each.
const pathsFor = word => keys.filter(k => k.split('|').pop() === word && k.includes('|'));
assert.deepEqual(pathsFor('Abandoned').sort(), ['Sad|Abandoned', 'Sad|Lonely|Abandoned']);
assert.deepEqual(pathsFor('Inferior').sort(), ['Fear|Insecure|Inferior', 'Sad|Depressed|Inferior']);
assert.deepEqual(pathsFor('Inadequate').sort(), ['Fear|Insecure|Inadequate', 'Fear|Rejected|Inadequate']);

// Display only: nothing that saves, exports, backs up or syncs may use the data.
const sources = [['index.html', html]];
for (const f of fs.readdirSync(path.join(root, 'assets'))) {
  if (f === 'emotion-descriptions.js' || !/\.(js|json|html)$/.test(f)) continue;
  sources.push([`assets/${f}`, fs.readFileSync(path.join(root, 'assets', f), 'utf8')]);
}
// Only a display script tag (added in a later change) may mention the file name; code may not use the global.
for (const [name, text] of sources) {
  assert.ok(!/EMOTION_DESCRIPTIONS/.test(text) || name === 'index.html', `${name}: must not use EMOTION_DESCRIPTIONS`);
  if (name === 'index.html') {
    // Any use in index.html must not sit inside a save, export, backup, Drive or serialise function.
    for (const m of text.matchAll(/function\s+(\w*(?:save|export|backup|drive|sync|serial|stringify)\w*)\s*\([^)]*\)\s*\{/gi)) {
      let depth = 0, i = m.index + m[0].length - 1, end = i;
      for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) { end = i; break; } }
      assert.ok(!/EMOTION_DESCRIPTIONS|emotion-descriptions/.test(text.slice(m.index, end)), `index.html: ${m[1]} must not reference descriptions`);
    }
  }
}
console.log('emotion-descriptions: ok');
