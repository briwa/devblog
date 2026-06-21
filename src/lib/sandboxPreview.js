// CodeMirror extension giving each sandbox fence an inline preview/code toggle.
// Default is code (you're usually editing); flipping to preview replaces the
// source range with a widget — the code text stays in the doc, so saving is
// unaffected. Preview state is keyed by block index in document order.

import { Decoration, EditorView, WidgetType, ViewPlugin } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { buildSrcdoc, buildVueSrcdoc, findSandboxBlocks, sandboxPrelude, sandboxExternals, sandboxVueComponents } from "./sandbox.js";

const togglePreview = StateEffect.define();

// Which sandbox blocks (by index) are currently showing their preview.
const previewField = StateField.define({
  create() { return new Set(); },
  update(set, tr) {
    let next = set;
    for (const e of tr.effects) {
      if (e.is(togglePreview)) {
        next = new Set(next);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
      }
    }
    return next;
  },
});

// The running figure that replaces a block in preview mode. Handed a pre-built
// srcdoc, so it stays agnostic to figure type.
class PreviewWidget extends WidgetType {
  constructor(srcdoc, index, preset) { super(); this.srcdoc = srcdoc; this.index = index; this.preset = preset; }
  // Reuse the DOM unless the srcdoc changed, so editing elsewhere never restarts
  // a running animation but editing this figure rebuilds it.
  eq(o) { return this.index === o.index && this.preset === o.preset && this.srcdoc === o.srcdoc; }
  toDOM(view) {
    const fig = document.createElement("figure");
    fig.className = "sandbox cm-sandbox";
    fig.dataset.preset = this.preset;
    const stage = document.createElement("div");
    stage.className = "sandbox-stage";
    const iframe = document.createElement("iframe");
    iframe.className = "sandbox-frame";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.title = `live ${this.preset} preview`;
    iframe.srcdoc = this.srcdoc;
    stage.appendChild(iframe);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sandbox-toggle";
    btn.textContent = "Show code";
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
    btn.addEventListener("click", () => view.dispatch({ effects: togglePreview.of(this.index) }));
    fig.append(stage, btn);
    return fig;
  }
  // Don't let CodeMirror treat clicks inside the widget as editor input.
  ignoreEvent() { return true; }
}

class CodeBar extends WidgetType {
  constructor(preset, index) { super(); this.preset = preset; this.index = index; }
  eq(o) { return o.index === this.index && o.preset === this.preset; }
  toDOM(view) {
    const bar = document.createElement("div");
    bar.className = "cm-sandbox-bar";
    const tag = document.createElement("span");
    tag.className = "cm-sandbox-tag";
    tag.textContent = this.preset;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-sandbox-show";
    btn.textContent = "Show preview";
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => view.dispatch({ effects: togglePreview.of(this.index) }));
    bar.append(tag, btn);
    return bar;
  }
  ignoreEvent() { return true; }
}

// A lib/external-lib block has no preview to flip to, so it stays editable with
// just a non-interactive tag marking what it is.
class LibBar extends WidgetType {
  constructor(index, label = "lib") { super(); this.index = index; this.label = label; }
  eq(o) { return o.index === this.index && o.label === this.label; }
  toDOM() {
    const bar = document.createElement("div");
    bar.className = "cm-sandbox-bar";
    const tag = document.createElement("span");
    tag.className = "cm-sandbox-tag";
    tag.textContent = this.label;
    bar.append(tag);
    return bar;
  }
  ignoreEvent() { return true; }
}

function buildDecorations(state) {
  const previews = state.field(previewField);
  const blocks = findSandboxBlocks(state.doc.toString());
  const ranges = [];
  blocks.forEach((b, i) => {
    // Only decorate a closed block; an unterminated fence would swallow everything below.
    if (!b.closed) return;
    if (b.snippet) {
      ranges.push(Decoration.widget({ widget: new LibBar(i), side: -1, block: true }).range(b.from));
    } else if (b.external) {
      ranges.push(Decoration.widget({ widget: new LibBar(i, "external-lib"), side: -1, block: true }).range(b.from));
    } else if (b.vueLib) {
      ranges.push(Decoration.widget({ widget: new LibBar(i, "vue lib"), side: -1, block: true }).range(b.from));
    } else if (previews.has(i)) {
      // Build the srcdoc exactly as the published page would, from this figure's group.
      const externals = sandboxExternals(blocks, b.id);
      const srcdoc = b.vue
        ? buildVueSrcdoc(b, b.code, { externals, components: sandboxVueComponents(blocks, b.id) })
        : buildSrcdoc(b, b.code, sandboxPrelude(blocks, b.id), externals);
      ranges.push(Decoration.replace({ widget: new PreviewWidget(srcdoc, i, b.preset), block: true }).range(b.from, b.to));
    } else {
      ranges.push(Decoration.widget({ widget: new CodeBar(b.vue ? "vue" : b.preset, i), side: -1, block: true }).range(b.from));
    }
  });
  return Decoration.set(ranges, true);
}

const decorationField = StateField.define({
  create(state) { return buildDecorations(state); },
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(togglePreview))) return buildDecorations(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Size each preview iframe to its content (frames can't size themselves): match
// the postMessaged height by contentWindow, then ask CodeMirror to remeasure.
const resizePlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.onMessage = (e) => {
        const h = e.data && e.data.__sandboxHeight;
        if (typeof h !== "number" || h <= 0) return; // ignore a hidden frame's 0
        for (const f of view.dom.querySelectorAll(".cm-sandbox iframe")) {
          if (f.contentWindow === e.source) {
            f.style.height = h + "px";
            view.requestMeasure();
            break;
          }
        }
      };
      window.addEventListener("message", this.onMessage);
    }
    destroy() { window.removeEventListener("message", this.onMessage); }
  }
);

export function sandboxPreview() {
  // previewField first: decorationField reads it during (re)builds.
  return [previewField, decorationField, resizePlugin];
}
