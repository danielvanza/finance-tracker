import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo root: this file lives at frontend/src/tests/contract.test.ts
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const contractJsonPath = path.join(repoRoot, 'contracts', 'api-contracts.json')
const backendSeamsPath = path.join(repoRoot, 'backend', 'tests', 'test_contract_seams.py')

// Suppression guard (mirrors backend/tests/test_contract_seams.py): if the
// contract substrate or the backend seam suite is deleted, this suite refuses
// to pass silently — the module-level throw fails every test in this file.
const missing = [contractJsonPath, backendSeamsPath].filter(p => !existsSync(p))
if (missing.length > 0) {
  throw new Error(`suppression guard: contract substrate removed (missing: ${missing.join(', ')})`)
}

interface ParsedCall {
  name: string
  method: string
  path: string
}

// Strip ${...} interpolations down to {param}; drop the optional-query
// builder idioms used by getTransactions/getNextReview; cut literal query
// strings. Result is comparable to contract paths modulo placeholder names.
function normaliseUrl(template: string): string {
  let url = template.replace(/\$\{BASE\}/g, '')
  url = url.replace(/\$\{\s*q\s*\?\s*'\?' \+ q\s*:\s*''\s*\}/g, '')
  url = url.replace(/\$\{params\}/g, '')
  url = url.replace(/\$\{[^}]*\}/g, '{param}')
  const q = url.indexOf('?')
  if (q !== -1) url = url.slice(0, q)
  return url
}

const canonPath = (p: string): string => p.replace(/\{[^}]+\}/g, '{}')

function parseApiCalls(source: string): ParsedCall[] {
  const anchor = source.indexOf('export const api = {')
  if (anchor === -1) throw new Error('api.ts: cannot locate `export const api = {`')
  const closeOffset = source.indexOf('\n}', anchor)
  const body = source.slice(anchor, closeOffset === -1 ? undefined : closeOffset)

  const memberRe = /^ {2}([A-Za-z_$][\w$]*):/gm
  const starts: Array<{ name: string; offset: number }> = []
  let m: RegExpExecArray | null
  while ((m = memberRe.exec(body)) !== null) {
    starts.push({ name: m[1], offset: m.index })
  }

  const calls: ParsedCall[] = []
  for (let i = 0; i < starts.length; i++) {
    const block = body.slice(starts[i].offset, i + 1 < starts.length ? starts[i + 1].offset : undefined)
    const tpl = block.match(/`(\$\{BASE\}[^`]*)`/)
    if (!tpl) throw new Error(`api.ts: no \${BASE} URL template literal found in api.${starts[i].name}`)
    const methodMatch = block.match(/method:\s*'(GET|POST|PATCH|DELETE|PUT)'/)
    calls.push({
      name: starts[i].name,
      method: methodMatch ? methodMatch[1] : 'GET',
      path: normaliseUrl(tpl[1]),
    })
  }
  return calls
}

interface EndpointDef {
  id: string
  method: string
  path: string
  frontend_caller: string | null
}

const contract = JSON.parse(readFileSync(contractJsonPath, 'utf8')) as { endpoints: EndpointDef[] }
const apiTs = readFileSync(path.join(repoRoot, 'frontend', 'src', 'api.ts'), 'utf8')

const declared = new Map<string, { id: string; method: string; path: string }>()
for (const ep of contract.endpoints ?? []) {
  if (ep.frontend_caller) {
    declared.set(ep.frontend_caller.replace(/^api\./, ''), {
      id: ep.id,
      method: ep.method,
      path: ep.path,
    })
  }
}

describe('frontend/backend API contract seams', () => {
  const calls = parseApiCalls(apiTs)

  it('parses a plausible number of api.* calls from api.ts', () => {
    expect(calls.length, `parsed ${calls.length} calls: ${calls.map(c => c.name).join(', ')}`)
      .toBeGreaterThanOrEqual(20)
  })

  it('every api.ts call maps to a declared contract endpoint', () => {
    const problems: string[] = []
    for (const call of calls) {
      const decl = declared.get(call.name)
      if (!decl) {
        problems.push(
          `call api.${call.name} (${call.method} ${call.path}) has no contract endpoint ` +
          `declaring frontend_caller "api.${call.name}"`,
        )
        continue
      }
      if (call.method !== decl.method) {
        problems.push(`api.${call.name}: method ${call.method} != declared ${decl.method} (${decl.id})`)
      }
      if (canonPath(call.path) !== canonPath(decl.path)) {
        problems.push(`api.${call.name}: path ${call.path} != declared ${decl.path} (${decl.id})`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('every declared frontend caller exists in api.ts with matching method+path', () => {
    const parsed = new Map(calls.map(c => [c.name, c]))
    const problems: string[] = []
    for (const [name, decl] of declared) {
      const call = parsed.get(name)
      if (!call) {
        problems.push(`contract endpoint ${decl.id} declares frontend_caller "api.${name}" but api.ts has no such call`)
        continue
      }
      if (call.method !== decl.method || canonPath(call.path) !== canonPath(decl.path)) {
        problems.push(
          `api.${name}: ${call.method} ${call.path} diverges from contract ${decl.id} ` +
          `(${decl.method} ${decl.path})`,
        )
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })
})
