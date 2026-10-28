export function stagingNavigation(path, { leagueContext } = {}) {
  let sections = [
    ['/', 'Draft board'],
    ['/dashboard', 'My dashboard'],
    ['/admin', 'Admin'],
  ];
  if (leagueContext) {
    const coordinator = ['owner', 'admin', 'moderator'].includes(leagueContext.role);
    if (leagueContext.league.engine !== 'legacy-ftc') {
      sections = [
        ['/', 'League home'],
        ['/leagues', coordinator ? 'Manage league' : 'My league'],
      ];
    } else {
      if (!['owner', 'admin'].includes(leagueContext.role))
        sections = sections.filter(([href]) => href !== '/admin');
      sections.push([
        '/leagues',
        leagueContext.owner ? 'Leagues & access' : coordinator ? 'Manage league' : 'My league',
      ]);
    }
  }
  const links = sections
    .map(
      ([href, label]) =>
        `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');
  return `<nav class="staging-main-nav" aria-label="League navigation">${links}</nav>`;
}

export function withStagingNavigation(html, path, options) {
  // This private navigation is independent of the embedded account client's
  // loading state. That client manages .account-nav on the public application.
  const navigation = /<nav\b[^>]*aria-label="League navigation"[^>]*>[\s\S]*?<\/nav>/;
  if (!navigation.test(html)) return html;
  if (path === '/') {
    // The draft board uses the current whole-number prices. Add its missing
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
  return html.replace(navigation, stagingNavigation(path, options));
}
