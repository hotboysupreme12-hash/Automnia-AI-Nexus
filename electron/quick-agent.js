const root = document.getElementById('quick-agent')
const bubble = document.querySelector('.quick-agent__bubble')
const promptInput = document.getElementById('prompt')
const form = document.getElementById('quick-agent-form')
const fileInput = document.getElementById('file-input')
const fileList = document.getElementById('file-list')
const contextBox = document.getElementById('clipboard-context')
const statusText = document.getElementById('quick-agent-status')
const sendButton = document.getElementById('send-button')
const agentName = document.getElementById('agent-name')
const pendingFiles = []
let clipboardContext = null
let imageObjectUrl = ''
let submitting = false
let collapseTimer = 0
let contextPending = false
let readingFiles = 0
let composerGeneration = 0
let previewUrls = []
const addButton = document.querySelector('.quick-agent__add')

function updateControls() {
  const busy = submitting || readingFiles > 0 || contextPending
  sendButton.disabled = busy
  addButton.disabled = submitting
  promptInput.readOnly = submitting
  fileList.querySelectorAll('button').forEach((button) => { button.disabled = submitting })
  contextBox.querySelectorAll('button').forEach((button) => { button.disabled = submitting })
}

function formatSize(size) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.ceil(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function bytesOf(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Uint8Array()
}

function totalAttachmentBytes() {
  const fileBytes = pendingFiles.reduce((total, file) => total + file.size, 0)
  return fileBytes + (clipboardContext?.image?.size || 0)
}

function showStatus(message, error = false) {
  statusText.hidden = !message
  statusText.textContent = message || ''
  statusText.style.color = error ? '#ffaaa5' : ''
}

function renderContext() {
  contextBox.replaceChildren()
  if (!clipboardContext || (!clipboardContext.text && !clipboardContext.image)) {
    contextBox.hidden = true
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl)
    imageObjectUrl = ''
    clipboardContext = null
    return
  }
  contextBox.hidden = false
  const header = document.createElement('div')
  header.className = 'quick-agent__context-head'
  const label = document.createElement('span')
  const textLabel = clipboardContext.textSource === 'selection' ? 'Selected text' : clipboardContext.textSource === 'selection+clipboard' ? 'Selection + clipboard text' : 'Copied text'
  label.textContent = clipboardContext.image && clipboardContext.text ? `${textLabel} · image` : clipboardContext.image ? 'Copied image' : textLabel
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'quick-agent__remove-context'
  remove.setAttribute('aria-label', 'Remove clipboard context')
  remove.textContent = '×'
  remove.addEventListener('click', () => {
    clipboardContext = null
    renderContext()
  })
  header.append(label, remove)
  contextBox.append(header)

  if (clipboardContext.text) {
    const text = document.createElement('p')
    text.className = 'quick-agent__context-text'
    text.textContent = clipboardContext.text.length > 500 ? `${clipboardContext.text.slice(0, 500)}…` : clipboardContext.text
    contextBox.append(text)
  }
  if (clipboardContext.image) {
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl)
    imageObjectUrl = URL.createObjectURL(new Blob([bytesOf(clipboardContext.image.data)], { type: clipboardContext.image.mimeType || 'image/png' }))
    const image = document.createElement('img')
    image.className = 'quick-agent__context-image'
    image.alt = 'Image copied to clipboard'
    image.src = imageObjectUrl
    contextBox.append(image)
  }
}

function renderFiles() {
  for (const url of previewUrls) URL.revokeObjectURL(url)
  previewUrls = []
  fileList.replaceChildren()
  for (const file of pendingFiles) {
    const chip = document.createElement('span')
    chip.className = 'quick-agent__file'
    if (file.mimeType.startsWith('image/')) {
      const image = document.createElement('img')
      image.className = 'quick-agent__file-preview'
      image.alt = ''
      const url = URL.createObjectURL(new Blob([file.data], { type: file.mimeType }))
      previewUrls.push(url)
      image.src = url
      image.addEventListener('error', () => { image.hidden = true })
      chip.append(image)
    }
    const name = document.createElement('span')
    name.className = 'quick-agent__file-name'
    name.textContent = file.name
    name.title = `${file.name} - ${formatSize(file.size)}`
    const size = document.createElement('span')
    size.className = 'quick-agent__file-size'
    size.textContent = formatSize(file.size)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'quick-agent__remove-file'
    remove.setAttribute('aria-label', `Remove ${file.name}`)
    remove.textContent = '×'
    remove.addEventListener('click', () => {
      const index = pendingFiles.indexOf(file)
      if (index >= 0) pendingFiles.splice(index, 1)
      renderFiles()
    })
    chip.append(name, size, remove)
    fileList.append(chip)
  }
  updateControls()
}

