import '../../styles/automnia-theme/163-user-profile-picture.css'
import { useRef, useState } from 'react'
import { useUserProfileAvatar } from '../../hooks/useUserProfileAvatar'
import { encodeUserProfileImage } from '../../utils/userProfileAvatar'

export function UserProfilePictureSettings({ identity, name }: { identity: string; name?: string | null }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [avatar, saveAvatar, clearAvatar] = useUserProfileAvatar(identity)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const initial = name?.trim().charAt(0).toUpperCase() || 'U'

  const handleFileChange = async (file?: File) => {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const encoded = await encodeUserProfileImage(file)
      saveAvatar(encoded)
      setAvatarFailed(false)
      setMessage('Profile picture saved on this device.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the profile picture.')
    } finally {
      setBusy(false)
    }
  }

  const handleClear = () => {
    clearAvatar()
    setAvatarFailed(false)
    setMessage('Profile picture removed.')
  }

  return (
    <div className="dui-user-profile-picture">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Choose your profile picture"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void handleFileChange(file)
        }}
      />
      <div className="dui-user-profile-picture__preview" aria-label="Your profile picture" role="img">
        {avatar && !avatarFailed
          ? <img src={avatar} alt="" onError={() => setAvatarFailed(true)} />
          : <span aria-hidden="true">{initial}</span>}
      </div>
      <div className="dui-user-profile-picture__content">
        <strong>Profile picture</strong>
        <small>Shown beside your messages. Saved on this device.</small>
        <div className="dui-user-profile-picture__actions">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Saving…' : avatar ? 'Change picture' : 'Choose picture'}
          </button>
          {avatar && <button type="button" className="is-secondary" onClick={handleClear} disabled={busy}>Remove</button>}
        </div>
        {message && <small className="dui-user-profile-picture__message" role="status">{message}</small>}
      </div>
    </div>
  )
}
