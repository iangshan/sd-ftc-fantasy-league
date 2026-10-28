// Apply the saved theme before paint; share one controller across all pages.
try {
  const saved = localStorage.getItem('ftc-theme');
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
} catch {}
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('[data-theme-choice]');
  function select(theme) {
    document.documentElement.dataset.theme = theme;
    buttons.forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)),
    );
  }
  select(document.documentElement.dataset.theme);
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      select(button.dataset.themeChoice);
      try {
        localStorage.setItem('ftc-theme', button.dataset.themeChoice);
      } catch {}
    }),
  );
});
