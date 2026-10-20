import type { ReactNode } from 'react'

export function Heading({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 pr-10">
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold text-zinc-100">{title}</h2>
        <p className="mt-1 text-[13px] text-zinc-400">{desc}</p>
      </div>
      {action}
    </div>
  )
}

export function Row({ title, desc, children }: { title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
      <div className="min-w-[14rem] flex-1">
        <div className="text-[13px] text-zinc-200">{title}</div>
        <div className="text-[12px] text-zinc-400">{desc}</div>
      </div>
      {children}
    </div>
  )
}
