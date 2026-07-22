---
title: "Orbiting particles, and picking a cover"
tags: "canvas, figures, meta"
updated: 2026-07-14T00:01:05.000Z
---

Every entry on the home page shows a cover: the first figure or image it can
find. Usually that's exactly what you want. Sometimes it isn't — the opening
image is a diagram, but the *interesting* thing is further down.

Here's the opening image the old logic would have grabbed for the cover:

![A quiet landscape](https://picsum.photos/seed/orbit-intro/800/500)

The real star of this entry is the figure below. Because its fence is tagged
`preview`, it wins the cover slot even though the image above comes first.

```js canvas preview
let t = 0;
loop(() => {
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 80; i++) {
    const a = t + i * 0.35;
    const r = 30 + i * 1.7;
    const x = width / 2 + Math.cos(a) * r;
    const y = height / 2 + Math.sin(a * 1.2) * r * 0.6;
    ctx.fillStyle = `hsl(${(i * 4 + t * 50) % 360} 80% 62%)`;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  t += 0.015;
});
```

Add `preview` to any figure fence — `js`, `canvas`, `svg`, `root`, or `vue` —
and that figure becomes the entry's cover.
