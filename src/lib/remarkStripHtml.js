// Drop every raw-HTML node from an entry's markdown: Astro passes raw HTML through
// (allowDangerousHtml), so a `<script>` in a post would execute in a reader's browser.
// Both inline and block raw HTML parse to mdast `html` nodes, so one filter covers both.
// MUST run before remarkSandbox, which emits its figures as `html` nodes.
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
