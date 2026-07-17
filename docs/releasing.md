# Releasing Emotion Wheel

Emotion Wheel uses semantic version numbers in the form `major.minor.patch`.

The current version has one source of truth: `APP_VERSION` in `assets/version.js`. The value is displayed in the footer of the app and every rendered information page.

For every release:

1. Update `APP_VERSION` in `assets/version.js`.
2. Use a patch increase for fixes, a minor increase for backward-compatible features, or a major increase for breaking changes.
3. Run the repository and accessibility checks.
4. Commit the version change with the release changes.
5. Create a Git tag using the same version prefixed with `v`, for example `v1.1.0`.

The version workflow rejects a release tag when it does not match the version shown in the app.
