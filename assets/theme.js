(function applySavedTheme() {
  const themes = ['light', 'dark', 'muted-light', 'muted-dark'];
  let theme = null;
  try {
    const designSystemTheme = localStorage.getItem('td-theme');
    const savedTheme = designSystemTheme || localStorage.getItem('emotionWheelThemeV1');
    if (themes.includes(savedTheme)) {
      theme = savedTheme;
      if (!designSystemTheme) localStorage.setItem('td-theme', theme);
    }
  } catch (error) {
    // Use the operating-system preference when storage is unavailable.
  }
  if (!theme) theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;

  window.addEventListener('DOMContentLoaded', () => {
    const picker = document.querySelector('.info-theme-select');
    if (!picker) return;
    picker.value = theme;
    picker.addEventListener('change', () => {
      if (!themes.includes(picker.value)) return;
      theme = picker.value;
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem('td-theme', theme);
        localStorage.setItem('emotionWheelThemeV1', theme);
      } catch (error) {
        // The selected theme still applies for the current page.
      }
    });
  });
}());