function openComposer(context) {
  if (collapseTimer) window.clearTimeout(collapseTimer)
  collapseTimer = 0
  composerGeneration += 1
  contextPending = context?.contextPending === true
  if (!clipboardContext && context && (context.text || context.image)) clipboardContext = context
  const initialFileLimit = 8 - (context?.image ? 1 : 0)
  for (const attachment of !submitting && Array.isArray(context?.attachments) ? context.attachments.slice(0, initialFileLimit) : []) {
    const bytes = bytesOf(attachment?.data)
    if (!attachment?.name || !bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) continue
    if (pendingFiles.length + (clipboardContext?.image ? 1 : 0) >= 8 || totalAttachmentBytes() + bytes.byteLength > 100 * 1024 * 1024) break
    if (pendingFiles.some((file) => file.name === attachment.name && file.size === bytes.byteLength)) continue
    pendingFiles.push({
      name: String(attachment.name).slice(0, 240),
      mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType : 'application/octet-stream',
      size: bytes.byteLength,
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      lastModified: 0,
    })
  }
  if (context?.agentName) agentName.textContent = context.agentName
  const origin = context?.popupOrigin || {}
  root.style.setProperty('--cursor-x', typeof origin.x === 'string' ? origin.x : '0px')
  root.style.setProperty('--cursor-y', typeof origin.y === 'string' ? origin.y : '0px')
  root.style.setProperty('--popup-origin-x', typeof origin.x === 'string' ? origin.x : '0%')
  root.style.setProperty('--popup-origin-y', typeof origin.y === 'string' ? origin.y : '0%')
  root.classList.remove('quick-agent--trail', 'quick-agent--closing', 'quick-agent--entered')
  root.classList.add('quick-agent--open')
  bubble.hidden = false
  showStatus(context?.message || '')
  updateControls()
  renderContext()
  renderFiles()
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    root.classList.add('quick-agent--entered')
    window.setTimeout(() => promptInput.focus(), 35)
  }))
}

window.automniaQuickAgent?.onLogo((dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return
  document.getElementById('automnia-mark').src = dataUrl
  document.querySelector('.quick-agent__logo').src = dataUrl
})

window.automniaQuickAgent?.onOpen((context) => openComposer(context || {}))
window.automniaQuickAgent?.onFade((fading) => {
  root.classList.toggle('quick-agent--fading', fading)
})
window.automniaQuickAgent?.onContext((context) => {
  if (!root.classList.contains('quick-agent--open')) return
  contextPending = context?.contextPending === true
  if (context?.agentName) agentName.textContent = context.agentName
  if (!clipboardContext && context && (context.text || context.image)) clipboardContext = context
  const existingFiles = new Set(pendingFiles.map((file) => `${file.name}:${file.size}`))
  const fileLimit = 8 - (clipboardContext?.image ? 1 : 0)
  for (const attachment of Array.isArray(context?.attachments) ? context.attachments : []) {
    const bytes = bytesOf(attachment?.data)
    const key = `${attachment?.name || ''}:${bytes.byteLength}`
    if (!attachment?.name || !bytes.byteLength || existingFiles.has(key) || pendingFiles.length >= fileLimit) continue
    if (bytes.byteLength > 25 * 1024 * 1024 || totalAttachmentBytes() + bytes.byteLength > 100 * 1024 * 1024) continue
    pendingFiles.push({
      name: String(attachment.name).slice(0, 240),
      mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType : 'application/octet-stream',
      size: bytes.byteLength,
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      lastModified: 0,
    })
    existingFiles.add(key)
  }
  updateControls()
  if (!statusText.hidden && ['Reading selected content…', 'Still reading selected content…'].includes(statusText.textContent)) showStatus(context?.message || '')
  else if (context?.message && !submitting) showStatus(context.message)
  renderContext()
  renderFiles()
})
window.automniaQuickAgent?.onCollapse(() => {
  if (collapseTimer) window.clearTimeout(collapseTimer)
  root.classList.remove('quick-agent--entered', 'quick-agent--closing')
  root.classList.add('quick-agent--closing')
  collapseTimer = window.setTimeout(() => {
    collapseTimer = 0
    root.classList.remove('quick-agent--open', 'quick-agent--closing')
    root.classList.add('quick-agent--trail')
    bubble.hidden = true
    contextPending = false
    updateControls()
  }, 190)
})

document.querySelector('.quick-agent__close').addEventListener('click', () => {
  void window.automniaQuickAgent?.close()
})

