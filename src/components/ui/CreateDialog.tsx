import { useEffect, useRef, useState } from 'react'
import { Alert, Collapse, Form, Input, Select, Upload } from 'antd'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useUiStore } from '@/stores/ui-store'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { DatePicker } from '@/components/ui/DatePicker'

export type DialogField = { name: string; label: string; description?: string; placeholder?: string; type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'datetime' | 'textarea' | 'select' | 'multiselect' | 'file'; options?: string[]; required?: boolean; accept?: string; advanced?: boolean }

type DialogValues = Record<string, string>

export function CreateDialog({ open, title, description, submitLabel = '创建', successMessage, fields, onClose, onSubmit, initialValues = {} }: { open: boolean; title: string; description?: string; submitLabel?: string; successMessage: string; fields: DialogField[]; onClose: () => void; onSubmit?: (values: DialogValues) => boolean | void | Promise<boolean | void>; initialValues?: DialogValues }) {
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<DialogValues>()
  const initialValuesRef = useRef(initialValues)
  const fieldsRef = useRef(fields)
  initialValuesRef.current = initialValues
  fieldsRef.current = fields
  const showToast = useUiStore(s => s.showToast)
  useEffect(() => {
    if (!open) return
    setFiles({})
    setError('')
    setSubmitting(false)
    form.resetFields()
    const values = { ...initialValuesRef.current } as Record<string, unknown>
    fieldsRef.current.filter(field => field.type === 'multiselect').forEach(field => {
      const value = values[field.name]
      if (typeof value === 'string') values[field.name] = value.split(',').map(item => item.trim()).filter(Boolean)
    })
    form.setFieldsValue(values as DialogValues)
  }, [form, open])
  const submit = async (formValues: DialogValues) => {
    // Collapsed advanced fields can be unmounted by Ant Design. Merge the
    // declared defaults so a user can submit the recommended configuration
    // without opening the advanced section first.
    const rawValues = { ...initialValuesRef.current, ...formValues } as unknown as Record<string, unknown>
    const missing = fields.find(field => {
      if (!field.required) return false
      if (field.type === 'file') return !files[field.name]
      const value = rawValues[field.name]
      return Array.isArray(value) ? value.length === 0 : typeof value !== 'string' || !value.trim()
    })
    if (missing) return setError(`请填写${missing.label}`)
    setSubmitting(true)
    setError('')
    try {
      const submitValues: DialogValues = Object.fromEntries(Object.entries(rawValues).map(([name, value]) => [name, Array.isArray(value) ? value.join(',') : String(value ?? '')]))
      Object.entries(files).forEach(([name, file]) => { if (file) submitValues[name] = file as unknown as string })
      if (await onSubmit?.(submitValues) === false) return
      showToast(successMessage)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }
  const renderField = (field: DialogField, index: number) => <Form.Item key={field.name} name={field.type === 'file' ? undefined : field.name} required={field.required} extra={field.description} rules={field.type === 'file' ? undefined : field.type === 'multiselect' ? [{ required: field.required, type: 'array', min: field.required ? 1 : undefined, message: `请选择${field.label}` }] : [{ required: field.required, whitespace: true, message: `请填写${field.label}` }]} label={<span>{field.label}{!field.required && <span className="ui-form-optional">（选填）</span>}</span>}>
    {field.type === 'textarea' ? <Input.TextArea autoFocus={index === 0} aria-label={field.label} aria-required={field.required} placeholder={field.placeholder} /> : field.type === 'select' ? <CustomSelect required={field.required} ariaLabel={field.label} placeholder="请选择" options={field.options || []} /> : field.type === 'multiselect' ? <Select mode="multiple" style={{width:'100%'}} aria-label={field.label} aria-required={field.required} placeholder={field.placeholder || '可选择多项'} options={(field.options || []).map(option=>({value:option,label:option}))}/> : field.type === 'date' || field.type === 'datetime' ? <DatePicker showTime={field.type === 'datetime'} required={field.required} ariaLabel={field.label} /> : field.type === 'file' ? <Upload accept={field.accept} maxCount={1} beforeUpload={file => { setFiles(v => ({...v,[field.name]:file})); return false }} onRemove={() => setFiles(v => ({...v,[field.name]:null}))}><Button>选择文件</Button></Upload> : <Input autoFocus={index === 0} aria-label={field.label} aria-required={field.required} type={field.type || 'text'} placeholder={field.placeholder} />}
  </Form.Item>
  const primaryFields = fields.filter(field => !field.advanced)
  const advancedFields = fields.filter(field => field.advanced)
  return <Modal open={open} title={title} description={description} onClose={onClose} footer={<><Button onClick={onClose} disabled={submitting}>取消</Button><Button variant="primary" type="submit" form="create-dialog-form" disabled={submitting}>{submitting ? '正在保存…' : submitLabel}</Button></>}>
    <Form className="ui-form" id="create-dialog-form" form={form} layout="vertical" initialValues={initialValues} onFinish={submit}>
      {primaryFields.map(renderField)}
      {advancedFields.length > 0 && <Collapse ghost items={[{ key: 'advanced', label: '高级设置', forceRender: true, children: advancedFields.map((field, index) => renderField(field, primaryFields.length + index)) }]}/>}
      {error && <Alert type="error" showIcon title={error} />}
    </Form>
  </Modal>
}
