try {
  const t = localStorage.getItem('ftc-theme');
  document.documentElement.dataset.theme =
    t === 'light' || t === 'dark'
      ? t
      : matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
} catch (e) {}
