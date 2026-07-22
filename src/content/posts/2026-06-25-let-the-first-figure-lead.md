---
title: Let the first figure lead
tags: canvas, figures
---

When nothing is tagged, the cover falls back to the old behaviour: the first
figure or image in the entry, whichever comes first. No ceremony required — most
entries never need to think about it.

```js canvas 640x360 auto
let t = 0;
loop(() => {
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#4fd1c5";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 4) {
    const y = height / 2 + Math.sin(x * 0.02 + t) * 60 * Math.sin(t * 0.5);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  t += 0.03;
});
```

The wave above leads, so it's the cover. The image down here is just supporting
material and stays out of the running:

![A reference photo](https://picsum.photos/seed/first-figure/800/500)
