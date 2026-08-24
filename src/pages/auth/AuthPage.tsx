import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Checkbox, Form, Input, Segmented } from 'antd'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  LockKeyhole,
  Mail,
  MessagesSquare,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ApiError, authApi } from '@/lib/api'
import { useBusinessStore } from '@/stores/business-store'

const capabilities = [
  { icon: SearchCheck, title: '发现与研究', copy: '从多渠道发现目标企业，并核验证据、信号和联系人。' },
  { icon: MessagesSquare, title: '触达与跟进', copy: '把内容生成、活动执行与客户回复放进同一条工作流。' },
  { icon: BarChart3, title: '商机与分析', copy: '持续推进下一步动作，并判断真正有效的增长渠道。' },
]

const pageCopy = {
  login: {
    eyebrow: '欢迎回来',
    title: '登录你的工作空间',
    description: '继续查看客户、活动、消息和商机进展。',
    submit: '登录工作空间',
  },
  register: {
    eyebrow: '开始使用 Sondara',
    title: '创建你的工作空间',
    description: '设置账户信息，随后完善业务资料并开始客户开发。',
    submit: '创建账户',
  },
  forgot: {
    eyebrow: '账户恢复',
    title: '重置登录密码',
    description: '输入注册邮箱，我们会发送密码重置指引。',
    submit: '发送重置指引',
  },
  reset: {
    eyebrow: '账户恢复',
    title: '设置新的登录密码',
    description: '重置成功后，其他设备上的旧会话会全部失效。',
    submit: '更新登录密码',
  },
} as const

