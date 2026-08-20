import { DatePicker as AntDatePicker } from 'antd'
import dayjs from 'dayjs'

type DatePickerProps = {
  value?: string
  onChange?: (value: string) => void
  ariaLabel: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  showTime?: boolean
}

export function DatePicker({ value, onChange, ariaLabel, placeholder = '选择日期', required, disabled, showTime = false }: DatePickerProps) {
  const parsed = value ? dayjs(value) : null
  return <AntDatePicker
    aria-label={ariaLabel}
    aria-required={required}
    disabled={disabled}
    value={parsed?.isValid() ? parsed : null}
    placeholder={placeholder}
    showTime={showTime ? { format: 'HH:mm' } : false}
    format={showTime ? 'YYYY年M月D日 HH:mm' : 'YYYY年M月D日'}
    onChange={date => onChange?.(date ? date.format(showTime ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD') : '')}
  />
}
