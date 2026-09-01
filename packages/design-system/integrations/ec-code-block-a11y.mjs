// Names the code blocks Expressive Code makes focusable.
//
// When a code block is wider than its column, Expressive Code's browser
// script sets `tabindex="0"` and `role="region"` on the `<pre>` so it can be
// scrolled from the keyboard. That part is right. It sets no accessible name
// with it, so every overflowing code block becomes a landmark called nothing,
// and a page with two of them has two landmarks a screen reader cannot tell
// apart. axe reports it as landmark-unique; five pages here carry more than
// one code block, and the API reference carries four.
//
// A code block is not a region of the page, and listing every one of them
// alongside the navigation and the main content is noise even once they are
// named. So each block is marked here, at build time, as a focusable group
// with a name: focusable is what the scroll needs, and group carries the
// label without claiming to be page structure.
//
// Expressive Code's own check is `getAttribute("tabindex") !== null`, so a
// block that already declares itself focusable is left alone. Where a block
// does not overflow, its script strips the tabindex and role again, which is
// the right outcome: nothing to scroll, nothing to focus.
export function codeBlockAccessibility() {
  return {
    name: 'code-block-accessibility',
    hooks: {
      postprocessRenderedBlock: (context) => {
        const pre = findPre(context.renderData.blockAst);
        if (pre === null) return;
        pre.properties = pre.properties ?? {};
        pre.properties.tabIndex = 0;
        pre.properties.role = 'group';
        pre.properties['aria-label'] = nameFor(context.codeBlock);
      },
    },
  };
}

// "bash code, checking availability" where the block has a title, "bash code"
// where it does not. The language is the useful half: it tells a listener
// what they are about to hear before they hear it.
function nameFor(codeBlock) {
  const language = (codeBlock?.language ?? '').trim();
  const title = (codeBlock?.metaOptions?.getString?.('title') ?? '').trim();
  const kind = language === '' || language === 'plaintext' ? 'Code' : `${language} code`;
  return title === '' ? kind : `${kind}, ${title}`;
}

function findPre(node) {
  if (node === null || node === undefined) return null;
  if (node.type === 'element' && node.tagName === 'pre') return node;
  for (const child of node.children ?? []) {
    const found = findPre(child);
    if (found !== null) return found;
  }
  return null;
}
