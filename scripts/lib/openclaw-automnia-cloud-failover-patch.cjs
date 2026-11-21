const fs = require('node:fs')
const path = require('node:path')

const CLASSIFIER_FILE_PREFIX = 'classification-rules-'
const PATCH_MARKER = 'AUTOMNIA_AUTOMNIA_CLOUD_424_FAILOVER_PATCH'
const BILLING_ELIGIBILITY_MARKER = 'AUTOMNIA_AUTOMNIA_CLOUD_BILLING_ELIGIBILITY_FAILFAST_PATCH'
const CLASSIFIER_SIGNATURE = 'function classifyFailoverClassificationFromHttpStatus('
const STATUS_GUARD = 'if (e === void 0 || !Number.isFinite(e)) return null;'
const PATCH_BODY = `\t// ${PATCH_MARKER}: hosted dependency failures must reach configured model fallbacks.\n\tif (e === 424 && i === "automnia-cloud") return toReasonClassification("server_error");`
const BILLING_ELIGIBILITY_BODY = `\t// ${BILLING_ELIGIBILITY_MARKER}: a shared hosted model access gate cannot recover by trying another model.\n\tif (i === "automnia-cloud" && typeof t === "string" && /hosted_model_access_denied|hosted_billing_eligibility|eligible paid billing account in a supported region/i.test(t)) return toReasonClassification("auth_permanent");`
const LEGACY_BILLING_ELIGIBILITY_LINE = 'if (i === "automnia-cloud" && typeof t === "string" && t.toLowerCase().includes("hosted_billing_eligibility")) return toReasonClassification("auth_permanent");'
const LEGACY_BILLING_ELIGIBILITY_REGEX_LINE = 'if (i === "automnia-cloud" && typeof t === "string" && /hosted_billing_eligibility|eligible paid billing account in a supported region/i.test(t)) return toReasonClassification("auth_permanent");'
const BILLING_ELIGIBILITY_LINE = 'if (i === "automnia-cloud" && typeof t === "string" && /hosted_model_access_denied|hosted_billing_eligibility|eligible paid billing account in a supported region/i.test(t)) return toReasonClassification("auth_permanent");'

function patchAutomniaCloud424FailoverSource(source) {
  if (typeof source !== 'string' || !source.includes(CLASSIFIER_SIGNATURE)) {
    throw new Error('[openclaw-vendor] OpenClaw HTTP failover classifier was not found')
  }

  const markerCount = source.split(PATCH_MARKER).length - 1
  const billingEligibilityMarkerCount = source.split(BILLING_ELIGIBILITY_MARKER).length - 1
  if (markerCount > 1) {
    throw new Error('[openclaw-vendor] Automnia Cloud 424 failover patch is duplicated')
  }
  if (billingEligibilityMarkerCount > 1) {
    throw new Error('[openclaw-vendor] Automnia Cloud billing eligibility fail-fast patch is duplicated')
  }
  if (billingEligibilityMarkerCount === 1) {
    if (markerCount !== 1 || !source.includes('if (e === 424 && i === "automnia-cloud") return toReasonClassification("server_error");')) {
      throw new Error('[openclaw-vendor] Automnia Cloud failover patches have an unexpected body')
    }
    if (source.includes(LEGACY_BILLING_ELIGIBILITY_LINE)) return source.replace(LEGACY_BILLING_ELIGIBILITY_LINE, BILLING_ELIGIBILITY_LINE)
    if (source.includes(LEGACY_BILLING_ELIGIBILITY_REGEX_LINE)) return source.replace(LEGACY_BILLING_ELIGIBILITY_REGEX_LINE, BILLING_ELIGIBILITY_LINE)
    if (!source.includes(BILLING_ELIGIBILITY_LINE)) throw new Error('[openclaw-vendor] Automnia Cloud billing eligibility fail-fast patch has an unexpected body')
    return source
  }
  if (markerCount === 1) {
    if (!source.includes('if (e === 424 && i === "automnia-cloud") return toReasonClassification("server_error");')) {
      throw new Error('[openclaw-vendor] Automnia Cloud 424 failover patch marker has an unexpected body')
    }
    const legacyPatchOffset = source.indexOf(`\t// ${PATCH_MARKER}`)
    if (legacyPatchOffset < 0) throw new Error('[openclaw-vendor] Automnia Cloud 424 failover patch marker has an unexpected format')
    return source.slice(0, legacyPatchOffset) + BILLING_ELIGIBILITY_BODY + '\n' + source.slice(legacyPatchOffset)
  }

  const signatureOffset = source.indexOf(CLASSIFIER_SIGNATURE)
  const nextFunctionOffset = source.indexOf('\nfunction ', signatureOffset + CLASSIFIER_SIGNATURE.length)
  const classifierEnd = nextFunctionOffset < 0 ? source.length : nextFunctionOffset
  const classifier = source.slice(signatureOffset, classifierEnd)
  const guardCount = classifier.split(STATUS_GUARD).length - 1
  if (guardCount !== 1) {
    throw new Error('[openclaw-vendor] OpenClaw HTTP failover classifier guard changed; refusing Automnia Cloud patch')
  }

  const guardOffset = source.indexOf(STATUS_GUARD, signatureOffset)
  const parameterList = source.slice(signatureOffset, source.indexOf(')', signatureOffset))
  if (!/\(e,\s*t,\s*n,\s*r,\s*i,\s*a\s*$/.test(parameterList)) {
    throw new Error('[openclaw-vendor] OpenClaw HTTP failover classifier provider parameter changed')
  }
  return source.slice(0, guardOffset + STATUS_GUARD.length)
    + `\n${BILLING_ELIGIBILITY_BODY}\n${PATCH_BODY}`
    + source.slice(guardOffset + STATUS_GUARD.length)
}

function patchAutomniaCloud424FailoverDist(distRoot) {
  const matches = fs.readdirSync(distRoot)
    .filter((name) => name.startsWith(CLASSIFIER_FILE_PREFIX) && name.endsWith('.mjs'))
  if (matches.length !== 1) {
    throw new Error(`[openclaw-vendor] Expected one OpenClaw HTTP classifier bundle, found ${matches.length}`)
  }

  const filePath = path.join(distRoot, matches[0])
  const source = fs.readFileSync(filePath, 'utf8')
  const patched = patchAutomniaCloud424FailoverSource(source)
  if (patched !== source) fs.writeFileSync(filePath, patched)
  return { filePath, changed: patched !== source }
}

module.exports = {
  patchAutomniaCloud424FailoverSource,
  patchAutomniaCloud424FailoverDist,
}
