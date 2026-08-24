import { Select } from 'antd'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export function TagInput({ value, onChange, placeholder = '输入后回车添加' }: TagInputProps) {
  return (
    <Select
      mode="tags"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{ width: '100%' }}
      tokenSeparators={[',']}
      open={false}
    />
  )
}
