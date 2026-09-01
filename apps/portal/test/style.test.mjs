// House style, enforced rather than remembered.
//
// Two rules are stated in the organization's instructions and were being broken
// across the estate anyway, because a rule that lives only in a brief gets lost
// the moment someone writes a page in a hurry. These run in CI.
//
//  1. No em dash character, anywhere. Use commas, colons, periods, parentheses.
//  2. Never the word "canonical" in prose. Say authoritative, owning, official,
//     or the source of truth. The HTML attribute rel="canonical" is required
//     markup and is allowed.
//
// A third check catches the failure mode those rules exist to prevent: filler
// that promises instead of documenting.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(here, '..', 'src')];

const EM_DASH = '—';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|md|mdx|ts|js|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = roots.flatMap((root) => walk(root));
const problems = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = path.relative(path.join(here, '..'), file);

  text.split('\n').forEach((line, index) => {
    const where = `${rel}:${index + 1}`;

    if (line.includes(EM_DASH)) {
      problems.push(`${where} uses an em dash: ${line.trim().slice(0, 90)}`);
    }

    // Allow the HTML attribute, which is required markup, and nothing else.
    const withoutAttribute = line.replace(/rel=["']canonical["']/g, '');
    if (/canonical/i.test(withoutAttribute)) {
      problems.push(`${where} uses the word "canonical": ${line.trim().slice(0, 90)}`);
    }

    if (/\b(coming soon|TODO|TBD|lorem ipsum)\b/i.test(line)) {
      problems.push(`${where} contains placeholder text: ${line.trim().slice(0, 90)}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`style: ${problems.length} violation(s)\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`style: ${files.length} files clean`);
