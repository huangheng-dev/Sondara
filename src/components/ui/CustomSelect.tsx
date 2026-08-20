import type { ReactNode } from 'react'
import { Select } from 'antd'

export type SelectOption = string | { value: string; label: string; disabled?: boolean; icon?: ReactNode }

type CustomSelectProps = {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  placeholder?: string
  ariaLabel: string
  onChange?: (value: string) => void
  disabled?: boolean
  required?: boolean
  className?: string
  inferIcon?: boolean
}

const normalize = (option: SelectOption) => typeof option === 'string'
  ? { value: option, label: option, disabled: false, icon: undefined }
  : { disabled: false, icon: undefined, ...option }

export function CustomSelect({ options, value, defaultValue, placeholder = '请选择', ariaLabel, onChange, disabled, required, className }: CustomSelectProps) {
  const normalized = options.map(normalize)
  return <Select
    className={['custom-select', 'app-select', className].filter(Boolean).join(' ')}
    aria-label={ariaLabel}
    aria-required={required}
    disabled={disabled}
    value={value || undefined}
    defaultValue={defaultValue}
    placeholder={placeholder}
    onChange={onChange}
    optionFilterProp="label"
    showSearch={normalized.length > 8}
    options={normalized.map(option => ({
      value: option.value,
      disabled: option.disabled,
      label: option.icon ? <span>{option.icon}{option.label}</span> : option.label,
    }))}
  />
}
