// Shared server-side utilities. Keep dependency-free.
//
// escapeHtml — escape every user-controlled string before storing it in KV
// AND before rendering it. Defense in depth: even if a render path forgets to
// escape (admin panel, future surfaces), the stored value is already inert.
// We escape `&`, `<`, `>`, `"`, `'`, and `/` (the last two protect against
// attribute and `</script>` breakouts respectively).
//
// Note: this is a one-way transform applied at write time. Render-side code
// MUST still treat strings as text (e.g. textContent / templating that
// auto-escapes) — escapeHtml here protects legacy render paths that use
// innerHTML directly.
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;'
};

export function escapeHtml(input) {
  if (input == null) return input;
  const s = String(input);
  return s.replace(/[&<>"'/]/g, (ch) => HTML_ESCAPES[ch] || ch);
}

// Convenience: escape a value only if it's a string. Pass-through for null /
// numbers / booleans so we don't accidentally stringify falsy values.
export function escapeIfString(v) {
  return typeof v === 'string' ? escapeHtml(v) : v;
}

export default { escapeHtml, escapeIfString };
