import type { ReactNode } from 'react'
import { CheckCircle2, ChevronRight } from 'lucide-react'

export type ActionListItem = {
  key: string
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  selected?: boolean
  disabled?: boolean
  trailing?: ReactNode
  onClick: () => void
}

export function ActionList({ items, ariaLabel }: { items: readonly ActionListItem[]; ariaLabel?: string }) {
  return <div className="ui-action-list" role="group" aria-label={ariaLabel}>
    {items.map(item => <button
      key={item.key}
      className={['ui-action-list__item', !item.icon && 'ui-action-list__item--without-icon', item.selected && 'is-selected'].filter(Boolean).join(' ')}
      type="button"
      disabled={item.disabled}
      aria-current={item.selected ? 'true' : undefined}
      onClick={item.onClick}
    >
      {item.icon ? <span className="ui-action-list__icon" aria-hidden="true">{item.icon}</span> : null}
      <span className="ui-action-list__copy">
        <span className="ui-action-list__title">{item.title}</span>
        {item.description ? <span className="ui-action-list__description">{item.description}</span> : null}
      </span>
      <span className="ui-action-list__trailing" aria-hidden="true">{item.trailing ?? (item.selected ? <CheckCircle2 size={17}/> : <ChevronRight size={17}/>)}</span>
    </button>)}
  </div>
}
