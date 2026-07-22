---
title: "Code palette sampler"
tags: "sandbox, colors, demo"
updated: 2026-07-18T15:44:22.000Z
---

A scratch post for eyeballing the code color schemes — flip the **code** picker
(bottom-left, dev only) and watch both the sandbox editor and these published
blocks recolor together. Toggle light/dark from the header to check both.

## A shared helper (`lib` block)

```js lib="tiny helpers" id="sampler"
// Shared into every figure in the "sampler" group.
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
```

## A canvas figure (JS)

```js canvas 480x300 code auto id="sampler"
const dots = Array.from({ length: 60 }, () => ({
  x: rand(0, width),
  y: rand(0, height),
  r: rand(1, 4),
  vx: rand(-0.6, 0.6),
  vy: rand(-0.6, 0.6),
}));

loop((t) => {
  ctx.clearRect(0, 0, width, height);
  for (const d of dots) {
    d.x = (d.x + d.vx + width) % width;
    d.y = (d.y + d.vy + height) % height;
    const hue = (t / 40 + d.x) % 360;
    ctx.beginPath();
    ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.fill();
  }
});
```

## A Vue figure (SFC)

```vue 360x240 code
<template>
  <div class="counter">
    <button @click="count--">−</button>
    <output>{{ count }}</output>
    <button @click="count++">+</button>
    <p :class="{ warn: count < 0 }">{{ label }}</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
const count = ref(0);
const label = computed(() => (count.value < 0 ? 'below zero' : 'looking good'));
</script>

<style scoped>
.counter { display: grid; gap: 0.5rem; place-items: center; font-family: system-ui; }
button { width: 2.2rem; height: 2.2rem; font-size: 1.2rem; cursor: pointer; }
output { font-size: 2rem; font-variant-numeric: tabular-nums; }
.warn { color: #d9534f; }
</style>
```

## Plain fenced code

Ordinary fences highlight through the same palette.

```js
export function debounce(fn, ms = 200) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}
```

```html
<figure class="card" data-mode="preview">
  <img src="/uploads/hero.png" alt="A hero image" loading="lazy" />
  <figcaption>Caption text &amp; a <a href="#">link</a>.</figcaption>
</figure>
```

```css
:root {
  --accent: #b1442e;
}
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgb(0 0 0 / 12%);
}
```

That's the full spread: shared lib, a JS canvas, a Vue SFC, and plain JS / HTML / CSS.
