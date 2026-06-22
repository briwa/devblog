// CodeMirror extension: recognize ```js canvas|svg|d3 fences in the source
// editor and give each an inline "Show preview / Show code" toggle — the same
// toggle the published page has, but live inside the editor.
//
// Default is CODE (the block stays editable, with a "Show preview" bar above it),
// because in the editor you're usually working on the code. Flip a block to
// preview and its source range is REPLACED by a block widget holding the same
// sandboxed, self-sizing iframe the published page renders (built by the shared
// buildSrcdoc). The code text stays in the document the whole time — preview is
// purely a display swap — so saving is unaffected.
//
// Preview state is tracked per block by its index among the sandbox blocks in
// document order (a Set in a StateField). Index is stable for the common case;
// adding/removing a sandbox block *above* an open preview can mis-target it
// until the next toggle — an acceptable edge for a single-author editor.

import { Decoration, EditorView, WidgetType, ViewPlugin } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { buildSrcdoc, findSandboxBlocks } from "./sandbox.js";

// Toggle block #i between preview and code. Carries the block's index.
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

// The running figure that replaces a block in preview mode.
class PreviewWidget extends WidgetType {
  constructor(block, index) { super(); this.block = block; this.index = index; }
  // Reuse the existing DOM (don't reload the iframe) unless the code, preset,
  // size, or index actually changed — so editing elsewhere never restarts a
  // running animation.
  eq(o) {
    const a = this.block, b = o.block;
    return this.index === o.index && a.code === b.code && a.preset === b.preset && a.w === b.w && a.h === b.h;
  }
  toDOM(view) {
    const fig = document.createElement("figure");
    fig.className = "sandbox cm-sandbox";
    fig.dataset.preset = this.block.preset;
    const stage = document.createElement("div");
    stage.className = "sandbox-stage";
    const iframe = document.createElement("iframe");
    iframe.className = "sandbox-frame";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.title = `live ${this.block.preset} preview`;
    iframe.srcdoc = buildSrcdoc(this.block, this.block.code);
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

// The "Show preview" bar shown above an editable (code-mode) sandbox block.
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

function buildDecorations(state) {
  const previews = state.field(previewField);
  const blocks = findSandboxBlocks(state.doc.toString());
  const ranges = [];
  blocks.forEach((b, i) => {
    // Only decorate a *closed* block; an unterminated fence being typed would
    // otherwise extend to the doc end and swallow everything below it.
    if (!b.closed) return;
    if (previews.has(i)) {
      ranges.push(Decoration.replace({ widget: new PreviewWidget(b, i), block: true }).range(b.from, b.to));
    } else {
      ranges.push(Decoration.widget({ widget: new CodeBar(b.preset, i), side: -1, block: true }).range(b.from));
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

// Size each preview iframe to its content (frames can't size themselves): every
// frame postMessages its height (see buildSrcdoc); match it by contentWindow and
// then ask CodeMirror to remeasure, since a block widget's height just changed.
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
