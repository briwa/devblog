---
title: A tiny Vue toy
tags: vue, figures
---

The `preview` tag works on `vue` figures too. This little counter is tagged, so
it rides along as the entry's cover.

```vue 320x200 preview
<template>
  <button class="btn" @click="n++">Clicked {{ n }} times</button>
</template>
<script>
export default { data: () => ({ n: 0 }) };
</script>
<style scoped>
.btn {
  font: 600 16px system-ui;
  padding: 12px 20px;
  border-radius: 10px;
  border: 0;
  background: #6366f1;
  color: #fff;
  cursor: pointer;
}
.btn:hover { background: #4f46e5; }
</style>
```

Same rule everywhere: one `preview` token, and the figure leads.
