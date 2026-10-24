export function stagingNavigation(path, { legacyDraft = false } = {}) {
  const sections = legacyDraft
    ? [
        ['/', 'Draft board'],
        ['/dashboard', 'My dashboard'],
        ['/admin', 'Admin'],
        ['/prediction', 'Prediction'],
      ]
    : [
        ['/', 'Prediction'],
        ['/dashboard', 'My dashboard'],
        ['/admin', 'Admin'],
      ];
  const predictionHome = legacyDraft ? '/prediction' : '/';
  const active = path === '/prediction' || path === '/admin/predictions' ? predictionHome : path;
  const links = sections
    .map(
      ([href, label]) =>
        `<a href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');
  return `<nav class="staging-main-nav" aria-label="League navigation">${links}</nav>`;
}

export function withStagingNavigation(html, path, options) {
  // This private navigation is independent of the embedded account client's
  // loading state. That client manages .account-nav on the public application.
  const navigation = /<nav\b[^>]*aria-label="League navigation"[^>]*>[\s\S]*?<\/nav>/;
  if (!navigation.test(html)) return html;
  const style =
    '<style>.staging-main-nav{display:flex;align-items:center;flex-wrap:wrap;gap:10px 22px;border-bottom:1px solid var(--line,#dedfd5);padding:0 0 13px;margin-bottom:28px;font:500 13px/1.4 system-ui,sans-serif}.staging-main-nav a{display:block;color:var(--muted,#687369);text-decoration:none;padding:8px 0;border-bottom:2px solid transparent;white-space:nowrap}.staging-main-nav a[aria-current="page"]{color:var(--ink,#24362b);font-weight:700;border-bottom-color:currentColor}.staging-main-nav a:hover{color:var(--ink,#24362b)}.staging-main-nav a:focus-visible{outline:3px solid #729d75;outline-offset:4px}.shell>.staging-main-nav{padding-top:25px;margin-bottom:0}@media(max-width:420px){.staging-main-nav{gap:8px 15px;font-size:12px}}</style>';
  if (options?.legacyDraft && path === '/') {
    // The preserved page also receives staging's PP prices. Add its missing
    // cost filters before the embedded draft script attaches button listeners.
    html = html.replace(/<div\b[^>]*class="price-filter"[^>]*>[\s\S]*?<\/div>/, (group) => {
      const missing = [7, 8, 9, 10]
        .filter((price) => !group.includes(`data-price="${price}"`))
        .map(
          (price) =>
            `<button type="button" class="chip" data-price="${price}" aria-pressed="false">${price}</button>`,
        )
        .join('');
      return group.replace(/(?=<button\b[^>]*data-price="11")/, missing);
    });
  }
  return html
    .replace(navigation, stagingNavigation(path, options))
    .replace('</head>', style + '</head>');
}
