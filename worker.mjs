// server/page.mjs
var page_default = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  
  <title>San Diego FTC Fantasy League</title>
  <style>
    :root{--font:"Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color-scheme:dark;--paper:#202326;--surface:#292d31;--surface-raised:#30353a;--ink:#f3f0e8;--muted:#c0c2c2;--line:#4a5055;--accent:#92b5ce;--accent-hover:#abc7da;--accent-text:#b7d1e3;--accent-soft:#2c3942}
    *{box-sizing:border-box}html{scroll-padding-top:20px}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 var(--font)}button,input,select{font:inherit}button,a,input,select{touch-action:manipulation}button{cursor:pointer}button:disabled{cursor:not-allowed}a{color:var(--ink);text-underline-offset:3px}a:hover{color:var(--accent-text)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--accent-text);outline-offset:3px}[hidden]{display:none!important}
    .site-header{background:#24282c;border-bottom:1px solid var(--line);color:var(--ink)}.header-inner{max-width:1240px;margin:auto;padding:18px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:flex;align-items:center;gap:20px;min-width:0}.brand>div{min-width:0}.brand-icon{display:block;width:88px;height:88px;flex-shrink:0;object-fit:contain;background:white;border-radius:12px}.brand-name{max-width:380px;font-size:23px;font-weight:650;line-height:1.18;letter-spacing:-.55px}.brand-sub{margin-top:7px;font-size:11px;font-weight:600;letter-spacing:.1px;text-transform:none;color:var(--muted)}.season{border:0;padding:4px 0;font:600 12px/1.5 var(--font);letter-spacing:.5px;white-space:nowrap}
    .page{max-width:1240px;margin:auto;padding:30px 32px 28px}.intro{display:flex;align-items:flex-end;justify-content:space-between;gap:30px;margin-bottom:31px}.eyebrow{font-size:10px;font-weight:650;letter-spacing:.1px;text-transform:none;color:var(--accent-text);margin:0 0 9px}h1{font-size:clamp(30px,3.3vw,38px);font-weight:650;line-height:1.03;letter-spacing:-.5px;margin:0 0 11px}.intro-copy{margin:0;color:var(--muted);font-size:14px;max-width:610px}.intro-rule{max-width:225px;font-size:12px;color:var(--muted);text-align:right}.intro-rule strong{display:block;color:var(--ink);font-size:12px;font-weight:600;margin-bottom:3px}.notice{background:#38382f;border:1px solid #7c7961;border-radius:5px;padding:12px 15px;margin-bottom:20px;color:#f1ecd6;font-size:13px}.notice.error{background:var(--accent-soft);border-color:#8097a6;color:#e4edf2}.layout{display:grid;grid-template-columns:minmax(0,1fr) 326px;gap:30px;align-items:start}
    .catalog-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.catalog-heading h2{font-size:13px;text-transform:none;font-weight:650;letter-spacing:.1px;margin:0}.count{font-size:11px;font-family:var(--font);color:var(--muted)}.toolbar{border-bottom:0;padding:0 0 18px;margin-bottom:0}.search-row{display:flex;gap:9px}.search-wrap{position:relative;flex:1;min-width:0}.search-wrap svg{position:absolute;left:13px;top:13px;width:18px;height:18px;color:var(--muted);pointer-events:none}.search-wrap input{width:100%;padding:11px 12px 11px 40px}input,select{min-height:44px;background:#292d31;color:var(--ink);border:1px solid #717b83;border-radius:5px}input{padding:11px 12px}input::placeholder{color:#bbc0c2}input:disabled{opacity:.65}.sort{width:163px;padding:9px 27px 9px 10px;font-size:12px}.filter-row{display:flex;align-items:center;justify-content:space-between;gap:11px;margin-top:13px;flex-wrap:wrap}.price-filter{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.filter-label{font-size:11px;color:var(--muted);margin-right:6px}.chip{min-height:34px;min-width:37px;padding:5px 9px;border:1px solid #5b656c;border-radius:5px;background:#2c3136;color:#f0ede6;font:600 12px/1.4 var(--font)}.chip:hover{background:#3d444b;border-color:#8a969e}.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:white}.peak-toggle{display:flex;gap:7px;align-items:center;white-space:nowrap;color:var(--muted);font-size:11px;cursor:pointer}.peak-toggle input{width:15px;height:15px;min-height:0;margin:0;accent-color:var(--accent)}
    .team-grid{display:grid;grid-template-columns:1fr;border-top:1px solid var(--line)}.team-card{display:grid;grid-template-columns:minmax(0,1fr) 196px;column-gap:20px;row-gap:4px;background:var(--surface);border:0;border-bottom:1px solid var(--line);border-left:3px solid transparent;border-radius:0;padding:17px 17px 15px 15px;min-width:0;transition:background .12s}.team-card:nth-child(even){background:#272b2f}.team-card:hover{background:#343b41}.team-card.selected{border-left-color:var(--accent);background:#33444f}.team-card.selected:hover{background:#3a4f5c}.team-card.unavailable{background:#272b2f}.card-top{display:flex;align-items:center;justify-content:flex-start;gap:14px;grid-column:1;grid-row:1;min-width:0}.team-number{font:600 12px/1.4 var(--font);color:#d3d8da;letter-spacing:.2px}.rank{font-size:10px;color:var(--muted)}.card-title{grid-column:1;grid-row:2;font-size:18px;font-weight:650;line-height:1.2;letter-spacing:-.2px;margin:2px 0;overflow-wrap:anywhere}.card-bottom{grid-column:2;grid-row:1 / 4;display:flex;align-items:center;justify-content:space-between;gap:15px}.stat{text-align:right;min-width:83px}.stat-value{display:block;font:650 30px/1 var(--font);letter-spacing:-.5px;font-variant-numeric:tabular-nums;color:var(--ink)}.stat-label{display:block;margin-top:7px;font-size:9px;font-weight:600;letter-spacing:.7px;color:var(--muted)}.peak{grid-column:1 / -1;margin-top:7px;padding-top:7px;border-top:1px solid #4c5961;font-size:11px;color:var(--muted)}.add-team{min-width:82px;min-height:44px;padding:9px 11px;display:flex;align-items:center;justify-content:center;gap:10px;border:1px solid #94a1aa;border-radius:5px;background:#353c42;color:#fff;font:650 16px/1 var(--font);white-space:nowrap}.add-team .plus{font:400 21px/1 Arial,sans-serif;color:#bdd5e5}.add-team:not(:disabled):hover{background:var(--accent);border-color:var(--accent);color:white}.add-team:not(:disabled):hover .plus{color:white}.selected .add-team{background:var(--accent);border-color:var(--accent);color:white}.selected .add-team .plus{color:white}.selected .add-team:hover{background:var(--accent-hover)!important;border-color:var(--accent-hover)!important}.add-team:disabled{background:#282d31;border-color:#56616a;color:#a8b2b8}.add-team:disabled .plus{color:#a8b2b8}.card-reason{grid-column:1;grid-row:3;min-height:15px;font-size:10px;line-height:1.5;color:var(--muted);margin:0}.selected .card-reason{color:#cfdfeb}.empty{grid-column:1/-1;padding:40px 20px;border-bottom:1px solid var(--line);background:var(--surface);color:var(--muted);text-align:center}.empty strong{display:block;color:var(--ink);margin-bottom:6px}.loading{grid-column:1/-1;padding:50px 20px;color:var(--muted);text-align:center}.loading-dot{display:inline-block;width:7px;height:7px;margin-right:9px;background:var(--accent);animation:pulse 1.1s infinite alternate}@keyframes pulse{to{opacity:.35}}
    .sidebar{position:sticky;top:18px;max-height:calc(100dvh - 36px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:#697780 #242a2e}.roster-panel{background:var(--surface);border:1px solid var(--line);border-top:1px solid var(--line);border-radius:6px;overflow:hidden}.roster-heading{background:#30383e;padding:19px 19px 18px;border-bottom:1px solid var(--line)}.roster-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.roster-title-row h2{font-size:13px;font-weight:650;text-transform:none;letter-spacing:.1px;margin:0}.slots-count{color:var(--muted);font:11px/1.5 var(--font)}.budget-row{display:flex;align-items:flex-end;justify-content:space-between;margin:20px 0 15px}.budget-large{font:650 44px/1 var(--font);letter-spacing:-.8px;color:#fff;font-variant-numeric:tabular-nums}.budget-label{display:block;margin-top:7px;color:var(--muted);font-size:9px;font-weight:600;letter-spacing:1px}.budget-spent{font:11px/1.5 var(--font);color:var(--muted);text-align:right}.budget-spent strong{color:var(--ink);font-weight:600}.budget-track{height:4px;background:#5e6c75;overflow:hidden}.budget-fill{height:100%;width:0;background:var(--accent);transition:width .15s}.roster-body{padding:18px 19px}.roster-list{list-style:none;display:grid;gap:8px;padding:0;margin:0 0 13px}.roster-slot{display:flex;align-items:center;gap:9px;min-height:55px;padding:9px 10px;border:1px dashed #66717a;border-radius:2px;background:#242a2e}.slot-number{display:grid;place-items:center;flex-shrink:0;width:23px;height:23px;border-right:1px solid #5c6870;font:11px/1 var(--font);color:#c9d3d9}.slot-hint{font-size:11px;color:#bcc7ce}.roster-slot.filled{background:#33424c;border-style:solid;border-color:#829eaf}.slot-info{flex:1;min-width:0}.slot-name{font-size:12px;font-weight:600;line-height:1.2;overflow-wrap:anywhere}.slot-team{font:10px/1.4 var(--font);color:var(--muted);margin-top:3px}.slot-price{font:600 13px/1 var(--font);white-space:nowrap}.remove-team{min-width:28px;min-height:35px;border:0;background:transparent;padding:0 3px;color:#dce7ed;font-size:22px;line-height:1}.remove-team:hover{background:#435762;color:#eef5f9}.selection-tip{font-size:11px;line-height:1.5;color:var(--muted);margin:0}.form-divider{border:0;border-top:1px solid var(--line);margin:19px 0}.form-label{display:block;margin-bottom:6px;font-size:11px;font-weight:600;color:#eeeae2}.form-label span{color:var(--accent-text)}.field{margin-bottom:13px}.field input{width:100%;min-height:42px;background:#24282c;font-size:13px}.field small{display:block;font-size:10px;line-height:1.5;color:var(--muted);margin-top:5px}.submit{width:100%;min-height:47px;padding:12px 13px;margin-top:4px;background:var(--accent);border:1px solid var(--accent);border-radius:5px;color:white;font-size:13px;font-weight:650}.submit:not(:disabled):hover{background:var(--accent-hover);border-color:var(--accent-hover)}.submit:disabled{background:#3e4951;border-color:#6f7f89;color:#d2d8dc}.form-message{font-size:12px;color:#e8d5ab;line-height:1.5;padding:8px 0 4px;margin:0;overflow-wrap:anywhere}.privacy{font-size:10px;line-height:1.55;color:var(--muted);margin:11px 0 0}.sidebar-note{margin:13px 2px 0;color:var(--muted);font-size:11px;line-height:1.65}.sidebar-note strong{color:var(--ink);font-size:10px;letter-spacing:1px;text-transform:none}.footer{display:flex;justify-content:space-between;gap:25px;border-top:1px solid var(--line);margin-top:32px;padding-top:20px;color:#b8c2c7;font-size:10px;line-height:1.6}.footer p{margin:0;max-width:700px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
    .success{max-width:620px;background:var(--surface);border:1px solid var(--line);border-top:1px solid var(--line);border-radius:6px;margin:25px auto 45px;padding:32px}.success-mark{display:grid;place-items:center;width:44px;height:44px;margin-bottom:20px;background:var(--accent);color:white;font-size:25px;border-radius:5px}.success h2{font-size:28px;line-height:1.15;letter-spacing:-.6px;margin:0 0 12px}.success>p{color:var(--muted);margin:0 0 20px}.success .eyebrow{color:var(--accent-text);font-size:10px}.success-roster{padding:0;list-style:none;margin:0}.success-roster li{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding:12px 0;font-size:13px}.success-total{display:flex;justify-content:space-between;gap:16px;font-size:14px;font-weight:650;margin-top:17px}.success-footnote{font-size:12px;margin-top:24px!important}.reload-button{border:1px solid #a1bccc;background:#394d59;color:#e2eef4;padding:7px 12px;margin-left:10px;border-radius:5px;font-size:12px}.closed{opacity:.85}
    @media(max-width:1050px){.layout{grid-template-columns:minmax(0,1fr) 302px;gap:20px}.team-card{grid-template-columns:minmax(0,1fr) 170px;column-gap:12px;padding:16px 12px}.card-bottom{gap:10px}.stat-value{font-size:27px}.stat{min-width:75px}.add-team{min-width:75px;font-size:15px}.card-title{font-size:17px}.intro-rule{display:none}.brand-name{font-size:21px}}
    @media(max-width:820px){.page{padding:25px 22px}.header-inner{padding:17px 22px}.layout{grid-template-columns:minmax(0,1fr) 284px;gap:17px}.team-card{grid-template-columns:minmax(0,1fr) 147px;column-gap:9px;padding:15px 10px}.card-top{gap:8px;flex-wrap:wrap}.rank{font-size:9px}.team-number{font-size:11px}.card-title{font-size:15px}.stat{min-width:64px}.stat-value{font-size:24px}.stat-label{font-size:8px;letter-spacing:.3px}.add-team{min-width:65px;font-size:14px;gap:7px;padding:8px}.roster-body{padding:16px}.roster-heading{padding:17px 16px}.search-row{flex-direction:column}.sort{width:100%}.peak-toggle{font-size:10px}.intro-copy{font-size:13px}}
    @media(max-width:680px){.header-inner{padding:15px 17px;display:grid;grid-template-columns:68px minmax(0,1fr);column-gap:15px;row-gap:6px;align-items:center}.brand{display:contents}.brand>div{grid-column:2;grid-row:1;align-self:end}.brand-icon{width:68px;height:68px;border-radius:10px;grid-column:1;grid-row:1 / 3}.brand-name{font-size:18px;max-width:260px;line-height:1.15;letter-spacing:-.35px}.brand-sub{display:none}.season{grid-column:2;grid-row:2;align-self:start;justify-self:start;font-size:10px;padding:1px 0 1px 8px;letter-spacing:.2px;border-left-width:2px}.page{padding:24px 17px}.intro{margin-bottom:26px}h1{font-size:34px;letter-spacing:-1px;margin-bottom:10px}.eyebrow{font-size:9px;margin-bottom:8px}.layout{display:flex;flex-direction:column;gap:28px}.catalog{width:100%}.sidebar{width:100%;position:static;max-height:none;overflow:visible}.catalog-heading{margin-bottom:14px}.catalog-heading h2{font-size:12px;letter-spacing:.1px}.count{font-size:10px}.toolbar{padding-bottom:15px}.search-row{flex-direction:row}.search-wrap input{font-size:14px;padding-left:36px}.search-wrap svg{left:11px;width:16px}.sort{width:145px;font-size:11px}.filter-row{gap:11px}.price-filter{gap:5px}.chip{min-width:36px;min-height:35px;font-size:12px;padding:6px 8px}.peak-toggle{font-size:11px}.team-card{grid-template-columns:minmax(0,1fr) 162px;padding:17px 11px 15px 12px;column-gap:11px}.card-top{gap:10px;flex-wrap:nowrap}.team-number{font-size:11px}.rank{font-size:9px}.card-title{font-size:16px;line-height:1.18;letter-spacing:-.1px;margin:3px 0}.card-reason{font-size:10px}.card-bottom{gap:10px}.stat{min-width:73px}.stat-value{font-size:27px;letter-spacing:-.5px}.stat-label{font-size:8px;letter-spacing:.3px}.add-team{min-width:70px;font-size:15px;min-height:44px;gap:8px;padding:8px}.mobile-roster-link{position:sticky;top:8px;z-index:5;display:flex!important;align-items:center;justify-content:space-between;gap:12px;min-height:46px;background:#8aacbf;color:#fff;border:1px solid #b0cad9;border-radius:5px;padding:12px;font-size:12px;font-weight:600;text-decoration:none;margin-bottom:16px}.mobile-roster-link span{color:#fff;font:11px/1.4 var(--font)}.roster-heading{padding:20px}.roster-body{padding:20px}.field input{font-size:16px;min-height:46px}.form-label{font-size:12px}.privacy{font-size:11px}.sidebar-note{font-size:12px}.budget-large{font-size:44px}.footer{flex-direction:column;gap:12px;margin-top:28px;font-size:10px}.success{margin:0;padding:27px 23px}.success h2{font-size:25px}.intro-copy{font-size:13px}}
    @media(max-width:390px){.team-card{grid-template-columns:minmax(0,1fr) 142px;column-gap:7px;padding-left:9px;padding-right:9px}.card-top{gap:6px;flex-wrap:wrap}.card-title{font-size:15px}.card-bottom{gap:7px}.stat{min-width:65px}.stat-value{font-size:24px}.stat-label{font-size:7px}.add-team{min-width:63px;font-size:14px;gap:6px;padding:7px}.sort{width:132px}.search-wrap input{font-size:12px}.filter-label{margin-right:2px}.chip{min-width:34px;padding:5px 7px}.team-number{font-size:10px}.brand-name{font-size:17px}.mobile-roster-link{font-size:11px;padding:11px}.mobile-roster-link span{font-size:10px}}
    @media(max-width:340px){.page{padding-left:12px;padding-right:12px}.header-inner{padding-left:12px;padding-right:12px}.search-row{flex-direction:column}.sort{width:100%}.card-title{font-size:14px}.team-card{grid-template-columns:minmax(0,1fr) 134px}.stat-value{font-size:22px}.add-team{min-width:61px}.rank{font-size:8px}}

    .brand-name{font-weight:650;letter-spacing:-.35px}.brand-sub{font-size:12px;letter-spacing:0;font-weight:400}.season{font-size:12px;font-weight:400;color:var(--muted);letter-spacing:0}.eyebrow{font-size:12px;font-weight:400;letter-spacing:0;color:var(--muted)}h1{font-weight:600;line-height:1.12;letter-spacing:-.7px}.intro-rule strong{font-weight:600}.catalog-heading h2{font-size:16px;font-weight:600;letter-spacing:0}.count{font-size:12px}.chip{font-weight:500}.chip[aria-pressed="true"]{color:#20313d}.team-number{font-weight:500}.card-title{font-weight:600;line-height:1.25}.rank{font-size:11px}.stat-value{font-weight:600;letter-spacing:-.6px;color:var(--ink)}.stat-label{font-weight:400;letter-spacing:.2px}.add-team{font-weight:600}.add-team:not(:disabled):hover,.selected .add-team,.selected .add-team:hover{color:#20313d}.add-team:not(:disabled):hover .plus,.selected .add-team .plus{color:#20313d}.selected .card-reason{color:#cfdfeb}.roster-title-row h2{font-size:16px;font-weight:600;letter-spacing:0}.slots-count{font-size:12px}.budget-large{font-weight:600;color:var(--ink)}.budget-label{font-size:11px;letter-spacing:0;font-weight:400}.budget-track,.budget-fill{border-radius:3px}.roster-slot{border-radius:4px}.slot-number{border:0;color:#c1cfd9}.slot-name{font-weight:600}.form-label{font-weight:600}.submit,.submit:not(:disabled):hover{color:#20313d;font-weight:600}.submit:disabled{color:#d2d8dc}.sidebar-note strong{font-size:12px;font-weight:600;letter-spacing:0}.success-mark{color:#20313d}.success .eyebrow{font-size:12px;color:var(--muted)}.reload-button{font-weight:500}
    @media(max-width:680px){.brand-name{font-weight:600}.season{border:0;padding-left:0;letter-spacing:0}.catalog-heading h2{font-size:16px;letter-spacing:0}.count{font-size:11px}.eyebrow{font-size:11px}.mobile-roster-link,.mobile-roster-link span{color:#20313d}.mobile-roster-link{font-weight:600;background:#a3bed0;border-color:#b7ccda}.card-title{font-weight:600}.rank{font-size:10px}.stat-value{letter-spacing:-.6px}.stat-label{font-size:8px}.success h2{font-weight:600}}
    @media(max-width:390px){.rank{font-size:9px}.stat-label{font-size:8px}.catalog-heading h2{font-size:15px}}
    .team-card{grid-template-columns:minmax(0,1fr) auto}.card-bottom{justify-content:flex-end}
    @media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  </style>
</head>
<body>
  <header class="site-header"><div class="header-inner"><div class="brand"><img class="brand-icon" src="data:image/jpeg;base64,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" width="225" height="225" alt="FIRST Tech Challenge \u2014 San Diego Region"><div><div class="brand-name">San Diego FTC Fantasy League</div><div class="brand-sub">Community fantasy league</div></div></div><div class="season">BioBuzz 2026\u20132027</div></div></header>
  <main class="page">
    <div class="intro"><div><p class="eyebrow">2026\u20132027 season</p><h1>Pick your teams</h1><p class="intro-copy" id="introCopy">Everyone is welcome to join the San Diego FTC Fantasy League! Choose 1\u20133 teams with your $15 fantasy budget. You don\u2019t have to spend it all. Each person may submit only once, even if they select fewer than three teams. We\u2019re using DECODE OPRs because BioBuzz competition hasn\u2019t started yet. After the first BioBuzz meet, the stats will be updated with BioBuzz OPRs.</p></div><div class="intro-rule"><strong>1\u20133 teams \xB7 $15 budget</strong>Teams can be picked by multiple players.</div></div>
    <div id="previewNotice" class="notice" role="status" hidden>Preview \xB7 Team stats are from your uploaded file. Try the team picker; entries will open once Google Sheets is connected.</div>
    <div id="statusNotice" class="notice" role="status" hidden></div>
    <div id="errorNotice" class="notice error" role="alert" hidden></div>
    <div class="layout" id="draftLayout">
      <section class="catalog" aria-labelledby="catalogTitle">
        <div class="catalog-heading"><h2 id="catalogTitle">Team pool</h2><span class="count" id="teamCount">Loading teams\u2026</span></div>
        <button type="button" id="jumpToRoster" class="mobile-roster-link" style="display:none;width:100%">Your roster <span id="mobileRosterCount">0 / 3 teams \xB7 $15 left \u2193</span></button>
        <div class="toolbar">
          <div class="search-row"><div class="search-wrap"><label class="sr-only" for="teamSearch">Search teams by name or number</label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.5 15.5 5 5"></path></svg><input type="search" id="teamSearch" placeholder="Search name or number" autocomplete="off"></div><label class="sr-only" for="sortTeams">Sort teams</label><select id="sortTeams" class="sort"><option value="average">Average OPR \u2193</option><option value="price">Price: low to high</option><option value="number">Team number</option><option value="name">Team name</option></select></div>
          <div class="filter-row"><div class="price-filter" role="group" aria-label="Filter by price"><span class="filter-label">Cost</span><button type="button" class="chip" data-price="all" aria-pressed="true">All</button><button type="button" class="chip" data-price="3" aria-pressed="false">$3</button><button type="button" class="chip" data-price="4" aria-pressed="false">$4</button><button type="button" class="chip" data-price="5" aria-pressed="false">$5</button><button type="button" class="chip" data-price="6" aria-pressed="false">$6</button><button type="button" class="chip" data-price="11" aria-pressed="false">$11</button></div><label class="peak-toggle"><input type="checkbox" id="showHighest">Show highest OPR</label></div>
        </div>
        <div id="teamGrid" class="team-grid"><div class="loading"><span class="loading-dot" aria-hidden="true"></span>Loading the team pool\u2026</div></div>
      </section>
      <aside class="sidebar" id="yourRoster" aria-labelledby="rosterTitle">
        <div class="roster-panel">
          <div class="roster-heading"><div class="roster-title-row"><h2 id="rosterTitle">Your roster</h2><span id="slotsCount" class="slots-count">0 / 3 teams</span></div><div class="budget-row"><div><span class="budget-large" id="budgetRemaining">$15</span><span class="budget-label">Budget left</span></div><div class="budget-spent"><strong id="budgetSpent">$0</strong> / <span id="budgetTotal">$15</span> spent</div></div><div class="budget-track" role="progressbar" id="budgetProgress" aria-label="Draft budget used" aria-valuemin="0" aria-valuemax="15" aria-valuenow="0"><div class="budget-fill" id="budgetFill"></div></div></div>
          <div class="roster-body">
            <ol class="roster-list" id="rosterList"></ol><p class="selection-tip" id="selectionTip">Pick 1 to 3 teams. You don\u2019t have to spend your full budget.</p><hr class="form-divider">
            <form id="draftForm">
              <div class="field"><label class="form-label" for="playerName">Your name <span>*</span></label><input id="playerName" name="playerName" required maxlength="80" autocomplete="name" placeholder="First and last name"></div>
              <div class="field"><label class="form-label" for="playerTeamName">Your FTC team name <span>*</span></label><input id="playerTeamName" name="playerTeamName" required maxlength="80" autocomplete="organization" placeholder="Your FTC team"></div>
              <div class="field"><label class="form-label" for="discordId">Discord ID or username <span>*</span></label><input id="discordId" name="discordId" required maxlength="100" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="@yourusername"><small>Use the account your league organizer knows.</small></div>
              <p id="formMessage" class="form-message" role="alert" hidden></p>
              <button type="submit" class="submit" id="submitDraft" disabled>Choose your teams to continue</button>
              <p class="privacy">Your name, FTC team, Discord ID, and roster go to the league organizer. One entry per Discord ID.</p>
            </form>
          </div>
        </div>
        <p class="sidebar-note"><strong>Draft rules</strong><br>Choose 1\u20133 different teams. Multiple players may select the same team. Draft dollars are fictional; no payment is collected.</p>
      </aside>
    </div>
    <section id="successPanel" class="success" aria-labelledby="successTitle" tabindex="-1" hidden><div class="success-mark" aria-hidden="true">\u2713</div><p class="eyebrow">Roster submitted</p><h2 id="successTitle">Roster received.</h2><p>Your picks have been saved. You\u2019re entered in the league.</p><ul id="successRoster" class="success-roster"></ul><div class="success-total"><span>Draft total</span><span id="successTotal"></span></div><p>Receipt: <span id="receiptId" style="overflow-wrap:anywhere"></span></p><p class="success-footnote">One entry per person. Please don\u2019t submit another roster.</p></section>
    <footer class="footer"><p>Current stats: DECODE OPRs \xB7 OPR estimates scoring contribution. Average and highest OPR are calculated across exported San Diego events.<br>Stats: <a href="https://ftcscout.org/records/2025/teams?region=USCASD" target="_blank" rel="noopener noreferrer">FTCScout</a> \xB7 Team names: <a href="https://ftc-events.firstinspires.org/2025/region/USCASD" target="_blank" rel="noopener noreferrer">FIRST</a></p><p>San Diego FTC Fantasy League<br>Independent community competition<br><a href="/organizer">Organizer</a></p></footer>
    <div id="liveAnnouncement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  </main>
  <script>
    (function () {
      'use strict';
      const el = id => document.getElementById(id);
      const state = {catalog: [], selected: [], budget: 15, maxTeams: 3, priceVersion: '', open: false, loading: true, submitting: false, priceFilter: 'all', preview: false, token: makeToken()};
      const money = value => '$' + Number(value).toLocaleString('en-US', {maximumFractionDigits: 0});
      const opr = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '\u2014' : Number(value).toFixed(2);
      function makeToken() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
          const bytes = new Uint8Array(24); window.crypto.getRandomValues(bytes);
          return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
        }
        return 'draft_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      }
      function node(tag, className, content) {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (content !== undefined) item.textContent = content;
        return item;
      }
      function selectedTeams() { return state.selected.map(id => state.catalog.find(t => t.id === id)).filter(Boolean); }
      function total() { return selectedTeams().reduce((sum, t) => sum + t.price, 0); }
      function announce(message) { el('liveAnnouncement').textContent = message; }
      function message(text) { el('formMessage').textContent = text; el('formMessage').hidden = !text; }
      function normalizeData(data) {
        if (!data || !Array.isArray(data.catalog)) throw new Error('The team list could not be loaded. Please try again.');
        const budget = Number(data.budget), maxTeams = Number(data.maxTeams);
        if (!Number.isFinite(budget) || budget <= 0 || !Number.isInteger(maxTeams) || maxTeams < 1) throw new Error('The draft settings are unavailable. Please contact your organizer.');
        const seen = new Set();
        const catalog = data.catalog.map(t => {
          const id = String(t.id == null ? t.number : t.id);
          const price = t.price === null || t.price === undefined ? null : Number(t.price);
          if (!id || id === 'undefined' || seen.has(id)) throw new Error('The team list needs an organizer update. Please try again later.');
          seen.add(id);
          return {id, number: Number(t.number), name: String(t.name || 'Team ' + t.number), averageOpr: t.averageOpr, highestOpr: t.highestOpr, rank: t.rank, price, available: t.available !== false && Number.isFinite(price) && price > 0};
        }).filter(t => t.available && typeof t.averageOpr === 'number' && Number.isFinite(t.averageOpr));
        return {catalog, budget, maxTeams, open: data.open === true, priceVersion: String(data.priceVersion || '')};
      }
      function receiveData(data) {
        try {
          Object.assign(state, normalizeData(data), {loading: false, preview: data.preview === true});
          el('previewNotice').hidden = !state.preview;
          ['playerName', 'playerTeamName', 'discordId'].forEach(id => { el(id).disabled = state.preview; });
          state.selected = state.selected.filter(id => state.catalog.some(t => t.id === id && t.available));
          el('errorNotice').hidden = true;
          el('introCopy').textContent = 'Everyone is welcome to join the San Diego FTC Fantasy League! Choose 1\u2013' + state.maxTeams + ' teams with your ' + money(state.budget) + ' fantasy budget. You don\u2019t have to spend it all. Each person may submit only once, even if they select fewer than ' + state.maxTeams + ' teams. We\u2019re using DECODE OPRs because BioBuzz competition hasn\u2019t started yet. After the first BioBuzz meet, the stats will be updated with BioBuzz OPRs.';
          el('selectionTip').textContent = 'Pick 1 to ' + state.maxTeams + ' teams. You don\u2019t have to spend your full budget.';
          el('statusNotice').textContent = state.open ? '' : 'The draft is currently closed. You can browse the team pool; entries are not being accepted.';
          el('statusNotice').hidden = state.open;
          renderAll();
        } catch (error) { loadFailed(error); }
      }
      function loadFailed(error) {
        state.loading = false; state.open = false;
        const notice = el('errorNotice'); notice.replaceChildren(node('span', '', error && error.message ? error.message : 'We couldn\u2019t load the draft. Please try again.'));
        const retry = node('button', 'reload-button', 'Try again'); retry.type = 'button'; retry.addEventListener('click', loadData); notice.appendChild(retry); notice.hidden = false;
        el('teamGrid').replaceChildren(node('div', 'empty', 'The team pool is currently unavailable.'));
        el('teamCount').textContent = 'Unable to load teams'; updateSubmit();
      }
      function renderAll() { renderTeams(); renderRoster(); updateSubmit(); }
      function renderTeams() {
        const search = el('teamSearch').value.trim().toLowerCase();
        const filtered = state.catalog.filter(t => (!search || t.name.toLowerCase().includes(search) || String(t.number).includes(search)) && (state.priceFilter === 'all' || t.price === Number(state.priceFilter)));
        const mode = el('sortTeams').value;
        filtered.sort((a, b) => {
          if (a.available !== b.available) return a.available ? -1 : 1;
          if (mode === 'number') return a.number - b.number;
          if (mode === 'name') return a.name.localeCompare(b.name);
          if (mode === 'price') return (a.price ?? Infinity) - (b.price ?? Infinity) || Number(b.averageOpr ?? -Infinity) - Number(a.averageOpr ?? -Infinity);
          return Number(b.averageOpr ?? -Infinity) - Number(a.averageOpr ?? -Infinity) || a.number - b.number;
        });
        el('teamCount').textContent = search || state.priceFilter !== 'all' ? filtered.length + ' teams shown' : state.catalog.length + ' teams available';
        const grid = el('teamGrid'); grid.replaceChildren();
        if (!filtered.length) { const empty = node('div', 'empty'); empty.append(node('strong', '', 'No matching teams.'), node('span', '', 'Try another name, number, or price.')); grid.appendChild(empty); return; }
        const spent = total(), showHighest = el('showHighest').checked;
        filtered.forEach(team => {
          const isSelected = state.selected.includes(team.id);
          const cannotAfford = team.available && team.price + spent > state.budget;
          const full = state.selected.length >= state.maxTeams;
          const card = node('article', 'team-card' + (isSelected ? ' selected' : '') + (!team.available ? ' unavailable' : ''));
          const top = node('div', 'card-top'); top.append(node('span', 'team-number', '#' + team.number), node('span', 'rank', team.available && team.rank ? '#' + team.rank + ' by avg. OPR' : 'No OPR data'));
          card.append(top, node('h3', 'card-title', team.name));
          const bottom = node('div', 'card-bottom');
          const button = node('button', 'add-team'); button.type = 'button'; button.dataset.teamId = team.id;
          button.disabled = state.submitting || !isSelected && (!state.open || !team.available || cannotAfford || full);
          button.setAttribute('aria-pressed', String(isSelected));
          button.setAttribute('aria-label', (isSelected ? 'Remove ' : 'Add ') + team.number + ' ' + team.name + (team.available ? ', ' + money(team.price) : ', unavailable'));
          if (team.available) { button.append(node('span', '', money(team.price)), node('span', 'plus', isSelected ? '\u2212' : '+')); } else button.textContent = 'No data';
          button.addEventListener('click', () => toggleTeam(team.id)); bottom.append(button); card.appendChild(bottom);
          const reason = !team.available ? 'No event OPR available' : isSelected ? 'On your roster' : !state.open ? 'Draft closed' : full ? 'Your roster is full' : cannotAfford ? 'Over remaining budget' : 'Available to draft';
          card.appendChild(node('p', 'card-reason', reason));
          if (showHighest) card.appendChild(node('div', 'peak', 'Highest event OPR: ' + opr(team.highestOpr)));
          grid.appendChild(card);
        });
      }
      function toggleTeam(id) {
        if (state.submitting) return;
        const team = state.catalog.find(t => t.id === id); if (!team) return;
        const isSelected = state.selected.includes(id);
        if (isSelected) { state.selected = state.selected.filter(value => value !== id); announce(team.name + ' removed.'); }
        else {
          if (!state.open || !team.available) return;
          if (state.selected.length >= state.maxTeams) { announce('You can choose up to ' + state.maxTeams + ' teams.'); return; }
          if (total() + team.price > state.budget) { announce('That team would exceed your draft budget.'); return; }
          state.selected.push(id); announce(team.name + ' added. ' + money(state.budget - total()) + ' remaining.');
        }
        message(''); renderAll();
        const nextButton = Array.from(el('teamGrid').querySelectorAll('button[data-team-id]')).find(button => button.dataset.teamId === id);
        if (nextButton && !nextButton.disabled) nextButton.focus({preventScroll: true});
      }
      function renderRoster() {
        const teams = selectedTeams(), spent = total(), remaining = state.budget - spent;
        el('slotsCount').textContent = teams.length + ' / ' + state.maxTeams + ' teams';
        el('budgetRemaining').textContent = money(remaining); el('budgetSpent').textContent = money(spent); el('budgetTotal').textContent = money(state.budget);
        el('budgetFill').style.width = Math.min(100, spent / state.budget * 100) + '%';
        el('budgetProgress').setAttribute('aria-valuemax', String(state.budget)); el('budgetProgress').setAttribute('aria-valuenow', String(spent));
        el('mobileRosterCount').textContent = teams.length + ' / ' + state.maxTeams + ' teams \xB7 ' + money(remaining) + ' left \u2193';
        const list = el('rosterList'); list.replaceChildren();
        for (let i = 0; i < state.maxTeams; i++) {
          const team = teams[i], slot = node('li', 'roster-slot' + (team ? ' filled' : '')); slot.appendChild(node('span', 'slot-number', i + 1));
          if (team) {
            const info = node('div', 'slot-info'); info.append(node('div', 'slot-name', team.name), node('div', 'slot-team', '#' + team.number));
            const remove = node('button', 'remove-team', '\xD7'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove ' + team.name + ' from roster'); remove.disabled = state.submitting;
            remove.addEventListener('click', () => { toggleTeam(team.id); const next = el('rosterList').querySelector('button'); if (next) next.focus({preventScroll:true}); });
            slot.append(info, node('span', 'slot-price', money(team.price)), remove);
          } else slot.appendChild(node('span', 'slot-hint', 'No team selected'));
          list.appendChild(slot);
        }
      }
      function updateSubmit() {
        const button = el('submitDraft'), hasTeams = state.selected.length > 0;
        const fieldsReady = ['playerName', 'playerTeamName', 'discordId'].every(id => el(id).value.trim().length > 0);
        button.disabled = state.loading || state.submitting || !state.open || !hasTeams || !fieldsReady || total() > state.budget || state.selected.length > state.maxTeams || state.preview;
        button.textContent = state.submitting ? 'Submitting your roster\u2026' : state.preview ? 'Preview only \xB7 submissions disabled' : state.loading ? 'Loading the draft\u2026' : !state.open ? 'Draft closed' : !hasTeams ? 'Choose your teams to continue' : !fieldsReady ? 'Add your details to submit' : 'Submit roster \xB7 ' + money(total());
      }
      async function submit(event) {
        event.preventDefault(); if (state.submitting || state.preview || state.loading || !state.open) return;
        if (!el('draftForm').reportValidity()) return;
        const teams = selectedTeams();
        if (teams.length < 1 || teams.length > state.maxTeams || total() > state.budget || teams.some(t => !t.available)) { message('Choose 1 to ' + state.maxTeams + ' available teams within your ' + money(state.budget) + ' budget.'); return; }
        const payload = {playerName: el('playerName').value.trim(), playerTeamName: el('playerTeamName').value.trim(), discordId: el('discordId').value.trim(), teamIds: teams.map(t => t.id), priceVersion: state.priceVersion, submissionToken: state.token};
        if (!payload.playerName || !payload.playerTeamName || !payload.discordId) { message('Please complete all three player details.'); return; }
        if ([payload.playerName, payload.playerTeamName, payload.discordId].some(value => /[\\u0000-\\u001F\\u007F]/.test(value))) { message('Please remove line breaks or hidden control characters from your details.'); return; }
        state.submitting = true; message(''); renderAll();
        ['playerName', 'playerTeamName', 'discordId'].forEach(id => { el(id).disabled = true; });
        try { const result = await api('/api/submit', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); submitted(result, teams); }
        catch (error) { submitFailed(error); }
      }
      function submitFailed(error) {
        state.submitting = false;
        ['playerName', 'playerTeamName', 'discordId'].forEach(id => { el(id).disabled = false; });
        message(error && error.message ? error.message : 'We couldn\u2019t confirm your submission. Keep your selections and try again. Retrying won\u2019t create a second entry.');
        renderAll(); el('formMessage').scrollIntoView({behavior:'smooth', block:'nearest'}); announce('Your roster was not confirmed. Please read the submission message.');
      }
      function submitted(result, teams) {
        if (!result || result.ok !== true || !result.receiptId) { submitFailed(new Error('We couldn\u2019t confirm your entry. Keep your selections and try again.')); return; }
        state.submitting = false; state.token = makeToken();
        el('draftLayout').hidden = true; el('statusNotice').hidden = true;
        const list = el('successRoster'); list.replaceChildren();
        const returnedIds = Array.isArray(result.teamIds) ? result.teamIds.map(String) : teams.map(t => t.id);
        returnedIds.forEach(id => { const team = state.catalog.find(t => t.id === id); if (!team) return; const row = node('li', ''); row.append(node('span', '', '#' + team.number + ' \xB7 ' + team.name), node('strong', '', money(team.price))); list.appendChild(row); });
        el('receiptId').textContent = result.receiptId;
        el('successTotal').textContent = money(result.total) + ' / ' + money(state.budget);
        el('successPanel').hidden = false; el('successPanel').focus(); el('successPanel').scrollIntoView({behavior:'smooth',block:'start'});
        ['playerName', 'playerTeamName', 'discordId'].forEach(id => { el(id).value = ''; });
        announce('Your roster was submitted. You\u2019re entered in the league.');
      }
      async function api(path, options) {
        const response = await fetch(path, {...options, cache:'no-store'});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'The request could not be completed. Please try again.');
        return data;
      }
      async function loadData() {
        state.loading = true; el('errorNotice').hidden = true; updateSubmit();
        try { receiveData(await api('/api/draft')); } catch (error) { loadFailed(error); }
      }
      el('teamSearch').addEventListener('input', renderTeams); el('sortTeams').addEventListener('change', renderTeams); el('showHighest').addEventListener('change', renderTeams);
      document.querySelectorAll('button[data-price]').forEach(button => button.addEventListener('click', () => { state.priceFilter = button.dataset.price; document.querySelectorAll('button[data-price]').forEach(chip => chip.setAttribute('aria-pressed', String(chip === button))); renderTeams(); }));
      ['playerName', 'playerTeamName', 'discordId'].forEach(id => el(id).addEventListener('input', updateSubmit));
      el('jumpToRoster').addEventListener('click', () => el('yourRoster').scrollIntoView({behavior:'smooth',block:'start'}));
      el('draftForm').addEventListener('submit', submit); renderRoster(); loadData();
    }());
  <\/script>
</body>
</html>

`;

// server/organizer.mjs
var organizer_default = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Organizer \xB7 San Diego FTC Fantasy League</title><style>
:root{color-scheme:dark;--bg:#202326;--surface:#292d31;--ink:#f3f0e8;--muted:#c0c2c2;--line:#4a5055;--accent:#92b5ce}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 'Segoe UI',system-ui,sans-serif}a{color:#b7d1e3;text-underline-offset:3px}header{border-bottom:1px solid var(--line);background:#24282c}header>div,main{max-width:1160px;margin:auto;padding:24px}header>div{display:flex;justify-content:space-between;gap:20px;align-items:center}h1{font-size:30px;letter-spacing:-.6px;margin:6px 0}h2{font-size:19px;margin:0 0 12px}p{color:var(--muted);margin:6px 0 20px}.label{font-size:12px;color:var(--muted)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:24px 0}.panel{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:22px}.number{font-size:40px;font-weight:600;line-height:1.1;margin:10px 0 18px}button{font:600 14px/1.4 inherit;min-height:44px;border:1px solid var(--accent);border-radius:5px;padding:10px 16px;background:var(--accent);color:#20313d;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.secondary{color:var(--ink);background:transparent;border-color:var(--line)}button:focus-visible,a:focus-visible{outline:3px solid #b7d1e3;outline-offset:3px}.actions{display:flex;flex-wrap:wrap;gap:10px}.notice{padding:16px;border:1px solid #7c7961;background:#38382f;border-radius:5px;margin:20px 0}.error{color:#ffdcaa}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th{font-size:11px;font-weight:600;color:var(--muted)}th,td{padding:14px 12px;border-bottom:1px solid var(--line);vertical-align:top}td{overflow-wrap:anywhere}td:first-child{min-width:150px}td:nth-child(4){min-width:220px}[hidden]{display:none!important}.empty{text-align:center;padding:36px;color:var(--muted)}footer{margin-top:24px;color:var(--muted);font-size:12px}@media(max-width:650px){.grid{grid-template-columns:1fr}main,header>div{padding:18px}header>div{align-items:flex-start;flex-direction:column}h1{font-size:25px}}
</style></head><body><header><div><div><span class="label">San Diego FTC Fantasy League</span><h1>League organizer</h1></div><a href="/">Back to the draft</a></div></header><main>
<p>Manage entries and draft availability. Participant details are visible only to the organizer.</p>
<div id="message" role="status" class="notice" hidden></div>
<div class="grid"><section class="panel"><h2>Draft status</h2><div class="number" id="status">Checking\u2026</div><p id="statusDetail">Loading your league.</p><div class="actions"><button id="toggle" disabled>Open draft</button><button class="secondary" id="refresh">Refresh</button></div></section><section class="panel"><h2>Entries</h2><div class="number" id="count">\u2014</div><p>Responses save to your existing private Google Sheet.</p><a id="sheet" hidden target="_blank" rel="noopener noreferrer">Open response spreadsheet \u2197</a></section></div>
<section class="panel" id="connection" hidden><h2>Connect your existing Google Sheet</h2><p>The website is ready for your response workbook. Entries stay disabled until the connection has been verified.</p><p>Use the workbook containing the <strong>Catalog</strong>, <strong>Responses</strong>, and <strong>Settings</strong> tabs. Keep it private. The draft will use its frozen prices and existing responses.</p></section>
<section class="notice" id="recovery" hidden><strong>An entry needs a save check.</strong><p>Recovering checks the reserved spreadsheet row and safely completes the same entry if needed.</p><button id="recover" disabled>Check interrupted save</button></section>
<section class="panel"><h2>Submitted rosters</h2><div class="table-wrap"><table><thead><tr><th>Player</th><th>FTC team</th><th>Discord contact</th><th>Picks</th><th>Total</th><th>Submitted</th></tr></thead><tbody id="entries"></tbody></table></div><p class="empty" id="empty">Loading entries\u2026</p></section><footer>Google Sheets remains your league\u2019s record. Changes made in the spreadsheet appear when you refresh.</footer>
</main><script>
let data=null,busy=false;const $=id=>document.getElementById(id);
function notice(text){$('message').textContent=text;$('message').hidden=!text;}
async function api(options){const response=await fetch('/api/organizer',{cache:'no-store',...options});if(response.status===401)throw new Error('Organizer sign-in is required. Reload the page.');const result=await response.json();if(!response.ok)throw new Error(result.error||'Please try again.');return result;}
function cell(value){const td=document.createElement('td');td.textContent=value;return td;}
function render(){if(!data)return;$('status').textContent=!data.connected?'Not connected':!data.enabled?'Setup pending':data.open?'Open':'Closed';$('statusDetail').textContent=!data.connected?'Connect the response workbook to accept entries.':!data.enabled?'Google Sheets is connected. Submission activation is still pending.':data.open?'Participants can submit their picks.':'The team list is visible; submissions are closed.';$('count').textContent=data.connected?data.entries.length:'\u2014';$('connection').hidden=data.connected;$('toggle').disabled=busy||!data.connected||!data.enabled;$('toggle').textContent=data.open?'Close draft':'Open draft';$('sheet').hidden=!data.workbookUrl;if(data.workbookUrl)$('sheet').href=data.workbookUrl;$('recovery').hidden=!data.pending;$('recover').disabled=busy||!data.pending?.canRecover;$('entries').replaceChildren();data.entries.forEach(e=>{const tr=document.createElement('tr');tr.append(cell(e.playerName),cell(e.playerTeamName),cell(e.discordId),cell(e.teams.map(t=>'#'+t.number+' '+t.name).join(' \xB7 ')),cell('$'+e.total),cell(new Date(e.submittedAt).toLocaleString()));$('entries').append(tr);});$('empty').hidden=data.entries.length>0;$('empty').textContent=data.connected?'No entries yet.':'Entries will appear after Google Sheets is connected.';}
async function load(){try{data=await api();render();}catch(e){notice(e.message);$('status').textContent='Unavailable';}}
async function act(payload){busy=true;render();notice('');try{await api({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});await load();}catch(e){notice(e.message);}finally{busy=false;render();}}
$('toggle').addEventListener('click',()=>act({action:'setOpen',open:!data.open}));$('recover').addEventListener('click',()=>act({action:'recover'}));$('refresh').addEventListener('click',()=>{notice('');load();});load();
<\/script></body></html>
`;

// server/catalog.mjs
var catalog_default = [{ "id": "10809", "number": 10809, "name": "Crow Force", "averageOpr": 102.63224593582704, "highestOpr": 148.91824495149575, "rank": 1, "price": 11, "available": true }, { "id": "19743", "number": 19743, "name": "Definitely Human", "averageOpr": 94.51138405128852, "highestOpr": 111.84396958311333, "rank": 2, "price": 11, "available": true }, { "id": "24730", "number": 24730, "name": "Rust-eze Robotics", "averageOpr": 89.00451187008817, "highestOpr": 124.66990349461291, "rank": 3, "price": 11, "available": true }, { "id": "31862", "number": 31862, "name": "SEGFAULT", "averageOpr": 87.29921856106644, "highestOpr": 123.48556286414026, "rank": 4, "price": 11, "available": true }, { "id": "18142", "number": 18142, "name": "Fusion", "averageOpr": 77.64053680115089, "highestOpr": 113.25207520554738, "rank": 5, "price": 11, "available": true }, { "id": "26013", "number": 26013, "name": "Bengal Bots", "averageOpr": 75.00897047090223, "highestOpr": 110.06179660392071, "rank": 6, "price": 6, "available": true }, { "id": "12499", "number": 12499, "name": "Gear Up", "averageOpr": 74.7597236952329, "highestOpr": 94.72052341017923, "rank": 7, "price": 6, "available": true }, { "id": "24664", "number": 24664, "name": "RoBusted", "averageOpr": 71.20520329303892, "highestOpr": 83.73109788506444, "rank": 8, "price": 6, "available": true }, { "id": "23673", "number": 23673, "name": "Mech-A-Mind", "averageOpr": 67.91022204628423, "highestOpr": 90.07825557994532, "rank": 9, "price": 6, "available": true }, { "id": "3650", "number": 3650, "name": "Limited Liability", "averageOpr": 67.03050610138585, "highestOpr": 81.88610048813345, "rank": 10, "price": 6, "available": true }, { "id": "23997", "number": 23997, "name": "Catalysts", "averageOpr": 62.68387367922065, "highestOpr": 106.57862882070657, "rank": 11, "price": 6, "available": true }, { "id": "14535", "number": 14535, "name": "Alpacas", "averageOpr": 60.71136068324929, "highestOpr": 68.54049919154674, "rank": 12, "price": 6, "available": true }, { "id": "11212", "number": 11212, "name": "The Clueless", "averageOpr": 60.691430534835504, "highestOpr": 89.83961640750302, "rank": 13, "price": 6, "available": true }, { "id": "32159", "number": 32159, "name": "Flight Risk", "averageOpr": 59.34712953925394, "highestOpr": 68.29525644486827, "rank": 14, "price": 6, "available": true }, { "id": "15097", "number": 15097, "name": "Python", "averageOpr": 59.29267287034912, "highestOpr": 81.34218476434309, "rank": 15, "price": 6, "available": true }, { "id": "26235", "number": 26235, "name": "RoboGenesis", "averageOpr": 55.80391107565381, "highestOpr": 87.68690609787912, "rank": 16, "price": 6, "available": true }, { "id": "22105", "number": 22105, "name": "Runtime Terror", "averageOpr": 55.208180761807434, "highestOpr": 100.33016687772964, "rank": 17, "price": 6, "available": true }, { "id": "5131", "number": 5131, "name": "Pointers", "averageOpr": 55.05481660772447, "highestOpr": 86.38746023942497, "rank": 18, "price": 6, "available": true }, { "id": "32811", "number": 32811, "name": "Pineapple Power", "averageOpr": 52.660933302238035, "highestOpr": 82.51284201841464, "rank": 19, "price": 6, "available": true }, { "id": "8380", "number": 8380, "name": "UC Robotics", "averageOpr": 50.19872959789925, "highestOpr": 72.51284830141218, "rank": 20, "price": 6, "available": true }, { "id": "4262", "number": 4262, "name": "Ridgebots", "averageOpr": 46.19235304741705, "highestOpr": 64.45140650070418, "rank": 21, "price": 6, "available": true }, { "id": "7609", "number": 7609, "name": "Lions", "averageOpr": 45.92892865540631, "highestOpr": 54.32354336809035, "rank": 22, "price": 5, "available": true }, { "id": "31420", "number": 31420, "name": "Turtles In a Box", "averageOpr": 44.48214141762146, "highestOpr": 60.968711499378145, "rank": 23, "price": 5, "available": true }, { "id": "9266", "number": 9266, "name": "Pyrobots", "averageOpr": 42.83657770481202, "highestOpr": 66.05534802740371, "rank": 24, "price": 5, "available": true }, { "id": "18263", "number": 18263, "name": "HIGH VOLTAGE", "averageOpr": 42.55089855912101, "highestOpr": 55.2379721300476, "rank": 25, "price": 5, "available": true }, { "id": "23280", "number": 23280, "name": "C.A.R.T", "averageOpr": 41.32745436527598, "highestOpr": 55.463856735181416, "rank": 26, "price": 5, "available": true }, { "id": "8097", "number": 8097, "name": "Botcats", "averageOpr": 40.50407007141625, "highestOpr": 66.10319598279668, "rank": 27, "price": 5, "available": true }, { "id": "24142", "number": 24142, "name": "Steel Vengeance", "averageOpr": 39.86577812806308, "highestOpr": 46.910949548775285, "rank": 28, "price": 5, "available": true }, { "id": "18365", "number": 18365, "name": "Dapper RoboNoodles", "averageOpr": 38.36789181954942, "highestOpr": 57.795249412740695, "rank": 29, "price": 5, "available": true }, { "id": "14968", "number": 14968, "name": "Matador Mechanics", "averageOpr": 37.90013059933423, "highestOpr": 49.06604531607669, "rank": 30, "price": 5, "available": true }, { "id": "23676", "number": 23676, "name": "Bumblebee", "averageOpr": 37.7086718855187, "highestOpr": 52.90961492992394, "rank": 31, "price": 5, "available": true }, { "id": "4216", "number": 4216, "name": "Rise of Hephaestus", "averageOpr": 37.05452462926303, "highestOpr": 46.8959383815905, "rank": 32, "price": 5, "available": true }, { "id": "24218", "number": 24218, "name": "BurritoBot", "averageOpr": 36.30212017299341, "highestOpr": 53.689045959741804, "rank": 33, "price": 5, "available": true }, { "id": "22567", "number": 22567, "name": "xBots", "averageOpr": 35.64300897644681, "highestOpr": 45.74706087966065, "rank": 34, "price": 5, "available": true }, { "id": "7159", "number": 7159, "name": "Robo Ravens", "averageOpr": 35.49549231193132, "highestOpr": 51.853191265192876, "rank": 35, "price": 5, "available": true }, { "id": "5015", "number": 5015, "name": "Buffalo Wings", "averageOpr": 35.44694966267715, "highestOpr": 57.81905940531244, "rank": 36, "price": 5, "available": true }, { "id": "31973", "number": 31973, "name": "International Robotics Squad (IRS)", "averageOpr": 35.06470645187992, "highestOpr": 44.43822571605836, "rank": 37, "price": 5, "available": true }, { "id": "31222", "number": 31222, "name": "Quantum Robotics", "averageOpr": 34.14881116998781, "highestOpr": 38.538577207125314, "rank": 38, "price": 5, "available": true }, { "id": "12778", "number": 12778, "name": "Tech Empire", "averageOpr": 32.14059969000963, "highestOpr": 37.840918997656814, "rank": 39, "price": 5, "available": true }, { "id": "31800", "number": 31800, "name": "Control Alt Defeat", "averageOpr": 31.235367936013404, "highestOpr": 37.04878371853881, "rank": 40, "price": 5, "available": true }, { "id": "13084", "number": 13084, "name": "Robot Raiders", "averageOpr": 30.88947940451539, "highestOpr": 49.75754506958866, "rank": 41, "price": 5, "available": true }, { "id": "14338", "number": 14338, "name": 'CAOS Robotics ("Chaos")', "averageOpr": 29.310189047289878, "highestOpr": 49.35783264701554, "rank": 42, "price": 5, "available": true }, { "id": "32122", "number": 32122, "name": "SpyderX", "averageOpr": 28.8724722716657, "highestOpr": 37.27186530325743, "rank": 43, "price": 4, "available": true }, { "id": "31622", "number": 31622, "name": "Rayvolution", "averageOpr": 28.771100292086988, "highestOpr": 44.170316130630894, "rank": 44, "price": 4, "available": true }, { "id": "24111", "number": 24111, "name": "Coyote CODEX", "averageOpr": 27.360381288947092, "highestOpr": 39.19039029937993, "rank": 45, "price": 4, "available": true }, { "id": "24029", "number": 24029, "name": "CocoNuts & Bolts", "averageOpr": 27.158573518576077, "highestOpr": 44.69823642810799, "rank": 46, "price": 4, "available": true }, { "id": "32158", "number": 32158, "name": "Thousand Screws Aloose", "averageOpr": 26.973285714468023, "highestOpr": 40.54124799284918, "rank": 47, "price": 4, "available": true }, { "id": "6226", "number": 6226, "name": "Bambusa", "averageOpr": 26.165190180896317, "highestOpr": 43.63084551066271, "rank": 48, "price": 4, "available": true }, { "id": "6016", "number": 6016, "name": "Ironwolves", "averageOpr": 26.008765635097852, "highestOpr": 38.10311715890798, "rank": 49, "price": 4, "available": true }, { "id": "27602", "number": 27602, "name": "Apex Dynamics", "averageOpr": 25.41005757194995, "highestOpr": 34.93433350772283, "rank": 50, "price": 4, "available": true }, { "id": "23696", "number": 23696, "name": "Kinematic Flying Chickens", "averageOpr": 24.81393527039108, "highestOpr": 30.842156564715943, "rank": 51, "price": 4, "available": true }, { "id": "3848", "number": 3848, "name": "Shockwave", "averageOpr": 24.675926542126966, "highestOpr": 34.507986606991025, "rank": 52, "price": 4, "available": true }, { "id": "32210", "number": 32210, "name": "BMMS Engineers", "averageOpr": 24.35641919824184, "highestOpr": 29.025179062427654, "rank": 53, "price": 4, "available": true }, { "id": "13089", "number": 13089, "name": "E T Brigade", "averageOpr": 22.827236206359256, "highestOpr": 47.70353852662767, "rank": 54, "price": 4, "available": true }, { "id": "9892", "number": 9892, "name": "EngiNERDs", "averageOpr": 22.64160579938236, "highestOpr": 42.88031963028226, "rank": 55, "price": 4, "available": true }, { "id": "27600", "number": 27600, "name": "Robot Revolution", "averageOpr": 22.026753010051983, "highestOpr": 30.940247428384918, "rank": 56, "price": 4, "available": true }, { "id": "9164", "number": 9164, "name": "Zorrobots", "averageOpr": 21.170184638379048, "highestOpr": 28.176162453915776, "rank": 57, "price": 4, "available": true }, { "id": "9049", "number": 9049, "name": "RoboPuffs", "averageOpr": 20.699644214171837, "highestOpr": 24.758704269136356, "rank": 58, "price": 4, "available": true }, { "id": "11285", "number": 11285, "name": "PATENT PENDING", "averageOpr": 20.657957295062754, "highestOpr": 23.686148589809797, "rank": 59, "price": 4, "available": true }, { "id": "26982", "number": 26982, "name": "Sentinel", "averageOpr": 20.476549797777814, "highestOpr": 44.047054495656575, "rank": 60, "price": 4, "available": true }, { "id": "32420", "number": 32420, "name": "Hot Pink Hypothesis", "averageOpr": 20.208388065749, "highestOpr": 31.883731924834077, "rank": 61, "price": 4, "available": true }, { "id": "24312", "number": 24312, "name": "Engineering Gear Giants", "averageOpr": 19.184602697925833, "highestOpr": 26.525530679751455, "rank": 62, "price": 4, "available": true }, { "id": "22321", "number": 22321, "name": "Holy Calves", "averageOpr": 19.06126884662637, "highestOpr": 25.229104336248415, "rank": 63, "price": 4, "available": true }, { "id": "20355", "number": 20355, "name": "Keep It Simple 2", "averageOpr": 18.322771071504135, "highestOpr": 32.278711956116, "rank": 64, "price": 3, "available": true }, { "id": "28644", "number": 28644, "name": "Colt- Robotics", "averageOpr": 18.02229379680901, "highestOpr": 24.587124166840688, "rank": 65, "price": 3, "available": true }, { "id": "8606", "number": 8606, "name": "RSF Intergalactic Dragons", "averageOpr": 17.869376316332794, "highestOpr": 18.827539324216463, "rank": 66, "price": 3, "available": true }, { "id": "32482", "number": 32482, "name": "Tungsten Titans", "averageOpr": 17.16383959225647, "highestOpr": 27.550599424154264, "rank": 67, "price": 3, "available": true }, { "id": "22529", "number": 22529, "name": "RoboGOATs", "averageOpr": 16.77034495457481, "highestOpr": 24.863170832449832, "rank": 68, "price": 3, "available": true }, { "id": "1622", "number": 1622, "name": "Team Spyder", "averageOpr": 16.299882923476396, "highestOpr": 28.100900607633964, "rank": 69, "price": 3, "available": true }, { "id": "10793", "number": 10793, "name": "Voltrons", "averageOpr": 16.25698422408821, "highestOpr": 21.932084764642703, "rank": 70, "price": 3, "available": true }, { "id": "30556", "number": 30556, "name": "T3rm!n@tor", "averageOpr": 16.158227860758114, "highestOpr": 26.393574040074206, "rank": 71, "price": 3, "available": true }, { "id": "31139", "number": 31139, "name": "Safety Hazard", "averageOpr": 16.089138391604042, "highestOpr": 18.572278911032512, "rank": 72, "price": 3, "available": true }, { "id": "26471", "number": 26471, "name": "Steady State", "averageOpr": 15.20614720170044, "highestOpr": 21.764203878840277, "rank": 73, "price": 3, "available": true }, { "id": "32005", "number": 32005, "name": "State Machine", "averageOpr": 13.81622788788086, "highestOpr": 21.385590398920588, "rank": 74, "price": 3, "available": true }, { "id": "24041", "number": 24041, "name": "Solid State", "averageOpr": 13.598908521769717, "highestOpr": 20.815093777904146, "rank": 75, "price": 3, "available": true }, { "id": "32007", "number": 32007, "name": "State Space", "averageOpr": 13.542403996790316, "highestOpr": 16.58684300601756, "rank": 76, "price": 3, "available": true }, { "id": "32627", "number": 32627, "name": "Iron Assassins", "averageOpr": 12.49333439194758, "highestOpr": 19.288210827582315, "rank": 77, "price": 3, "available": true }, { "id": "6565", "number": 6565, "name": "Mechanical Meatloaf", "averageOpr": 11.71169686528026, "highestOpr": 15.992443071182741, "rank": 78, "price": 3, "available": true }, { "id": "32689", "number": 32689, "name": "MTM", "averageOpr": 10.376437602758704, "highestOpr": 14.943928760419416, "rank": 79, "price": 3, "available": true }, { "id": "31742", "number": 31742, "name": "Super Nova", "averageOpr": 10.288467881385303, "highestOpr": 18.74784274621223, "rank": 80, "price": 3, "available": true }, { "id": "20422", "number": 20422, "name": "Team Spyder Too", "averageOpr": 9.369688544199857, "highestOpr": 14.028302732864702, "rank": 81, "price": 3, "available": true }, { "id": "30622", "number": 30622, "name": "Rebel Dolphins", "averageOpr": 8.787875294094695, "highestOpr": 24.03931467018863, "rank": 82, "price": 3, "available": true }, { "id": "26637", "number": 26637, "name": "Circuit Crawlers", "averageOpr": 8.202035049931258, "highestOpr": 13.410232132879237, "rank": 83, "price": 3, "available": true }, { "id": "33418", "number": 33418, "name": "State Pattern", "averageOpr": 5.5847968634117615, "highestOpr": 11.38658428980787, "rank": 84, "price": 3, "available": true }, { "id": "26852", "number": 26852, "name": "Team Hope", "averageOpr": null, "highestOpr": null, "rank": null, "price": null, "available": false }, { "id": "27521", "number": 27521, "name": "Pineapple Power", "averageOpr": null, "highestOpr": null, "rank": null, "price": null, "available": false }, { "id": "31996", "number": 31996, "name": "Autonomous Edge", "averageOpr": null, "highestOpr": null, "rank": null, "price": null, "available": false }];

// server/rules.mjs
var DraftError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var title = "San Diego FTC Fantasy League";
var budget = 15;
var maxTeams = 3;
async function sha256(text) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function cleanCell(value) {
  return String(value ?? "").replace(/^'(?=\s*[=+\-@])/, "");
}
function safeCell(value) {
  const t = String(value);
  return /^\s*[=+\-@]/.test(t) ? "'" + t : t;
}
async function catalogVersion(catalog) {
  const canonical = catalog.map((t) => ({ id: t.id, number: t.number, name: cleanCell(t.name), averageOpr: t.averageOpr === null ? null : Number(t.averageOpr.toFixed(6)), highestOpr: t.highestOpr === null ? null : Number(t.highestOpr.toFixed(6)), rank: t.rank, price: t.price, available: t.available }));
  return "v1-" + (await sha256(JSON.stringify(canonical))).slice(0, 24);
}
function required(value, label, max) {
  if (typeof value !== "string") throw new DraftError("Enter " + label + ".");
  const s = value.trim();
  if (!s || s.length > max || /[\u0000-\u001f\u007f]/.test(s)) throw new DraftError(label + " is required and must be at most " + max + " characters on one line.");
  return s;
}
function normalizeSubmission(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new DraftError("Invalid submission.");
  const playerName = required(p.playerName, "your name", 80), playerTeamName = required(p.playerTeamName, "FTC team name", 80), discordId = required(p.discordId, "Discord username or ID", 100), discordKey = discordId.replace(/^@/, "").toLowerCase();
  if (!discordKey) throw new DraftError("Enter your Discord username or ID.");
  if (typeof p.submissionToken !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(p.submissionToken)) throw new DraftError("Invalid submission token. Reload and try again.");
  if (typeof p.priceVersion !== "string" || !/^v1-[a-f0-9]{24}$/.test(p.priceVersion)) throw new DraftError("The team list is out of date. Reload and review your picks.");
  if (!Array.isArray(p.teamIds) || p.teamIds.length < 1 || p.teamIds.length > 3) throw new DraftError("Select one to three teams.");
  const teamIds = p.teamIds.map((id) => {
    if (typeof id !== "string" || !/^[1-9][0-9]{0,8}$/.test(id)) throw new DraftError("A selected team is invalid.");
    return id;
  }).sort((a, b) => Number(a) - Number(b));
  if (new Set(teamIds).size !== teamIds.length) throw new DraftError("Select each team only once.");
  return { playerName, playerTeamName, discordId, discordKey, teamIds, priceVersion: p.priceVersion, submissionToken: p.submissionToken };
}
function validateRoster(ids, catalog) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length) throw new DraftError("Choose one to three different teams.");
  const teams = ids.map((id) => {
    const t = catalog.find((t2) => t2.id === id);
    if (!t || !t.available || ![3, 4, 5, 6, 11].includes(t.price)) throw new DraftError("A selected team is unavailable. Review your picks.");
    return t;
  });
  const total = teams.reduce((n, t) => n + t.price, 0);
  if (total > 15) throw new DraftError("Your picks cost $" + total + ". The budget is $15.");
  return { teams, total };
}
function receipt(row) {
  return { ok: true, receiptId: String(row[1]), total: Number(row[18]), remaining: Number(row[19]), teamIds: [row[9], row[12], row[15]].filter((x) => x !== "" && x !== void 0).map(String), priceVersion: String(row[4]) };
}
function existingReceipt(rows, input, fingerprint) {
  for (const r of rows) if (String(r[2]) === input.submissionToken) {
    if (String(r[3]) !== fingerprint) throw new DraftError("This submission token was already used. Reload before making a different entry.", 409);
    return receipt(r);
  }
  return null;
}
async function parseState(catalogRows, settingsRows) {
  if (catalogRows.length !== 87) throw new DraftError("The draft catalog needs organizer attention.", 503);
  const seen = /* @__PURE__ */ new Set();
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const catalog = catalogRows.map((r) => {
    const available = r[7] === true, t = { id: String(r[0]), number: Number(r[1]), name: cleanCell(r[2]), averageOpr: available ? r[3] : null, highestOpr: available ? r[4] : null, rank: available ? r[5] : null, price: available ? r[6] : null, available };
    if (!Number.isInteger(t.number) || t.number < 1 || t.id !== String(t.number) || seen.has(t.id) || !t.name.trim() || available && (!finite(t.averageOpr) || !finite(t.highestOpr) || !Number.isInteger(t.rank) || t.rank < 1 || t.rank > 84 || ![3, 4, 5, 6, 11].includes(t.price))) throw new DraftError("The draft catalog needs organizer attention.", 503);
    seen.add(t.id);
    return t;
  });
  if (catalog.filter((t) => t.available).length !== 84) throw new DraftError("The draft catalog needs organizer attention.", 503);
  const settings = Object.fromEntries(settingsRows.map((r) => [String(r[0]), r[1]])), priceVersion = String(settings["Price version"]);
  if (priceVersion !== await catalogVersion(catalog) || Number(settings.Budget) !== 15 || Number(settings["Max teams"]) !== 3) throw new DraftError("The draft catalog changed after pricing. Please contact the organizer.", 503);
  return { title, budget, maxTeams, catalog, priceVersion, open: settings.Open === true };
}

// server/sheets.mjs
var cachedToken = null;
var encoder = new TextEncoder();
var b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
var encodeJson = (value) => b64(encoder.encode(JSON.stringify(value)));
function configured(env) {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON && env.RESPONSES_SHEET_ID);
}
async function accessToken(env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (cachedToken?.raw === raw && cachedToken.expires > Date.now() + 6e4) return cachedToken.token;
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new DraftError("The Google connection needs organizer attention.", 503);
  }
  if (typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") throw new DraftError("The Google connection needs organizer attention.", 503);
  const now = Math.floor(Date.now() / 1e3);
  const unsigned = encodeJson({ alg: "RS256", typ: "JWT" }) + "." + encodeJson({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const pem = credentials.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const assertion = unsigned + "." + b64(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned))));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(15e3) });
  if (!response.ok) throw new DraftError("The Google connection needs organizer attention.", 503);
  const data = await response.json();
  if (!data.access_token) throw new DraftError("The Google connection needs organizer attention.", 503);
  cachedToken = { raw, token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1e3 };
  return cachedToken.token;
}
var Sheets = class {
  constructor(env) {
    this.env = env;
    if (!/^[A-Za-z0-9_-]{20,150}$/.test(env.RESPONSES_SHEET_ID || "")) throw new DraftError("The response spreadsheet is not connected yet.", 503);
  }
  async request(path, options = {}) {
    const token = await accessToken(this.env);
    const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(this.env.RESPONSES_SHEET_ID) + path, { ...options, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, signal: AbortSignal.timeout(2e4) });
    if (!r.ok) {
      if (r.status === 401) cachedToken = null;
      throw new DraftError(r.status === 429 ? "Google Sheets is busy. Please try again shortly." : "Google Sheets could not complete the request. Please contact the organizer.", 503);
    }
    return r.json();
  }
  async values(range) {
    const r = await this.request("/values/" + encodeURIComponent(range) + "?valueRenderOption=UNFORMATTED_VALUE");
    return r.values || [];
  }
  async state() {
    const r = await this.request("/values:batchGet?ranges=" + encodeURIComponent("Catalog!A2:H88") + "&ranges=" + encodeURIComponent("Settings!A2:B9") + "&valueRenderOption=UNFORMATTED_VALUE");
    return parseState(r.valueRanges?.[0]?.values || [], r.valueRanges?.[1]?.values || []);
  }
  async responses() {
    const rows = await this.values("Responses!A:T");
    if (!rows.length || rows[0][0] !== "Submitted at UTC" || rows[0][2] !== "Submission token" || rows[0][19] !== "Budget remaining") throw new DraftError("The response sheet columns need organizer attention.", 503);
    return rows;
  }
  async update(range, values) {
    return this.request("/values/" + encodeURIComponent(range) + "?valueInputOption=RAW", { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) });
  }
};

// server/submission.mjs
var LOCK = "draft";
async function acquire(db) {
  if (!db) throw new DraftError("The draft is not ready. Please contact the organizer.", 503);
  const owner = crypto.randomUUID();
  const r = await db.prepare("INSERT OR IGNORE INTO write_locks (name,owner,started_at) VALUES (?,?,?)").bind(LOCK, owner, Date.now()).run();
  return r.meta.changes ? owner : null;
}
async function lockState(db) {
  return db.prepare("SELECT * FROM write_locks WHERE name=?").bind(LOCK).first();
}
async function release(db, owner) {
  await db.prepare("DELETE FROM write_locks WHERE name=? AND owner=?").bind(LOCK, owner).run();
}
async function recoverCheckpoint(db, sheets, lock) {
  const checkpoint = JSON.parse(lock.checkpoint);
  const { range, row } = checkpoint;
  const current = (await sheets.values(range))[0] || [];
  if (current.some((v) => v !== "" && v !== null && v !== void 0)) {
    if (String(current[2]) !== String(row[2]) || String(current[3]) !== String(row[3]) || String(current[1]) !== String(row[1])) throw new DraftError("A response row changed during saving. The organizer must review it before accepting more entries.", 409);
    if (JSON.stringify(Array.from({ length: 20 }, (_, i) => String(current[i] ?? ""))) !== JSON.stringify(row.map((v) => String(v)))) throw new DraftError("A saved response was edited. The organizer must review it before retrying.", 409);
  } else {
    await sheets.update(range, [row]);
  }
  await release(db, lock.owner);
  return receipt(row);
}
async function submitDraft(payload, { db, sheets, enabled }) {
  if (!enabled) throw new DraftError("Submissions are not enabled yet. Please contact the organizer.", 503);
  const input = normalizeSubmission(payload), fingerprint = await sha256(JSON.stringify(input));
  const owner = await acquire(db);
  if (!owner) {
    const lock = await lockState(db);
    if (lock?.checkpoint) {
      const c = JSON.parse(lock.checkpoint);
      if (c.row[2] === input.submissionToken) {
        if (c.row[3] !== fingerprint) throw new DraftError("Keep the same details when retrying this submission.", 409);
        return recoverCheckpoint(db, sheets, lock);
      }
    }
    throw new DraftError("Another entry is being saved. Please try again in a few seconds.", 409);
  }
  let checkpointed = false;
  try {
    const state = await sheets.state(), allRows = await sheets.responses(), rows = allRows.slice(1);
    const prior = existingReceipt(rows, input, fingerprint);
    if (prior) return prior;
    if (!state.open) throw new DraftError("The draft is closed. Please contact the organizer.", 409);
    if (input.priceVersion !== state.priceVersion) throw new DraftError("The team list changed. Reload and review your picks.", 409);
    const discordHash = await sha256(input.discordKey);
    if (rows.some((r2) => String(r2[8]) === discordHash)) throw new DraftError("An entry already exists for this Discord contact. Contact the organizer to review or change your entry.", 409);
    const roster = validateRoster(input.teamIds, state.catalog);
    const row = [(/* @__PURE__ */ new Date()).toISOString(), crypto.randomUUID(), input.submissionToken, fingerprint, state.priceVersion, safeCell(input.playerName), safeCell(input.playerTeamName), safeCell(input.discordId), discordHash];
    for (let i = 0; i < 3; i++) {
      const t = roster.teams[i];
      row.push(t ? t.number : "", t ? safeCell(t.name) : "", t ? t.price : "");
    }
    row.push(roster.total, 15 - roster.total);
    const range = "Responses!A" + (allRows.length + 1) + ":T" + (allRows.length + 1);
    const r = await db.prepare("UPDATE write_locks SET checkpoint=? WHERE name=? AND owner=?").bind(JSON.stringify({ range, row }), LOCK, owner).run();
    if (!r.meta.changes) throw new DraftError("The submission was interrupted. Please try again.", 409);
    checkpointed = true;
    return await recoverCheckpoint(db, sheets, { owner, checkpoint: JSON.stringify({ range, row }) });
  } finally {
    if (!checkpointed) await release(db, owner);
  }
}
async function setOpen(open, { db, sheets }) {
  const owner = await acquire(db);
  if (!owner) throw new DraftError("An entry is being processed. Try again shortly.", 409);
  try {
    await sheets.state();
    await sheets.update("Settings!B2", [[open]]);
    return { ok: true, open };
  } finally {
    await release(db, owner);
  }
}
async function recoverWrite({ db, sheets }) {
  const lock = await lockState(db);
  if (!lock) return { ok: true, message: "No interrupted submission." };
  if (Date.now() - lock.started_at < 12e4) throw new DraftError("An entry is still processing. Wait two minutes before recovery.", 409);
  if (lock.checkpoint) return recoverCheckpoint(db, sheets, lock);
  await release(db, lock.owner);
  return { ok: true, message: "Interrupted validation cleared. The participant may retry." };
}

// server/auth.mjs
async function isOrganizer(request, env, context = {}) {
  if (context.sites) return Boolean(context.user?.userId && env.ORGANIZER_EMAIL && context.user.email?.toLowerCase() === env.ORGANIZER_EMAIL.toLowerCase());
  if (typeof env.ADMIN_PASSWORD !== "string" || env.ADMIN_PASSWORD.length < 24) return false;
  try {
    const h = request.headers.get("Authorization") || "";
    if (!h.startsWith("Basic ")) return false;
    const value = atob(h.slice(6)), i = value.indexOf(":");
    if (i < 0 || value.slice(0, i) !== "organizer") return false;
    return await sha256(value.slice(i + 1)) === await sha256(env.ADMIN_PASSWORD);
  } catch {
    return false;
  }
}

// server/handler.mjs
var headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" };
function json(data, status = 200) {
  return Response.json(data, { status, headers });
}
function html(data) {
  return new Response(data, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
async function body(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DraftError("Send JSON.", 415);
  if (Number(request.headers.get("content-length")) > 8192) throw new DraftError("Request too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DraftError("Invalid JSON.");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 8192) {
      await reader.cancel();
      throw new DraftError("Request too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DraftError("Invalid JSON.");
  }
}
function requireOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) throw new DraftError("Reload the website before submitting.", 403);
}
async function handle(request, env, context = {}) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === "POST") requireOrigin(request);
    if (path === "/" && request.method === "GET") return html(page_default);
    if (path === "/api/draft" && request.method === "GET") {
      if (!configured(env)) return json({ title, budget, maxTeams, open: true, preview: true, priceVersion: "PREVIEW", catalog: catalog_default });
      const state = await new Sheets(env).state();
      return json({ ...state, open: state.open && env.SUBMISSIONS_ENABLED === "true", preview: false });
    }
    if (path === "/api/submit" && request.method === "POST") {
      if (!configured(env)) throw new DraftError("Google Sheets is not connected yet. No entry has been saved.", 503);
      return json(await submitDraft(await body(request), { db: env.DB, sheets: new Sheets(env), enabled: env.SUBMISSIONS_ENABLED === "true" }));
    }
    if (path === "/organizer" || path === "/api/organizer") {
      if (!await isOrganizer(request, env, context)) {
        if (context.sites && path === "/organizer" && !context.user) return Response.redirect(new URL("/signin-with-chatgpt?return_to=%2Forganizer", request.url), 302);
        return new Response("Organizer access required.", { status: 401, headers: { ...headers, ...!context.sites ? { "WWW-Authenticate": 'Basic realm="League organizer", charset="UTF-8"' } : {} } });
      }
      if (path === "/organizer" && request.method === "GET") return html(organizer_default);
      if (path === "/api/organizer" && request.method === "GET") {
        if (!configured(env)) return json({ connected: false, enabled: false, entries: [], message: "Connect the existing response workbook to enable the league." });
        const sheets = new Sheets(env), state = await sheets.state(), rows = await sheets.responses(), lock = env.DB ? await lockState(env.DB) : null;
        return json({ connected: true, enabled: env.SUBMISSIONS_ENABLED === "true", open: state.open, workbookUrl: "https://docs.google.com/spreadsheets/d/" + env.RESPONSES_SHEET_ID + "/edit", teamCount: state.catalog.length, availableCount: state.catalog.filter((t) => t.available).length, priceVersion: state.priceVersion, pending: lock ? { startedAt: lock.started_at, canRecover: Date.now() - lock.started_at >= 12e4 } : null, entries: rows.slice(1).filter((r) => r[1]).map((r) => ({ submittedAt: r[0], receiptId: r[1], playerName: cleanCell(r[5]), playerTeamName: cleanCell(r[6]), discordId: cleanCell(r[7]), teams: [9, 12, 15].filter((i) => r[i]).map((i) => ({ number: r[i], name: cleanCell(r[i + 1]), price: r[i + 2] })), total: r[18] })) });
      }
      if (path === "/api/organizer" && request.method === "POST") {
        if (!configured(env)) throw new DraftError("Connect Google Sheets first.", 503);
        const p = await body(request), deps = { db: env.DB, sheets: new Sheets(env) };
        if (p.action === "setOpen" && typeof p.open === "boolean") return json(await setOpen(p.open, deps));
        if (p.action === "recover") return json(await recoverWrite(deps));
        throw new DraftError("Unknown organizer action.");
      }
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    return json({ error: error instanceof DraftError ? error.message : "The request could not be completed. Please try again or contact the organizer." }, error instanceof DraftError ? error.status : 503);
  }
}

// cloudflare/worker.mjs
var worker_default = { fetch(request, env) {
  return handle(request, env);
} };
export {
  worker_default as default
};
