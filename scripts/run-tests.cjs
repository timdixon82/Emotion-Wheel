'use strict';
// Runs every tests/*.cjs file with node, one after another, and exits
// non-zero if any file fails. Dependency-free; no shell is used.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = path.join(__dirname, '..', 'tests');
const files = fs
  .readdirSync(testsDir)
  .filter((name) => name.endsWith('.cjs'))
  .sort();

const failed = [];
for (const name of files) {
  console.log('\n=== ' + name + ' ===');
  const result = spawnSync(process.execPath, [path.join(testsDir, name)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    failed.push(name);
  }
}

console.log('\n=== Summary ===');
console.log('Files run: ' + files.length);
console.log('Passed: ' + (files.length - failed.length));
console.log('Failed: ' + failed.length);
failed.forEach((name) => console.log('  FAILED: ' + name));
process.exit(failed.length > 0 || files.length === 0 ? 1 : 0);
