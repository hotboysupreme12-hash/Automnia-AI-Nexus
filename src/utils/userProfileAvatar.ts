export const USER_PROFILE_AVATAR_CHANGED_EVENT = 'automnia:user-profile-avatar-changed'

type ProfileIdentity = {
  accountId?: string | null
  email?: string | null
} | null | undefined

type UserProfileAvatarChangedDetail = {
  storageKey: string
  avatar: string
}

function profileAvatarStorageKey(identity: string) {
  const normalized = identity.trim().toLowerCase() || 'local'
  return 'automnia:user-profile-avatar:' + encodeURIComponent(normalized)
}

export function resolveUserProfileIdentity(account: ProfileIdentity, fallbackEmail?: string | null) {
  return (account?.email || fallbackEmail || account?.accountId || 'local').trim().toLowerCase()
}

export function readUserProfileAvatar(identity: string) {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(profileAvatarStorageKey(identity)) || ''
  } catch {
    return ''
  }
}

export function saveUserProfileAvatar(identity: string, avatar: string) {
  if (typeof window === 'undefined') throw new Error('Profile pictures are only available in the desktop app.')
  const storageKey = profileAvatarStorageKey(identity)
  window.localStorage.setItem(storageKey, avatar)
  window.dispatchEvent(new CustomEvent<UserProfileAvatarChangedDetail>(USER_PROFILE_AVATAR_CHANGED_EVENT, {
    detail: { storageKey, avatar },
  }))
}

export function removeUserProfileAvatar(identity: string) {
  if (typeof window === 'undefined') return
  const storageKey = profileAvatarStorageKey(identity)
  window.localStorage.removeItem(storageKey)
  window.dispatchEvent(new CustomEvent<UserProfileAvatarChangedDetail>(USER_PROFILE_AVATAR_CHANGED_EVENT, {
    detail: { storageKey, avatar: '' },
  }))
}

export function readAvatarChange(event: Event, identity: string) {
  const storageKey = profileAvatarStorageKey(identity)
  if (event instanceof StorageEvent) {
    if (event.key !== storageKey) return null
    return event.newValue || ''
  }
  const detail = (event as CustomEvent<UserProfileAvatarChangedDetail>).detail
  return detail?.storageKey === storageKey ? detail.avatar : null
}

export async function encodeUserProfileImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file for your profile picture.')
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This image could not be opened. Try a PNG, JPEG, or WebP image.')
  }

  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error('Choose an image with fewer than 40 million pixels.')
    }
    const side = 320
    const scale = Math.max(side / bitmap.width, side / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the profile picture.')
    context.drawImage(bitmap, (side - width) / 2, (side - height) / 2, width, height)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not prepare the profile picture.')), 'image/webp', 0.88)
    })
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the profile picture.'))
      reader.onerror = () => reject(new Error('Could not read the profile picture.'))
      reader.readAsDataURL(blob)
    })
  } finally {
    bitmap.close()
  }
}
