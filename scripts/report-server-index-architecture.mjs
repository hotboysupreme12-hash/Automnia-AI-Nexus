import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = process.cwd()
const sourcePath = path.join(repoRoot, 'server', 'index.ts')
const outputPath = path.join(repoRoot, 'docs', 'generated', 'server-index-architecture.md')
const sourceText = fs.readFileSync(sourcePath, 'utf8')
const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const lineOf = (position) => sourceFile.getLineAndCharacterOfPosition(position).line + 1
const spanOf = (node) => {
  const start = lineOf(node.getStart(sourceFile))
  const end = lineOf(node.getEnd())
  return { start, end, lines: end - start + 1 }
}

function collectBindingNames(name, names = []) {
  if (ts.isIdentifier(name)) names.push(name.text)
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectBindingNames(element.name, names)
    }
  }
  return names
}

function declarationRecord(statement) {
  const span = spanOf(statement)
  if (ts.isFunctionDeclaration(statement)) {
    return { kind: 'function', name: statement.name?.text || '(anonymous)', ...span }
  }
  if (ts.isClassDeclaration(statement)) {
    return { kind: 'class', name: statement.name?.text || '(anonymous)', ...span }
  }
  if (ts.isInterfaceDeclaration(statement)) return { kind: 'interface', name: statement.name.text, ...span }
  if (ts.isTypeAliasDeclaration(statement)) return { kind: 'type', name: statement.name.text, ...span }
  if (ts.isEnumDeclaration(statement)) return { kind: 'enum', name: statement.name.text, ...span }
  if (ts.isVariableStatement(statement)) {
    const names = statement.declarationList.declarations.flatMap((declaration) => collectBindingNames(declaration.name))
    return { kind: 'variable', name: names.join(', ') || '(binding)', ...span }
  }
  return null
}

function expressionName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return `${expressionName(expression.expression)}.${expression.name.text}`
  return expression.getText(sourceFile).slice(0, 120)
}

const imports = []
const declarations = []
const routeCalls = []
const registrations = []

for (const statement of sourceFile.statements) {
  if (ts.isImportDeclaration(statement)) {
    imports.push(String(statement.moduleSpecifier.text))
    continue
  }
  const declaration = declarationRecord(statement)
  if (declaration) declarations.push(declaration)

  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
    const call = statement.expression
    const callee = expressionName(call.expression)
    const span = spanOf(statement)
    if (/^app\.(get|post|put|patch|delete|use|options|head)$/.test(callee)) {
      const firstArg = call.arguments[0]
      routeCalls.push({
        method: callee.slice(4).toUpperCase(),
        route: firstArg ? firstArg.getText(sourceFile).slice(0, 160) : '(none)',
        ...span,
      })
    }
    if (/^register[A-Z].*Routes$/.test(callee)) registrations.push({ name: callee, ...span })
  }
}

const largestDeclarations = [...declarations].sort((a, b) => b.lines - a.lines || a.start - b.start)
const functions = declarations.filter((entry) => entry.kind === 'function').sort((a, b) => b.lines - a.lines || a.start - b.start)
const variables = declarations.filter((entry) => entry.kind === 'variable').sort((a, b) => b.lines - a.lines || a.start - b.start)
const extractedRouteModules = imports.filter((specifier) => specifier.startsWith('./routes/')).sort()
const lineCount = sourceText.split(/\r?\n/).length
const byteCount = Buffer.byteLength(sourceText)

const rows = (entries, columns) => entries.map((entry) => `| ${columns.map((column) => String(entry[column] ?? '')).join(' | ')} |`).join('\n')
const report = `# Server Index Architecture Report

Generated from \`server/index.ts\` by \`scripts/report-server-index-architecture.mjs\`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Lines | ${lineCount.toLocaleString()} |
| Bytes | ${byteCount.toLocaleString()} |
| Top-level imports | ${imports.length} |
| Top-level declarations | ${declarations.length} |
| Top-level functions | ${functions.length} |
| Inline Express route calls | ${routeCalls.length} |
| Extracted route registrations | ${registrations.length} |
| Imported route modules | ${extractedRouteModules.length} |

## Imported Route Modules

${extractedRouteModules.length ? extractedRouteModules.map((specifier) => `- \`${specifier}\``).join('\n') : '_None detected._'}

## Route Registration Calls

| Registration | Line | Span |
| --- | ---: | ---: |
${rows(registrations, ['name', 'start', 'lines']) || '| _None_ | | |'}

## Inline Express Routes Still In The Monolith

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
${rows(routeCalls, ['method', 'route', 'start', 'lines']) || '| _None_ | | | |'}

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
${rows(largestDeclarations.slice(0, 120), ['kind', 'name', 'start', 'end', 'lines'])}

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
${rows(functions.slice(0, 120), ['name', 'start', 'end', 'lines'])}

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
${rows(variables.slice(0, 80), ['name', 'start', 'end', 'lines'])}

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module can expose a typed service or route dependency contract.
5. The entrypoint becomes composition-focused and does not regain domain logic.
`

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, report)
console.log(`Wrote ${path.relative(repoRoot, outputPath)} (${lineCount} source lines analyzed).`)
