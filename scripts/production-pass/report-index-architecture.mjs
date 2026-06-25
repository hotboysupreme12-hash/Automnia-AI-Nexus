import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const targetPath = path.resolve(process.argv[2] || 'server/index.ts')
const sourceText = fs.readFileSync(targetPath, 'utf8')
const source = ts.createSourceFile(targetPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const maxLines = Number(process.env.DYSTOPAI_SERVER_INDEX_MAX_LINES || 30_000)

const lineOf = (position) => source.getLineAndCharacterOfPosition(position).line + 1
const statementName = (statement) => {
  if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) return statement.name.text
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .map((declaration) => ts.isIdentifier(declaration.name) ? declaration.name.text : '<binding>')
      .join(', ')
  }
  if (ts.isExpressionStatement(statement)) {
    const text = statement.expression.getText(source)
    return text.length > 120 ? `${text.slice(0, 117)}...` : text
  }
  return ''
}

const statements = source.statements.map((statement) => {
  const start = lineOf(statement.getStart(source))
  const end = lineOf(statement.getEnd())
  return {
    kind: ts.SyntaxKind[statement.kind],
    name: statementName(statement),
    start,
    end,
    lines: end - start + 1,
  }
})

const routePattern = /\bapp\.(get|post|put|patch|delete|use|options|head)\s*\(/g
const routeCounts = {}
for (const match of sourceText.matchAll(routePattern)) {
  routeCounts[match[1]] = (routeCounts[match[1]] || 0) + 1
}

const registerCalls = [...sourceText.matchAll(/\b(register[A-Z][A-Za-z0-9]+Routes)\s*\(/g)]
  .map((match) => match[1])
  .filter((name, index, values) => values.indexOf(name) === index)
  .sort()

const largestStatements = [...statements]
  .sort((left, right) => right.lines - left.lines)
  .slice(0, 150)

const lines = source.getLineAndCharacterOfPosition(sourceText.length).line + 1
const report = {
  target: path.relative(process.cwd(), targetPath),
  bytes: Buffer.byteLength(sourceText),
  lines,
  maxLines,
  imports: source.statements.filter(ts.isImportDeclaration).length,
  topLevelStatements: statements.length,
  namedFunctions: statements.filter((entry) => entry.kind === 'FunctionDeclaration').length,
  oversizedStatements: statements.filter((entry) => entry.lines >= 100).length,
  routeCounts,
  registerCalls,
  largestStatements,
}

console.log('PRODUCTION_PASS_INDEX_REPORT_START')
console.log(JSON.stringify(report, null, 2))
console.log('PRODUCTION_PASS_INDEX_REPORT_END')

if (!Number.isFinite(maxLines) || maxLines < 1) {
  console.error('DYSTOPAI_SERVER_INDEX_MAX_LINES must be a positive finite number.')
  process.exitCode = 1
} else if (lines > maxLines) {
  console.error(`server/index.ts is ${lines} lines, exceeding the architecture ceiling of ${maxLines}. Extract a domain module instead of growing the monolith.`)
  process.exitCode = 1
}
