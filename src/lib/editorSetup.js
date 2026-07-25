// The language-agnostic code-editing services shared by the Markdown editor (EntryEditor) and
// the code-fence editor (SandboxModal). Keeping them here means both surfaces get the same
// indent/history/close-bracket UX and can't drift apart (the sandbox once silently lacked closeBrackets).
// What legitimately differs between the two — language, highlight palette, theme, bracket-match
// highlighting, and their own plugins (sandbox previews, code folding) — stays in each editor.
import { EditorView, keymap } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, indentMore, indentLess } from "@codemirror/commands";
import { indentUnit, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

// Tab indents whole lines only when there's a selection; a bare cursor inserts an indent unit
// inline, so mid-line Tab lands where the cursor is instead of jumping to the line start.
const tabIndent = ({ state, dispatch }) => {
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore({ state, dispatch });
  dispatch(state.update(state.replaceSelection(state.facet(indentUnit)), { scrollIntoView: true, userEvent: "input" }));
  return true;
};

// Base keybindings both editors share; each may spread extra bindings alongside these.
export const codeKeybindings = [...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, { key: "Tab", run: tabIndent, shift: indentLess }];

// The shared services as one extension list. Pass extra keybindings (e.g. foldKeymap) to merge
// into the shared keymap so an editor's own keys sit next to the common ones.
export function codeServices(extraKeys = []) {
  return [
    history(),
    EditorView.lineWrapping,
    indentUnit.of("  "),
    indentOnInput(),
    closeBrackets(),
    keymap.of([...codeKeybindings, ...extraKeys]),
  ];
}
