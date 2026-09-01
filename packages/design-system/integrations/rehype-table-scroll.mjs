// Wraps every Markdown table in a keyboard-focusable scroll region, so a
// table wider than a phone screen can be scrolled without a pointer and
// passes WCAG 2.1 keyboard checks (axe: scrollable-region-focusable).
//
// Each region is named after the heading it sits under. Naming them all
// "Table, scrollable" made every landmark on a page identical, which axe
// reports as landmark-unique and which is worse than the rule sounds: a
// screen reader listing the landmarks on the status page announced two
// regions with the same name and no way to tell which held what. Five pages
// carry more than one table.
export default function rehypeTableScroll() {
  return function transform(tree) {
    const used = new Set();
    walk(tree, { heading: null, used });
  };
}

function walk(node, state) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === 'element' && /^h[1-6]$/.test(child.tagName)) {
      state.heading = textOf(child).trim() || null;
      return child;
    }
    // Expressive Code promotes a code block that overflows into a focusable
    // landmark at runtime, and gives it no name, so two overflowing code
    // blocks on one page are two indistinguishable landmarks. Its own check
    // is `getAttribute("tabindex") !== null`, so a block that already says it
    // is focusable is left alone.
    //
    // A code block is not a region of the page, and every one of them in the
    // landmark list is noise even when named. Focusable is what the scroll
    // needs; group carries the label without claiming to be page structure.
    // Where the block does not overflow, Expressive Code strips the tabindex
    // and role again, which is the right outcome: nothing to scroll, nothing
    // to focus.
    if (child.type === 'element' && child.tagName === 'pre' && child.properties?.dataLanguage) {
      child.properties.tabIndex = 0;
      child.properties.role = 'group';
      child.properties.ariaLabel = codeLabel(child, state);
      return child;
    }
    if (child.type === 'element' && child.tagName === 'table') {
      return {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['table-scroll'],
          tabIndex: 0,
          role: 'region',
          ariaLabel: label(state),
        },
        children: [child],
      };
    }
    walk(child, state);
    return child;
  });
}

// "Table, scrollable" alone where there is no heading to borrow from, and a
// numeric suffix only where a page really does repeat one, so the common
// case reads naturally.
function label(state) {
  const base =
    state.heading === null ? 'Table, scrollable' : `${state.heading}, scrollable table`;
  return unique(base, state);
}

function unique(base, state) {
  if (!state.used.has(base)) {
    state.used.add(base);
    return base;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!state.used.has(candidate)) {
      state.used.add(candidate);
      return candidate;
    }
  }
}

// "bash code under Checking it yourself", so a reader who lands on one knows
// what it belongs to before reading it out.
function codeLabel(node, state) {
  const language = node.properties?.dataLanguage;
  const kind = typeof language === 'string' && language !== '' ? `${language} code` : 'Code';
  return unique(state.heading === null ? kind : `${kind} under ${state.heading}`, state);
}

function textOf(node) {
  if (node.type === 'text') return node.value ?? '';
  if (!node.children) return '';
  return node.children.map(textOf).join('');
}
