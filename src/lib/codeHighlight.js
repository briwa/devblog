// CodeMirror highlight style that reads the SAME CSS variables Shiki's `css-variables`
// theme emits (--astro-code-*). So the sandbox editor and the published (Shiki) code blocks
// share one palette — flip data-code-theme on <html> and both recolor live.
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--astro-code-token-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.self], color: 'var(--astro-code-token-keyword)' },
  { tag: [t.string, t.special(t.string), t.docString, t.attributeValue], color: 'var(--astro-code-token-string)' },
  { tag: [t.regexp, t.special(t.brace)], color: 'var(--astro-code-token-string-expression)' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: 'var(--astro-code-token-constant)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--astro-code-token-function)' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--astro-code-token-function)' },
  { tag: [t.className, t.typeName, t.namespace, t.tagName], color: 'var(--astro-code-token-function)' },
  { tag: [t.attributeName], color: 'var(--astro-code-token-constant)' },
  { tag: [t.propertyName, t.variableName, t.labelName], color: 'var(--astro-code-foreground)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket, t.angleBracket, t.derefOperator], color: 'var(--astro-code-token-punctuation)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--astro-code-token-comment)' },
  { tag: [t.link, t.url], color: 'var(--astro-code-token-link)', textDecoration: 'underline' },
  { tag: t.heading, color: 'var(--astro-code-token-keyword)', fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: 'var(--astro-code-foreground)' },
]);
