#!/usr/bin/env bash
# Validates HTML and CSS with the pinned tools in ci-tools/lint-tools.
# Run by "npm run lint" from the repository root. A root package.json makes
# lint.yml run this instead of its static-content steps, so it repeats them.
set -euo pipefail
npm ci --prefix ci-tools/lint-tools
export PATH="$PWD/ci-tools/lint-tools/node_modules/.bin:$PATH"
find . -name '*.html' -not -path './.git/*' -not -path './.github/*' -not -path './ci-tools/*' -not -path './node_modules/*' \
  -exec html-validate --config ci-tools/lint-tools/.htmlvalidate.json {} +
find . -name '*.css' -not -path './.git/*' -not -path './.github/*' -not -path './ci-tools/*' -not -path './node_modules/*' \
  -exec stylelint --config ci-tools/lint-tools/.stylelintrc.json {} +