document.querySelector('.quick-agent__add').addEventListener('click', () => {
  if (submitting) return
  window.automniaQuickAgent?.setFileDialogOpen(true)
  fileInput.click()
})
async function addFiles(selected) {
  if (submitting || !selected.length) return
  readingFiles += 1
  updateControls()
  showStatus('Reading attachments...')
  let issue = ''
  try {
    for (const file of selected) {
      if (pendingFiles.some((entry) => entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified)) {
        issue = `${file.name} is already attached.`
        continue
      }
      if (pendingFiles.length + (clipboardContext?.image ? 1 : 0) >= 8) { issue = 'Attach up to 8 files, including any clipboard image.'; break }
      if (!file.size) { issue = `${file.name} is empty and was not attached.`; continue }
      if (file.size > 25 * 1024 * 1024 || totalAttachmentBytes() + file.size > 100 * 1024 * 1024) {
        issue = 'Each file can be up to 25 MB. Keep all attachments under 100 MB.'
        continue
      }
      try {
        const data = await file.arrayBuffer()
        // Another picker or drop may have completed while this file was read.
        if (pendingFiles.some((entry) => entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified)) continue
        if (pendingFiles.length + (clipboardContext?.image ? 1 : 0) >= 8 || totalAttachmentBytes() + data.byteLength > 100 * 1024 * 1024) {
          issue = 'Attachment limit reached. Send remaining files separately.'
          break
        }
        pendingFiles.push({ name: file.name, mimeType: file.type || 'application/octet-stream', size: data.byteLength, data, lastModified: file.lastModified })
      } catch {
        issue = `Could not read ${file.name}. Choose the file again to retry.`
      }
    }
  } finally {
    readingFiles -= 1
    renderFiles()
    showStatus(issue || (readingFiles ? 'Reading attachments...' : ''), Boolean(issue))
    updateControls()
  }
}
fileInput.addEventListener('change', async () => {
  window.automniaQuickAgent?.setFileDialogOpen(false)
  const selected = Array.from(fileInput.files || [])
  fileInput.value = ''
  await addFiles(selected)
})
window.addEventListener('focus', () => window.automniaQuickAgent?.setFileDialogOpen(false))

root.addEventListener('dragenter', (event) => {
  if (!root.classList.contains('quick-agent--open')) return
  event.preventDefault()
  root.classList.add('quick-agent--dragover')
})
root.addEventListener('dragover', (event) => {
  if (root.classList.contains('quick-agent--open')) event.preventDefault()
})
root.addEventListener('dragleave', (event) => {
  if (event.relatedTarget && root.contains(event.relatedTarget)) return
  root.classList.remove('quick-agent--dragover')
})
root.addEventListener('drop', (event) => {
  if (!root.classList.contains('quick-agent--open')) return
  event.preventDefault()
  root.classList.remove('quick-agent--dragover')
  void addFiles(Array.from(event.dataTransfer?.files || []))
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (submitting || readingFiles) return
  if (contextPending) {
    showStatus('Still reading selected content…')
    return
  }
  const prompt = promptInput.value.trim()
  const clipboardText = clipboardContext?.text || ''
  const clipboardImage = clipboardContext?.image || undefined
  if (!prompt && !clipboardText && !clipboardImage && !pendingFiles.length) {
    promptInput.focus()
    return
  }
  submitting = true
  const submittedGeneration = composerGeneration
  updateControls()
  sendButton.textContent = 'Sending…'
  showStatus('Sending to your selected agent…')
  try {
    const result = await window.automniaQuickAgent.submit({
      prompt,
      clipboardText,
      clipboardImage,
      attachments: pendingFiles.map(({ name, mimeType, size, data }) => ({ name, mimeType, size, data })),
    })
    if (!result?.ok) {
      showStatus(result?.message || 'The request could not be sent. Your draft is still here.', true)
      return
    }
    pendingFiles.splice(0)
    clipboardContext = null
    promptInput.value = ''
    renderFiles()
    renderContext()
    showStatus('')
    if (composerGeneration === submittedGeneration && root.classList.contains('quick-agent--open')) await window.automniaQuickAgent.close()
  } catch (error) {
    showStatus(error instanceof Error ? error.message : 'The request could not be sent. Your draft is still here.', true)
  } finally {
    submitting = false
    sendButton.textContent = 'Send'
    updateControls()
  }
})

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    form.requestSubmit()
  }
  if (event.key === 'Escape') void window.automniaQuickAgent?.close()
})

// Pasting an image or file should attach it, while ordinary text pastes normally.
promptInput.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.files || [])
  if (!files.length || submitting) return
  event.preventDefault()
  void addFiles(files)
})
window.addEventListener('beforeunload', () => {
  if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl)
  for (const url of previewUrls) URL.revokeObjectURL(url)
})
