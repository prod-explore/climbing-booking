/**
 * safeJson.js — JSON that is safe to embed inside an HTML <script> element.
 *
 * JSON.stringify output is valid JavaScript, but not valid inside a script element:
 * a string containing "</script>" ends the element early, and the rest is parsed as HTML.
 * Escaping "<", ">", "&" and the two JS line separators keeps the value identical when
 * parsed (JSON.parse / the JS engine) while making it inert for the HTML parser.
 */

const ESCAPES = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
};

function safeJson(value) {
  const json = JSON.stringify(value);
  return (json === undefined ? 'null' : json).replace(/[<>&\u2028\u2029]/g, ch => ESCAPES[ch]);
}

module.exports = { safeJson };
