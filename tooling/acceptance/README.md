# acceptance sweep

Checks every published documentation site in the estate over HTTP and prints what
is missing.

```bash
node tooling/acceptance/sweep.mjs
```

It reports, per site: HTTP status, heading structure, `lang`, skip link, Open
Graph tags, meta description length, images without alt text, em dash count, uses
of the word this organization does not use in prose, placeholder text, and
whether `llms.txt`, `robots.txt`, a sitemap, `docs.manifest.json`, and a real 404
are reachable.

## What it deliberately does not check

Reflow at 320 pixels, keyboard journeys, colour contrast, reduced motion, 200
percent zoom, Lighthouse performance, and cross browser behaviour. Those need a
real browser, and the sweep prints that caveat every run so its output is never
mistaken for a full accessibility or performance pass.

## Why it exists

Two style rules in the organization's instructions were being broken across the
estate and nobody noticed, because nothing was looking. The first run found three
sites shipping an em dash in the homepage title, one site using the forbidden word
ten times, six sites with no `llms.txt`, and seven with no sitemap. A rule that
nothing measures is a rule that quietly stops being true.
