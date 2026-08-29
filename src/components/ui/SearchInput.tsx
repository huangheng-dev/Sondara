import { forwardRef } from 'react'
import { Search } from 'lucide-react'
import { Input, type InputProps, type InputRef } from 'antd'

type SearchInputProps = Omit<InputProps, 'prefix' | 'type'> & {
  ariaLabel: string
}

export const SearchInput = forwardRef<InputRef, SearchInputProps>(function SearchInput({ ariaLabel, ...props }, ref) {
  return <Input ref={ref} type="search" allowClear prefix={<Search size={15} aria-hidden="true" />} aria-label={ariaLabel} {...props} className={['ui-search-input', props.className].filter(Boolean).join(' ')} style={props.style} />
})
