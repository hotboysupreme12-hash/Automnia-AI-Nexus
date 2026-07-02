const header = document.querySelector('[data-header]')
const menuToggle = document.querySelector('[data-menu-toggle]')
const navLinks = document.querySelector('[data-nav-links]')
const demoOutput = document.querySelector('[data-demo-output]')
const demoTabs = [...document.querySelectorAll('[data-demo]')]
const form = document.querySelector('#accessForm')
const formStatus = document.querySelector('[data-form-status]')
const yearTarget = document.querySelector('[data-year]')

const demos = {
  mission: {
    label: 'Mission brief',
    title: 'Review the repo, find release blockers, and return proof.',
    items: [
      'Architect splits the objective into work lanes.',
      'Builder inspects the code path and runs checks.',
      'Reviewer returns findings, evidence, and next action.',
    ],
    result: 'Status: ready for approval',
  },
  schedule: {
    label: 'Scheduled mission',
    title: 'Every Friday, prepare next week\'s plan and wait for approval.',
    items: [
      'Scheduler wakes the mission on the configured cadence.',
      'Operator gathers workspace context and drafts the plan.',
      'Approval gate keeps outbound messages and purchases controlled.',
    ],
    result: 'Status: scheduled and gated',
  },
  monitor: {
    label: 'Runtime monitor',
    title: 'See what agents are doing while work is running.',
    items: [
      'Monitor shows running agents, sessions, logs, plugin events, and channel traffic.',
      'Failure labels turn messy errors into plain recovery choices.',
      'Reports explain what changed, what failed, and what evidence exists.',
    ],
    result: 'Status: runtime visible',
  },
  plugins: {
    label: 'Plugin lane',
    title: 'Connect models, channels, browser flows, memory, and custom skills.',
    items: [
      'Providers give different agents different model lanes.',
      'Communication plugins route approved commands and responses.',
      'Tool plugins add capability without melting everything into one chat box.',
    ],
    result: 'Status: plugin-ready workflow',
  },
}

function setHeaderState() {
  header?.classList.toggle('is-scrolled', window.scrollY > 16)
}

function closeMobileNav() {
  navLinks?.classList.remove('is-open')
  menuToggle?.setAttribute('aria-expanded', 'false')
}

function renderDemo(key) {
  const demo = demos[key] || demos.mission
  if (!demoOutput) return
  demoOutput.innerHTML = `
    <p class="muted-label">${demo.label}</p>
    <h3>${demo.title}</h3>
    <ul>${demo.items.map((item) => `<li>${item}</li>`).join('')}</ul>
    <div class="demo-result">${demo.result}</div>
  `
}

window.addEventListener('scroll', setHeaderState, { passive: true })
setHeaderState()

menuToggle?.addEventListener('click', () => {
  const isOpen = navLinks?.classList.toggle('is-open') || false
  menuToggle.setAttribute('aria-expanded', String(isOpen))
})

navLinks?.addEventListener('click', (event) => {
  if (event.target instanceof HTMLAnchorElement) closeMobileNav()
})

demoTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const selected = tab.getAttribute('data-demo') || 'mission'
    demoTabs.forEach((button) => {
      const active = button === tab
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
    })
    renderDemo(selected)
  })
})

form?.addEventListener('submit', (event) => {
  const isLocalPreview = ['localhost', '127.0.0.1', ''].includes(window.location.hostname) || window.location.protocol === 'file:'
  if (!isLocalPreview) return
  event.preventDefault()
  if (formStatus) {
    formStatus.textContent = 'Preview mode: connect Netlify Forms, Formspree, Tally, Supabase, or your API endpoint before public launch.'
  }
})

if (yearTarget) {
  yearTarget.textContent = String(new Date().getFullYear())
}
