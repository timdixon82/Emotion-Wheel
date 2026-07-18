(function showApplicationVersion() {
  const APP_VERSION = '1.0.3';

  function renderVersion() {
    document.querySelectorAll('[data-app-version]').forEach(element => {
      element.textContent = `v${APP_VERSION}`;
    });
  }

  window.EMOTION_WHEEL_VERSION = APP_VERSION;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderVersion, { once: true });
  } else {
    renderVersion();
  }
}());
