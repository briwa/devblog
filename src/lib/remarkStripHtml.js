// Build-time remark plugin: drop every raw-HTML node from an entry's markdown,
// so authored prose renders as Markdown *only* — no inline or block HTML.
//
// Why: Astro passes raw HTML in markdown straight through to the output
// (remark-rehype with allowDangerousHtml), so a `<script>` — or any markup — in a
// post would execute in a reader's browser. Removing it at the source is simpler
// and stricter than a CSP: the only executable surface left is the interactive
// code-fence figures, which already run sandboxed in null-origin iframes (see
// remarkSandbox.js / sandbox.js).
//
// In CommonMark both inline (`<b>`, `<script>`) and block-level raw HTML parse to
// mdast `html` nodes, so filtering that one type covers both. Surrounding text is
// kept — `foo <b>bar</b> baz` becomes `foo bar baz`.
//
// ORDERING: this MUST run before remarkSandbox in the plugin list. remarkSandbox
// emits its figure markup as `html` nodes, so it has to add them *after* this
// strip pass — otherwise the figures would be stripped too.
export function remarkStripHtml() {
  return (tree) => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children = node.children.filter((c) => c.type !== 'html');
      for (const child of node.children) walk(child);
    };
    walk(tree);
  };
}
