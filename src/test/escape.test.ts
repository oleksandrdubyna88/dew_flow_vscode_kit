import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asText } from '../text/asText';
import { escapeHtml, escapeHtmlForHighlighting, jsonForScript } from '../webview/escape';
import { nonce } from '../webview/nonce';

test('every character that could open a tag or end an attribute is escaped', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('the highlighting escape leaves the apostrophe as data, and only that', () => {
  assert.equal(escapeHtmlForHighlighting(`'v' <b> "q" &`), `'v' &lt;b&gt; &quot;q&quot; &amp;`);
});

test('a value that is not a string at run time is still escaped, never thrown on', () => {
  // The parameter says string; JSON on disk says whatever it likes.
  assert.equal(escapeHtml(42 as unknown as string), '42');
  assert.equal(escapeHtml(undefined as unknown as string), '');
  assert.equal(escapeHtml(null as unknown as string), '');
});

test('nullish text is empty, never the word undefined', () => {
  assert.equal(asText(undefined), '');
  assert.equal(asText(null), '');
  assert.equal(asText(0), '0');
  assert.equal(asText(false), 'false');
});

test('JSON for a script body cannot close the script or open a comment, and stays valid JSON', () => {
  const value = { text: '</script><script>alert(1)</script><!--' };
  const encoded = jsonForScript(value);

  assert.equal(encoded.includes('</script>'), false, 'a closing tag survived');
  assert.equal(encoded.includes('<!--'), false, 'a comment opener survived');
  assert.deepEqual(JSON.parse(encoded), value, 'the encoding must round-trip');
});

test('a nonce is fresh per call and safe inside a CSP header and an attribute', () => {
  const a = nonce();
  const b = nonce();

  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{22}$/, 'base64url of 16 bytes, nothing a header or attribute must escape');
});
