// CodeMirror extension turning each sandbox block into a self-contained widget that replaces
// the raw source, so a fence is never edited inline — editing happens in a modal:
//   - figures (js/vue + preset): a card (type/bg chips + Show-preview/Edit/Remove); Show
//     preview swaps the card for a running iframe.
//   - lib / external-lib / vue-lib: a card (tag + label + Edit/Remove).
// The code text stays in the doc throughout, so saving is unaffected. State is keyed by
// block index in document order.

import { Decoration, EditorView, WidgetType, ViewPlugin, keymap } from "@codemirror/view";
import { StateField, StateEffect, Prec } from "@codemirror/state";
import { buildSrcdoc, buildVueSrcdoc, findSandboxBlocks, sandboxPrelude, sandboxExternals, sandboxVueComponents } from "./sandbox.js";

const togglePreview = StateEffect.define();

// Which sandbox figures (by index) are currently showing their preview.
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

// Delete a block's whole fence, plus one trailing newline so it leaves no blank gap.
function removeBlock(view, from, to) {
  const doc = view.state.doc;
  let end = to;
  if (end < doc.length && doc.sliceString(end, end + 1) === "\n") end += 1;
  view.dispatch({ changes: { from, to: end, insert: "" } });
  view.focus();
}

// A button that doesn't steal editor focus on press.
function toolBtn(className, label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", onClick);
  return btn;
}

export function sandboxPreview({ onEdit, onCreate } = {}) {
  // Shared Edit/Remove buttons for any block card.
  function editRemove(view, block) {
    return [
      toolBtn("cm-sbx-btn", "Edit", () => onEdit?.(block)),
      toolBtn("cm-sbx-btn danger", "Remove", () => {
        if (window.confirm("Remove this sandbox block?")) removeBlock(view, block.from, block.to);
      }),
    ];
  }

  // The compact card shown when a figure isn't previewing: label + meta chips + actions.
  class SandboxCard extends WidgetType {
    constructor(block, index) { super(); this.block = block; this.index = index; }
    sig() { const b = this.block; return `${b.from}:${b.to}:${b.vue}:${b.preset}:${b.bg}:${b.showCode}:${b.auto}:${b.preview}:${b.id}`; }
    eq(o) { return this.index === o.index && this.sig() === o.sig(); }
    toDOM(view) {
      const b = this.block;
      const card = document.createElement("div");
      card.className = "cm-sbx-card";

      const chips = document.createElement("div");
      chips.className = "cm-sbx-chips";
      const label = document.createElement("span");
      label.className = "cm-sbx-label";
      label.textContent = "sandbox";
      chips.appendChild(label);
      const addChip = (text) => { const c = document.createElement("span"); c.className = "cm-sbx-chip"; c.textContent = text; chips.appendChild(c); };
      addChip(b.vue ? "vue" : "js");
      addChip(b.vue ? "root" : b.preset);
      if (b.id) addChip(`id=${b.id}`);
      if (b.bg) addChip(`bg=${b.bg}`);

      const actions = document.createElement("div");
      actions.className = "cm-sbx-actions";
      actions.append(
        toolBtn("cm-sbx-btn", "Show preview", () => view.dispatch({ effects: togglePreview.of(this.index) })),
        ...editRemove(view, this.block),
      );

      card.append(chips, actions);
      return card;
    }
    ignoreEvent() { return true; }
  }

  // A lib / external-lib / vue-lib block: tag + label + Edit/Remove, no preview.
  class LibCard extends WidgetType {
    constructor(block, index, tag, label) { super(); this.block = block; this.index = index; this.tag = tag; this.label = label; }
    eq(o) { return this.index === o.index && this.tag === o.tag && this.label === o.label && this.block.from === o.block.from && this.block.to === o.block.to; }
    toDOM(view) {
      const card = document.createElement("div");
      card.className = "cm-sbx-card";
      const chips = document.createElement("div");
      chips.className = "cm-sbx-chips";
      const tag = document.createElement("span");
      tag.className = "cm-sbx-chip";
      tag.textContent = this.tag;
      chips.appendChild(tag);
      if (this.label) {
        const lbl = document.createElement("span");
        lbl.className = "cm-sbx-label";
        lbl.textContent = this.label;
        chips.appendChild(lbl);
      }
      const actions = document.createElement("div");
      actions.className = "cm-sbx-actions";
      actions.append(...editRemove(view, this.block));
      card.append(chips, actions);
      return card;
    }
    ignoreEvent() { return true; }
  }

  // The running figure (preview on), with the same Show-code-style actions in a bar.
  class PreviewWidget extends WidgetType {
    constructor(block, srcdoc, index) { super(); this.block = block; this.srcdoc = srcdoc; this.index = index; }
    // Reuse the DOM unless the srcdoc changed, so editing elsewhere never restarts a
    // running animation but editing this figure rebuilds it.
    eq(o) { return this.index === o.index && this.srcdoc === o.srcdoc; }
    toDOM(view) {
      const b = this.block;
      const fig = document.createElement("figure");
      fig.className = "sandbox cm-sandbox";
      fig.dataset.preset = b.vue ? "root" : b.preset;

      const stage = document.createElement("div");
      stage.className = "sandbox-stage";
      const iframe = document.createElement("iframe");
      iframe.className = "sandbox-frame";
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.title = `live ${b.vue ? "vue" : b.preset} preview`;
      iframe.srcdoc = this.srcdoc;
      stage.appendChild(iframe);

      const bar = document.createElement("div");
      bar.className = "cm-sbx-actions cm-sbx-actions-preview";
      bar.append(
        toolBtn("cm-sbx-btn", "Hide preview", () => view.dispatch({ effects: togglePreview.of(this.index) })),
        ...editRemove(view, this.block),
      );

      fig.append(stage, bar);
      return fig;
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
      const replace = (widget) => ranges.push(Decoration.replace({ widget, block: true }).range(b.from, b.to));
      if (b.snippet) {
        replace(new LibCard(b, i, "lib", b.summary));
      } else if (b.external) {
        replace(new LibCard(b, i, "external-lib", b.summary));
      } else if (b.vueLib) {
        replace(new LibCard(b, i, "vue lib", b.componentName || b.summary));
      } else if (previews.has(i)) {
        // Build the srcdoc exactly as the published page would, from this figure's group.
        const externals = sandboxExternals(blocks, b.id);
        const srcdoc = b.vue
          ? buildVueSrcdoc(b, b.code, { externals, components: sandboxVueComponents(blocks, b.id) })
          : buildSrcdoc(b, b.code, sandboxPrelude(blocks, b.id), externals);
        replace(new PreviewWidget(b, srcdoc, i));
      } else {
        replace(new SandboxCard(b, i));
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

  // Size each preview iframe to its content (frames can't size themselves): match the
  // postMessaged height by contentWindow, then ask CodeMirror to remeasure.
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

  // Slash commands on their own line open the matching modal (Prec.high beats the default Enter).
  const COMMANDS = { "/sandbox": "figure", "/sandbox-lib": "external", "/sandbox-source": "source" };
  const slashCommand = Prec.high(keymap.of([{
    key: "Enter",
    run(view) {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const kind = COMMANDS[line.text.trim()];
      if (!kind) return false;
      view.dispatch({ changes: { from: line.from, to: line.to, insert: "" } });
      onCreate?.(kind, line.from);
      return true;
    },
  }]));

  // previewField first: decorationField reads it during (re)builds.
  return [previewField, decorationField, resizePlugin, slashCommand];
}