export function AuthPage({ mode }: { mode: 'login' | 'register' | 'forgot' | 'reset' }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [form] = Form.useForm<{displayName:string;email:string;password:string;confirmPassword:string;twoFactorCode:string}>()
  const [sent, setSent] = useState(false)
  const [resetUrl, setResetUrl] = useState('')
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [twoFactorChallenge,setTwoFactorChallenge]=useState(false)
  const [maskedEmail,setMaskedEmail]=useState('')
  const updateAccountPreferences = useBusinessStore(state=>state.updateAccountPreferences)
  const copy = pageCopy[mode]

  const submit = async ({displayName,email,password,confirmPassword,twoFactorCode}:{displayName:string;email:string;password:string;confirmPassword:string;twoFactorCode:string}) => {
    setSubmitting(true)
    setError('')
    try {
      if (mode === 'forgot') {
        const result = await authApi.forgotPassword(email)
        setResetUrl(result.resetUrl ?? '')
        setSent(true)
        return
      }
      if (mode === 'reset') {
        const token = searchParams.get('token') ?? ''
        if (!token) throw new Error('重置链接缺少令牌，请重新申请。')
        if (password !== confirmPassword) throw new Error('两次输入的新密码不一致。')
        await authApi.resetPassword({ token, newPassword: password })
        setSent(true)
        return
      }
      if (mode === 'login' && twoFactorChallenge) {
        const result = await authApi.verify2fa({ code: twoFactorCode, remember })
        const current = useBusinessStore.getState().accountPreferences
        updateAccountPreferences({ ...current, displayName: result.user.displayName, email: result.user.email, businessName: result.workspace.name })
        navigate('/dashboard', { replace: true })
        return
      }
      if (mode === 'login') {
        const result = await authApi.login({ email, password, remember })
        if ('twoFactorRequired' in result) {
          setTwoFactorChallenge(true)
          setMaskedEmail(result.maskedEmail)
          form.setFieldValue('twoFactorCode', '')
          return
        }
        const current = useBusinessStore.getState().accountPreferences
        updateAccountPreferences({ ...current, displayName: result.user.displayName, email: result.user.email, businessName: result.workspace.name })
        navigate('/dashboard', { replace: true })
        return
      }
      const session = await authApi.register({ displayName, email, password })
      const current = useBusinessStore.getState().accountPreferences
      updateAccountPreferences({ ...current, displayName: session.user.displayName, email: session.user.email, businessName: session.workspace.name })
      navigate('/dashboard', { replace: true })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '无法连接服务器，请确认后端服务已启动。')
    } finally {
      setSubmitting(false)
    }
  }

  return <main>
    <section aria-label="Sondara 产品介绍">
      <div>
        <div><i><Sparkles size={22}/></i><span><strong>Sondara</strong><small>AI 客户增长工作空间</small></span></div>
        <div>
          <span>从目标客户到成交结果</span>
          <h1>让客户开发，成为一套连续的增长工作流。</h1>
          <p>Sondara 把客户定位、AI 获客、内容触达、消息跟进、商机推进和转化分析集中在一个工作空间。</p>
        </div>
        <div>{capabilities.map(({icon:Icon,title,copy})=><article key={title}><i><Icon/></i><span><strong>{title}</strong><small>{copy}</small></span></article>)}</div>
        <footer><span><ShieldCheck/>可部署到自己的服务器</span><span><LockKeyhole/>数据与密钥按账户隔离</span></footer>
      </div>
    </section>

    <section>
      <div><i><Sparkles/></i><span><strong>Sondara</strong><small>AI 客户增长工作空间</small></span></div>
      <div>
        {mode === 'login' || mode === 'register' ? <Segmented aria-label="账户入口" block value={mode} options={[{label:'登录',value:'login'},{label:'创建账户',value:'register'}]} onChange={value=>navigate(value==='login'?'/login':'/register')}/> : <Link to="/login"><ArrowLeft/>返回登录</Link>}

        <header><span>{copy.eyebrow}</span><h2>{copy.title}</h2><p>{copy.description}</p></header>

        {sent ? <div role="status"><i><CheckCircle2/></i><strong>{mode === 'reset' ? '密码已经更新' : '重置指引已创建'}</strong><span>{mode === 'reset' ? '请使用新密码重新登录。' : '如果该邮箱已注册，系统会通过已配置的邮件服务发送重置链接。'}</span>{resetUrl && <Link to={resetUrl}>当前为本地开发环境，直接打开重置链接<ArrowRight/></Link>}<Link to="/login">返回登录<ArrowRight/></Link></div>
        : <Form form={form} onFinish={submit} layout="vertical" initialValues={{displayName:'',email:'',password:'',confirmPassword:'',twoFactorCode:''}}>
          {mode==='register'&&<Form.Item name="displayName" initialValue="" label="显示名称" required rules={[{required:true,message:'请输入显示名称'}]}><Input autoComplete="name" prefix={<UserRound/>} placeholder="你的姓名或称呼"/></Form.Item>}
          {mode !== 'reset' && <Form.Item name="email" initialValue="" label="邮箱" required rules={[{required:true,type:'email',message:'请输入有效邮箱'}]}><Input autoComplete="email" type="email" prefix={<Mail/>} placeholder="name@example.com"/></Form.Item>}
          {mode!=='forgot'&&<Form.Item name="password" initialValue="" label={mode === 'reset' ? '新密码' : '密码'} required rules={[{required:true,min:8,message:'密码至少 8 位'}]} extra={mode==='register'?<span><Check/>至少 8 位，建议同时包含字母和数字</span>:undefined}><Input.Password autoComplete={mode==='login'?'current-password':'new-password'} prefix={<LockKeyhole/>} placeholder={mode==='register'||mode==='reset'?'设置至少 8 位密码':'输入登录密码'}/></Form.Item>}
          {mode === 'reset' && <Form.Item name="confirmPassword" label="确认新密码" dependencies={['password']} required rules={[{required:true,message:'请再次输入新密码'},{validator:(_,value)=>!value||value===form.getFieldValue('password')?Promise.resolve():Promise.reject(new Error('两次输入的新密码不一致'))}]}><Input.Password autoComplete="new-password" prefix={<LockKeyhole/>} placeholder="再次输入新密码"/></Form.Item>}

          {mode==='login'&&!twoFactorChallenge&&<div><Checkbox checked={remember} onChange={event=>setRemember(event.target.checked)}>保持登录</Checkbox><Link to="/forgot-password">忘记密码？</Link></div>}
          {twoFactorChallenge&&<Form.Item name="twoFactorCode" label={<span>6 位验证器验证码或恢复码<small>发送到 {maskedEmail}</small></span>} required rules={[{required:true,message:'请输入验证码'}]} normalize={value=>String(value).replace(/\s|-/g,'').slice(0,8)}><Input autoFocus inputMode="numeric" autoComplete="one-time-code" prefix={<ShieldCheck/>} placeholder="000000"/></Form.Item>}

          {error&&<Alert type="error" showIcon message={error}/>}
          <Button variant="primary" type="submit" disabled={submitting}><span>{submitting?'正在处理…':twoFactorChallenge?'验证并登录':copy.submit}</span><ArrowRight size={16}/></Button>
        </Form>}

      </div>
      <p>自托管部署时，账户、数据和服务配置由你的部署环境管理。</p>
    </section>
  </main>
}
