// Automated acceptance sweep across every published Bitcoin Universe documentation site.
//
// Checks only what can be verified over HTTP without a browser. It deliberately
// reports what it could NOT check, so the output is not mistaken for a full
// accessibility or performance pass.

const SITES = [
  ['central portal', 'https://docs.bitcoinuniverse.io/'],
  ...[
    'brc-20', 'runes', 'src-20', 'src-101', 'op-return', 'mezcal', 'alkanes',
    'atomicals-and-arc-20', 'tap', 'tap-on-doge', 'block-20', 'dust-20',
    'op-drop', 'ordex', 'chainbloom', 'patina', 'witness-circles', 'tandem',
    'docs-wallet', 'docs-core', 'docs-inscribe', 'docs-stampdex',
    'forked-felines-docs', 'drops-protocol-docs',
  ].map((r) => [r, `https://bitcoinuniverseio.github.io/${r}/`]),
];

const EM_DASH = '—';

async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    return { status: res.status, text: res.status === 200 ? await res.text() : '' };
  } catch (error) {
    return { status: 0, text: '', error: error.message };
  }
}

async function statusOf(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return res.status;
  } catch {
    return 0;
  }
}

function check(html) {
  const title = (html.match(/<title>([^<]*)<\/title>/) ?? [, ''])[1].trim();
  const desc = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ?? [, ''])[1];
  const og = /property=["']og:(title|image|description)["']/i.test(html);
  const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
  const lang = /<html[^>]*\slang=/i.test(html);
  const skip = /skip[- ]to[- ](main|content)|class=["'][^"']*skip/i.test(html);
  const imgs = (html.match(/<img\b[^>]*>/gi) ?? []);
  const imgsNoAlt = imgs.filter((t) => !/\balt=/i.test(t)).length;
  const svgTitled = (html.match(/<svg\b[^>]*>[\s\S]{0,400}?<title>/gi) ?? []).length;
  const svgs = (html.match(/<svg\b/gi) ?? []).length;
  const emDash = (html.match(new RegExp(EM_DASH, 'g')) ?? []).length;
  const canonicalWord = (html.replace(/rel=["']canonical["']/gi, '').match(/\bcanonical\b/gi) ?? []).length;
  const placeholder = (html.match(/\b(coming soon|lorem ipsum|TBD)\b/gi) ?? []).length;
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  return {
    title, descLen: desc.length, og, h1, lang, skip,
    imgsNoAlt, svgs, svgTitled, emDash, canonicalWord, placeholder, viewport,
  };
}

const rows = [];
for (const [name, base] of SITES) {
  const { status, text, error } = await fetchText(base);
  if (status !== 200) {
    rows.push({ name, base, status, error: error ?? 'not 200' });
    continue;
  }
  const c = check(text);
  const [notFound, llms, robots, sitemap, manifest] = await Promise.all([
    statusOf(new URL('this-page-does-not-exist-xyz', base).href),
    statusOf(new URL('llms.txt', base).href),
    statusOf(new URL('robots.txt', base).href),
    statusOf(new URL('sitemap.xml', base).href).then((s) =>
      s === 200 ? s : statusOf(new URL('sitemap-index.xml', base).href),
    ),
    statusOf(new URL('docs.manifest.json', base).href),
  ]);
  rows.push({ name, base, status, ...c, notFound, llms, robots, sitemap, manifest, bytes: text.length });
}

const pad = (v, n) => String(v).padEnd(n);
console.log('\n=== STRUCTURE AND STYLE ===');
console.log(pad('site', 24), pad('http', 5), pad('h1', 3), pad('lang', 5), pad('skip', 5), pad('og', 3), pad('desc', 5), pad('emdash', 7), pad('canon', 6), pad('placeh', 7), 'noalt');
for (const r of rows) {
  if (r.status !== 200) { console.log(pad(r.name, 24), pad(r.status, 5), '  <-- ' + (r.error ?? '')); continue; }
  console.log(
    pad(r.name, 24), pad(r.status, 5), pad(r.h1, 3), pad(r.lang ? 'yes' : 'NO', 5),
    pad(r.skip ? 'yes' : 'no', 5), pad(r.og ? 'yes' : 'NO', 3), pad(r.descLen, 5),
    pad(r.emDash || '.', 7), pad(r.canonicalWord || '.', 6), pad(r.placeholder || '.', 7), r.imgsNoAlt || '.',
  );
}

console.log('\n=== MACHINE READABLE AND ERROR HANDLING ===');
console.log(pad('site', 24), pad('404', 5), pad('llms', 5), pad('robots', 7), pad('sitemap', 8), pad('manifest', 9), 'homepage bytes');
for (const r of rows) {
  if (r.status !== 200) continue;
  console.log(
    pad(r.name, 24), pad(r.notFound, 5), pad(r.llms, 5), pad(r.robots, 7),
    pad(r.sitemap, 8), pad(r.manifest, 9), r.bytes,
  );
}

const live = rows.filter((r) => r.status === 200);
const down = rows.filter((r) => r.status !== 200);
const style = live.filter((r) => r.emDash || r.canonicalWord || r.placeholder);
const noH1 = live.filter((r) => r.h1 !== 1);
const noLlms = live.filter((r) => r.llms !== 200);
const noSitemap = live.filter((r) => r.sitemap !== 200);
const bad404 = live.filter((r) => r.notFound !== 404);

console.log('\n=== SUMMARY ===');
console.log(`live: ${live.length} of ${rows.length}`);
if (down.length) console.log(`NOT SERVING: ${down.map((r) => r.name).join(', ')}`);
console.log(`style violations: ${style.length ? style.map((r) => r.name).join(', ') : 'none'}`);
console.log(`not exactly one h1: ${noH1.length ? noH1.map((r) => `${r.name}(${r.h1})`).join(', ') : 'none'}`);
console.log(`missing llms.txt: ${noLlms.length ? noLlms.map((r) => r.name).join(', ') : 'none'}`);
console.log(`missing sitemap: ${noSitemap.length ? noSitemap.map((r) => r.name).join(', ') : 'none'}`);
console.log(`404 not returning 404: ${bad404.length ? bad404.map((r) => `${r.name}(${r.notFound})`).join(', ') : 'none'}`);
console.log('\nNOT CHECKED HERE: 320px reflow, keyboard journeys, colour contrast, reduced motion,');
console.log('200% zoom, Lighthouse performance, cross browser behaviour. Those need a real browser.');
