import { useEffect, useState } from 'react'
import { Alert, Form, Input, Upload } from 'antd'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useUiStore } from '@/stores/ui-store'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { DatePicker } from '@/components/ui/DatePicker'

export type DialogField = { name: string; label: string; placeholder?: string; type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'datetime' | 'textarea' | 'select' | 'file'; options?: string[]; required?: boolean; accept?: string }

type DialogValues = Record<string, string>

export function CreateDialog({ open, title, description, submitLabel = '创建', successMessage, fields, onClose, onSubmit, initialValues = {} }: { open: boolean; title: string; description?: string; submitLabel?: string; successMessage: string; fields: DialogField[]; onClose: () => void; onSubmit?: (values: DialogValues) => boolean | void | Promise<boolean | void>; initialValues?: DialogValues }) {
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<DialogValues>()
  const showToast = useUiStore(s => s.showToast)
  const compactFields = fields.filter(field => field.type !== 'textarea')
  const trailingCompactField = compactFields.length % 2 === 1 ? compactFields.at(-1)?.name : undefined
  useEffect(() => { if (open) { setFiles({}); setError(''); setSubmitting(false); form.setFieldsValue(initialValues) } }, [form, open, initialValues])
  const submit = async (formValues: DialogValues) => {
    const missing = fields.find(field => field.required && !(field.type === 'file' ? files[field.name] : formValues[field.name]?.trim()))
    if (missing) return setError(`请填写${missing.label}`)
    setSubmitting(true)
    setError('')
    try {
      const submitValues: DialogValues = { ...formValues }
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
  return <Modal open={open} title={title} description={description} onClose={onClose} footer={<><Button onClick={onClose} disabled={submitting}>取消</Button><Button variant="primary" type="submit" form="create-dialog-form" disabled={submitting}>{submitting ? '正在保存…' : submitLabel}</Button></>}>
    <Form id="create-dialog-form" form={form} className="dialog-form" layout="vertical" initialValues={initialValues} onFinish={submit}>
      {fields.map((field, index) => <Form.Item className={field.type === 'textarea' || field.name === trailingCompactField ? 'dialog-field-full' : undefined} key={field.name} name={field.type === 'file' ? undefined : field.name} required={field.required} rules={field.type === 'file' ? undefined : [{ required: field.required, whitespace: true, message: `请填写${field.label}` }]} label={<span className="field-label">{field.label}{!field.required && <small>选填</small>}</span>}>
        {field.type === 'textarea' ? <Input.TextArea autoFocus={index === 0} aria-required={field.required} placeholder={field.placeholder} /> : field.type === 'select' ? <CustomSelect required={field.required} ariaLabel={field.label} placeholder="请选择" options={field.options || []} /> : field.type === 'date' || field.type === 'datetime' ? <DatePicker showTime={field.type === 'datetime'} required={field.required} ariaLabel={field.label} /> : field.type === 'file' ? <Upload accept={field.accept} maxCount={1} beforeUpload={file => { setFiles(v => ({...v,[field.name]:file})); return false }} onRemove={() => setFiles(v => ({...v,[field.name]:null}))}><Button>选择文件</Button></Upload> : <Input autoFocus={index === 0} aria-required={field.required} type={field.type || 'text'} placeholder={field.placeholder} />}
      </Form.Item>)}
      {error && <Alert className="form-error" type="error" showIcon message={error} />}
    </Form>
  </Modal>
}
