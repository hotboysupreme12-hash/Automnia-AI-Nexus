import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const failures: string[] = []

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const filePath = path.join(directory, name)
    return statSync(filePath).isDirectory() ? walk(filePath) : [filePath]
  })
}

for (const filePath of walk(sourceRoot).filter((candidate) => candidate.endsWith('.tsx'))) {
  const source = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile)
      if (tagName === 'button') {
        const hasExplicitType = node.attributes.properties.some(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'type',
        )
        if (!hasExplicitType) {
          const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          failures.push(`${path.relative(root, filePath)}:${location.line + 1}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

assert.equal(
  failures.length,
  0,
  `Every button must declare an explicit type to prevent accidental form submission:\n${failures.join('\n')}`,
)

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
assert.equal(packageJson.scripts?.['smoke:interactive-controls'], 'tsx scripts/smoke-interactive-controls.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:interactive-controls'))

console.log('interactive control contract ok')
