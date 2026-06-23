export type MissionGlyph =
  | 'code'
  | 'plan'
  | 'research'
  | 'launch'
  | 'command'
  | 'build'
  | 'memory'
  | 'parallel'
  | 'specialist'
  | 'relay'
  | 'swarm'
  | 'strike'
  | 'shift'
  | 'loop'
  | 'watch'

const GENERATED_MISSION_ICON_BASE = '/mission-icons/generated-v2'

export const MISSION_GLYPH_ASSETS: Record<MissionGlyph, string> = {
  code: `${GENERATED_MISSION_ICON_BASE}/code.png`,
  plan: `${GENERATED_MISSION_ICON_BASE}/plan.png`,
  research: `${GENERATED_MISSION_ICON_BASE}/research.png`,
  launch: `${GENERATED_MISSION_ICON_BASE}/launch.png`,
  command: `${GENERATED_MISSION_ICON_BASE}/command.png`,
  build: `${GENERATED_MISSION_ICON_BASE}/build.png`,
  memory: `${GENERATED_MISSION_ICON_BASE}/memory.png`,
  parallel: `${GENERATED_MISSION_ICON_BASE}/parallel.png`,
  specialist: `${GENERATED_MISSION_ICON_BASE}/specialist.png`,
  relay: `${GENERATED_MISSION_ICON_BASE}/relay.png`,
  swarm: `${GENERATED_MISSION_ICON_BASE}/swarm.png`,
  strike: `${GENERATED_MISSION_ICON_BASE}/strike.png`,
  shift: `${GENERATED_MISSION_ICON_BASE}/shift.png`,
  loop: `${GENERATED_MISSION_ICON_BASE}/loop.png`,
  watch: `${GENERATED_MISSION_ICON_BASE}/watch.png`,
}

export const MISSION_PRESET_ASSETS = {
  codeSweep: `${GENERATED_MISSION_ICON_BASE}/code-sweep.png`,
  missionPlan: `${GENERATED_MISSION_ICON_BASE}/mission-plan.png`,
  researchMap: `${GENERATED_MISSION_ICON_BASE}/research-map.png`,
  launchPush: `${GENERATED_MISSION_ICON_BASE}/launch-push.png`,
  commandOps: `${GENERATED_MISSION_ICON_BASE}/command-ops.png`,
} as const

const MISSION_ICON_ASSET_URLS = Array.from(new Set([
  ...Object.values(MISSION_GLYPH_ASSETS),
  ...Object.values(MISSION_PRESET_ASSETS),
]))

let missionIconPreloadPromise: Promise<void> | null = null

function installImagePreloadLink(url: string): void {
  if (typeof document === 'undefined') return
  const selector = `link[rel="preload"][href="${url}"]`
  if (document.head.querySelector(selector)) return

  const link = document.createElement('link')
  link.rel = 'preload'
  link.as = 'image'
  link.href = url
  ;(link as HTMLLinkElement & { fetchPriority?: string }).fetchPriority = 'high'
  document.head.appendChild(link)
}

function decodeImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image()
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }

    image.decoding = 'sync'
    image.loading = 'eager'
    ;(image as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high'
    image.onload = done
    image.onerror = done
    image.src = url
    image.decode().then(done, done)
  })
}

export function preloadMissionIconAssets(): Promise<void> {
  if (missionIconPreloadPromise) return missionIconPreloadPromise
  if (typeof window === 'undefined') return Promise.resolve()

  missionIconPreloadPromise = Promise.all(
    MISSION_ICON_ASSET_URLS.map((url) => {
      installImagePreloadLink(url)
      return decodeImage(url)
    }),
  ).then(() => undefined)

  return missionIconPreloadPromise
}
