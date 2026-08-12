import { DiffOp } from '@/lib/agreements/diff'
import { cn } from '@/lib/utils'

export function AgreementVersionDiff({ ops }: { ops: DiffOp[] }) {
  if (ops.length === 0) {
    return <p className="text-sm text-muted-foreground">No differences.</p>
  }

  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed">
      {ops.map((op, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap px-1',
            op.type === 'added' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
            op.type === 'removed' && 'bg-red-500/15 text-red-600 dark:text-red-400 line-through decoration-1',
            op.type === 'unchanged' && 'text-muted-foreground',
          )}
        >
          <span className="mr-2 select-none opacity-60">
            {op.type === 'added' ? '+' : op.type === 'removed' ? '-' : ' '}
          </span>
          {op.line.length > 0 ? op.line : ' '}
        </div>
      ))}
    </pre>
  )
}
