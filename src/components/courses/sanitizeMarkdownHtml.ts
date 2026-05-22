import DOMPurify from "dompurify";

// Interactive / form-control tags that should never appear in
// student-facing course Markdown. DOMPurify's default config allows
// these; we explicitly forbid them so a designer/faculty body cannot
// inject embedded forms or interactive controls into a consent /
// instruction / debrief / external-link / AI-detection page.
const FORBID_TAGS = [
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "optgroup",
  "fieldset",
  "label",
  "datalist",
  "output",
  "iframe",
  "object",
  "embed",
  "script",
  "style",
  "link",
  "meta",
];

// Attributes that can route interaction or load external content even
// on otherwise-allowed tags.
const FORBID_ATTR = ["action", "formaction", "srcdoc"];

export function sanitizeMarkdownHtml(input: string): string {
  return DOMPurify.sanitize(input, { FORBID_TAGS, FORBID_ATTR });
}
