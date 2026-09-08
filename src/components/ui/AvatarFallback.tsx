import { avatarInitials } from '../../utils/avatarInitials'

export function AvatarFallback({ name, large = false }: { name: string; large?: boolean }) {
  return <span aria-hidden="true" className={`grid h-full w-full place-items-center bg-[#202625] font-semibold tracking-normal text-slate-300 ${large ? 'text-3xl' : 'text-sm'}`}>{avatarInitials(name)}</span>
}
