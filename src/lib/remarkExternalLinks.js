// Open external links (http/https) in a new tab; the icon is added in CSS via a[target="_blank"].
// rel guards the new tab against window.opener access and referrer leakage.
export function remarkExternalLinks() {
  return (tree) => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child.type === 'link' && /^https?:\/\//i.test(child.url || '')) {
          child.data ??= {};
          child.data.hProperties = { ...child.data.hProperties, target: '_blank', rel: 'noopener noreferrer' };
        }
        walk(child);
      }
    };
    walk(tree);
  };
}
