import type { ReactNode } from 'react'
import type { FormProps } from 'antd'
import { Space, Typography } from 'antd'

type RequiredMarkRenderer = Exclude<FormProps['requiredMark'], boolean | 'optional' | undefined>

const renderLabelMark = (labelNode: ReactNode, required: boolean, showOptional: boolean) => <Space size={4} align="center">
  {labelNode}
  {required
    ? <Typography.Text type="danger" aria-hidden="true">*</Typography.Text>
    : showOptional ? <Typography.Text className="ui-form-optional">（选填）</Typography.Text> : null}
</Space>

export const renderRequiredMarkAfter: RequiredMarkRenderer = (labelNode, { required }) => renderLabelMark(labelNode, required, false)

export const renderRequiredOrOptionalMarkAfter: RequiredMarkRenderer = (labelNode, { required }) => renderLabelMark(labelNode, required, true)
