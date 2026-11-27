import { useCallback, useEffect, useState } from 'react'
import {
  readAvatarChange,
  readUserProfileAvatar,
  removeUserProfileAvatar,
  saveUserProfileAvatar,
  USER_PROFILE_AVATAR_CHANGED_EVENT,
} from '../utils/userProfileAvatar'

export function useUserProfileAvatar(identity: string) {
  const [avatar, setAvatar] = useState(() => readUserProfileAvatar(identity))

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setAvatar(readUserProfileAvatar(identity)))
    const onAvatarChanged = (event: Event) => {
      const nextAvatar = readAvatarChange(event, identity)
      if (nextAvatar !== null) setAvatar(nextAvatar)
    }
    window.addEventListener(USER_PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged)
    window.addEventListener('storage', onAvatarChanged)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener(USER_PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged)
      window.removeEventListener('storage', onAvatarChanged)
    }
  }, [identity])

  const save = useCallback((nextAvatar: string) => {
    saveUserProfileAvatar(identity, nextAvatar)
    setAvatar(nextAvatar)
  }, [identity])

  const clear = useCallback(() => {
    removeUserProfileAvatar(identity)
    setAvatar('')
  }, [identity])

  return [avatar, save, clear] as const
}
