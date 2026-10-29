// Release gate: keep the user-facing explanation and data-safety checks in step
// with the version being published. This is intentionally dependency-free so it
// runs in the same CI environment as the browser-data compatibility tests.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const versionSource = read('assets/version.js');
const app = read('index.html');
const help = read('docs/help.html');
const changelog = read('CHANGELOG.md');
const version = versionSource.match(/APP_VERSION = '([^']+)'/)?.[1];

assert.match(version || '', /^\d+\.\d+\.\d+$/, 'APP_VERSION must use major.minor.patch');
assert.match(changelog, new RegExp(`^## ${version.replaceAll('.', '\\.')}\\n`, 'm'), 'The current version needs a changelog entry');

for (const file of ['index.html', 'docs/about.html', 'docs/accessibility.html', 'docs/help.html', 'docs/licence.html', 'docs/privacy.html']) {
  const source = read(file);
  assert.match(source, new RegExp(`assets/version\\.js\\?v=${version.replaceAll('.', '\\.')}`), `${file} must request the current version script`);
}

const updateNotice = app.match(/<section hidden id="dataUpgradeDialog"[\s\S]*?<\/section>\n  <p class="intro">/)?.[0] || '';
assert.match(updateNotice, /Personal values are here!/i, 'The data-update notice must name the current values feature');
assert.match(updateNotice, /up to five main values/i, 'The data-update notice must explain the top-five selector');
assert.match(updateNotice, /Stability, Connection, Autonomy, Development and Impact/, 'The data-update notice must name every values theme');
assert.match(updateNotice, /Personalvalu\.es/, 'The data-update notice must link to values discovery guidance');
assert.match(updateNotice, /existing records and older backups remain supported/i, 'The data-update notice must explain backwards compatibility');

assert.match(help, /Phase 4 also lets you record the personal values involved\./, 'Help must describe Phase 4 values');
assert.match(help, /choose up to five main values/i, 'Help must explain the top-five selector');
assert.match(help, /Stability, Connection, Autonomy, Development and Impact/, 'Help must name every values theme');
assert.match(help, /Personalvalu\.es/, 'Help must link to values discovery guidance');

assert.match(app, /const dataSchemaVersion = 4;/, 'The values release must retain its schema version');
assert.match(app, /if \(version > dataSchemaVersion\)/, 'Newer unsupported datasets must remain protected');
assert.match(app, /save an original backup/i, 'Schema updates must retain the original-backup safeguard');

console.log(`PASS: release readiness for v${version}: update notice, Help, cache references and schema safety are present.`);
