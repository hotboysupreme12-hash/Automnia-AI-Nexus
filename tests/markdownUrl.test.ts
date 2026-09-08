import assert from 'node:assert/strict'
import test from 'node:test'
import { safeMarkdownUrl } from '../src/utils/markdownUrl'
test('response links allow web destinations and reject executable or credential-bearing URLs', () => {
  assert.equal(safeMarkdownUrl('https://example.com/docs#section'), 'https://example.com/docs#section')
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///Users/name/secret', 'https://user:password@example.com/', ' https://example.com', 'java\nscript:alert(1)', '//example.com']) assert.equal(safeMarkdownUrl(url), null)
})
