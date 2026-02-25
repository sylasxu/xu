/** 简单的 label-value 行，用于 Drawer 节点详情 */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  )
}
