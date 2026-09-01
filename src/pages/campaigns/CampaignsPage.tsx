import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowRight,
  Archive,
  CalendarDays,
  CheckCircle2,
  Download,
  Mail,
  Pause,
  Play,
  Plus,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { outreachChannelOptions } from "@/data/channels";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { DetailDrawer, DetailSection } from "@/components/ui/DetailDrawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { useUiStore } from "@/stores/ui-store";
import { CreateDialog } from "@/components/ui/CreateDialog";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/hooks/usePagination";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { SearchInput } from "@/components/ui/SearchInput";
import { List } from '@/components/ui/List'
import { downloadCsv } from "@/utils/download";
import { campaignApi, collectAllPages, contentApi, customerApi, taskApi, type CampaignApiRecord } from "@/lib/api";
import { Avatar, Checkbox, Progress, Space, Typography } from 'antd'
import { PageContainer, PageState, SelectionBar, TableToolbar } from '@/components/ui/PageModules'
import { formatCompactTime } from '@/components/ui/TableCells'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { StatusNotice } from '@/components/ui/StatusNotice'

type CampaignRecord = CampaignApiRecord & { sent:number; replies:number; opportunities:number; revenue:string }

type CampaignSort =
  "执行进度最高" | "活动名称 A–Z" | "活动名称 Z–A" | "触达最多" | "商机最多";

export function CampaignsPage() {
  const { canWrite } = useWorkspaceAccess();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const [sort, setSort] = useState<CampaignSort>("执行进度最高");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CampaignRecord | null>(null);
  const [executeTarget, setExecuteTarget] = useState<CampaignApiRecord["steps"][number] | null>(null);
  const [executing, setExecuting] = useState(false);
  const [dialog, setDialog] = useState<"campaign" | "calendar" | "schedule-node" | null>(null);
  const [utility, setUtility] = useState<
    "optimize" | "schedule" | "content" | "edit" | null
  >(null);
  const showToast = useUiStore((s) => s.showToast);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const campaignQuery = useQuery({queryKey:["campaigns"],queryFn:()=>collectAllPages((page,pageSize)=>campaignApi.list({page,pageSize,sort:"progress_desc"})),retry:1});
  const scheduleQuery = useQuery({queryKey:["campaign-schedule"],queryFn:campaignApi.schedule,retry:1});
  const contentQuery = useQuery({queryKey:["content-assets"],queryFn:()=>collectAllPages((page,pageSize)=>contentApi.list({page,pageSize,sort:"updated_desc"})),retry:1});
  const customerQuery = useQuery({queryKey:["customers","campaign-audience"],queryFn:()=>collectAllPages((page,pageSize)=>customerApi.list({page,pageSize,sort:"score_desc"})),retry:1});
  const readinessQuery = useQuery({
    queryKey:["campaign-step-readiness",selected?.id,executeTarget?.id],
    queryFn:()=>campaignApi.stepReadiness(selected!.id,executeTarget!.id),
    enabled:Boolean(selected&&executeTarget),
    retry:1,
  });
  const contentAssets = contentQuery.data?.items??[];
  const customerItems = customerQuery.data?.items??[];
  const scheduledCount = scheduleQuery.data?.total??0;
  const formatRevenue=(amount:number,currency:string)=>new Intl.NumberFormat("zh-CN",{style:"currency",currency,maximumFractionDigits:0}).format(amount);
  const campaigns = useMemo<CampaignRecord[]>(()=>campaignQuery.data?.items.map(campaign=>({...campaign,sent:campaign.sentCount,replies:campaign.replyCount,opportunities:campaign.opportunityCount,revenue:campaign.revenueAmount>0?formatRevenue(campaign.revenueAmount,campaign.currency):"待评估"}))??[],[campaignQuery.data]);
  const audienceOptions=useMemo(()=>{
    const options:string[]=[];
    const highScore=customerItems.filter(item=>item.score>=80);
    if(highScore.length) options.push(`高匹配客户（${highScore.length}）`);
    const regions=new Map<string,number>();
    customerItems.forEach(item=>{if(item.region&&item.region!=="待补全")regions.set(item.region,(regions.get(item.region)??0)+1)});
    [...regions.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).forEach(([region,count])=>options.push(`地区：${region}（${count}）`));
    if(customerItems.length) options.push(`全部客户（${customerItems.length}）`);
    return options.length?options:["暂无客户，请先创建客户"];
  },[customerItems]);
  const audienceIdsFor=(label:string)=>{
    if(label.startsWith("高匹配客户")) return customerItems.filter(item=>item.score>=80).map(item=>item.id);
    if(label.startsWith("地区：")) {
      const region=label.replace(/^地区：/,"").replace(/（\d+）$/,"");
      return customerItems.filter(item=>item.region===region).map(item=>item.id);
    }
    if(label.startsWith("全部客户")) return customerItems.map(item=>item.id);
    return [];
  };
  const recommendations=useMemo(()=>{
    const items:Array<{campaignId:string;campaignName:string;priority:"高"|"中"|"低";title:string;detail:string;actionable:boolean}>=[];
    const draft=campaigns.find(campaign=>campaign.status==="草稿"&&campaign.progress<60);
    if(draft) items.push({campaignId:draft.id,campaignName:draft.name,priority:"中",title:`完善「${draft.name}」受众与内容`,detail:`当前受众 ${draft.audienceCount} 家，进度 ${draft.progress}%，请补充名单、内容和排期。`,actionable:true});
    const lowReply=campaigns.find(campaign=>campaign.sentCount>=5&&campaign.replyRate!==null&&campaign.replyRate<5);
    if(lowReply) items.push({campaignId:lowReply.id,campaignName:lowReply.name,priority:"高",title:`复核「${lowReply.name}」触达内容`,detail:`已发送 ${lowReply.sentCount} 封，回复率 ${lowReply.replyRate}%，建议检查标题、客户匹配和内容相关性。`,actionable:true});
    const hotReplies=campaigns.find(campaign=>campaign.replyCount>=3&&campaign.opportunityCount===0);
    if(hotReplies) items.push({campaignId:hotReplies.id,campaignName:hotReplies.name,priority:"高",title:`4小时内跟进「${hotReplies.name}」高意向回复`,detail:`已有 ${hotReplies.replyCount} 条回复但尚未创建商机，请及时确认需求并转入销售管道。`,actionable:true});
    const protectedCampaign=campaigns.find(campaign=>campaign.status==="运行中"||campaign.status==="已完成");
    if(protectedCampaign) items.push({campaignId:protectedCampaign.id,campaignName:protectedCampaign.name,priority:"低",title:`保留「${protectedCampaign.name}」自动停止保护`,detail:"收到回复、退信、退订或创建商机后继续停止后续序列。",actionable:false});
    return items.slice(0,3);
  },[campaigns]);
  const metaFor = (campaign: CampaignRecord) => ({
    progress: campaign.progress,
    channel: campaign.channel || "待配置",
    audience: campaign.audienceCount>0?`${campaign.audienceCount} 家`:"待确认",
    replyRate: campaign.replyRate===null?"—":`${campaign.replyRate}%`,
    next: campaign.nextStep?`${campaign.nextStep.name}${campaign.nextStep.scheduledAt?` · ${new Intl.DateTimeFormat("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(campaign.nextStep.scheduledAt)}`:""}`:campaign.nextAction,
  });
  const visible = useMemo(() => {
    const filtered = campaigns.filter(
      (c) =>
        (!query || `${c.name}${c.market}`.includes(query)) &&
        (filter === "全部" ? c.status !== "已归档" : c.status === filter),
    );
    return [...filtered].sort((a, b) => {
      if (sort === "活动名称 A–Z") return a.name.localeCompare(b.name, "zh-CN");
      if (sort === "活动名称 Z–A") return b.name.localeCompare(a.name, "zh-CN");
      if (sort === "触达最多") return b.sent - a.sent;
      if (sort === "商机最多") return b.opportunities - a.opportunities;
      return metaFor(b).progress - metaFor(a).progress;
    });
  }, [campaigns, query, filter, sort]);
  const campaignPaging = usePagination(
    visible,
    10,
    `${query}|${filter}|${sort}`,
  );
  const updateCheckedStatus = async (next: "运行中" | "已暂停") => {
    const jobs:Promise<CampaignApiRecord>[]=[];
    checked.forEach((id) => {
      const campaign = campaigns.find((item) => item.id === id);
      if (!campaign || campaign.status === "草稿" || campaign.status === next)
        return;
      jobs.push(campaignApi.update(id,{status:next}));
    });
    try {
      await Promise.all(jobs);
      await queryClient.invalidateQueries({queryKey:["campaigns"]});
      showToast(`已批量${next === "已暂停" ? "暂停" : "恢复"} ${jobs.length} 个活动`);
      setChecked(new Set());
    } catch (error) {
      showToast(error instanceof Error?error.message:"批量更新失败");
    }
  };
  const archiveChecked = async (archived: boolean) => {
    const targets = campaigns.filter(campaign => checked.has(campaign.id));
    await Promise.all(targets.map(campaign => campaignApi.update(campaign.id, { status: archived ? "已归档" : "草稿" })));
    await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    setChecked(new Set());
    showToast(archived ? `已归档 ${targets.length} 个活动` : `已恢复 ${targets.length} 个活动为草稿`);
  };
  const sortIcon = (active: boolean, descending: boolean) => (
    <span className="table-sort-indicator" data-sort-active={active} aria-hidden="true">
      {active ? descending ? <ArrowDown /> : <ArrowUp /> : <ArrowUpDown />}
    </span>
  );
  return (
    <PageContainer>
      <PageHeader
        title="营销活动"
        description="把目标客户、内容、触达节奏和商机跟进编排成可衡量的营销执行。"
        actions={
          <>
            <Button onClick={() => setUtility("optimize")}>
              <Sparkles size={16} />
              优化建议
            </Button>
            <Button onClick={() => setDialog("calendar")}>
              <CalendarDays size={16} />
              排期日历{scheduledCount > 0 ? ` · ${scheduledCount}` : ""}
            </Button>
            <Button variant="primary" disabled={!canWrite} onClick={() => setDialog("campaign")}>
              <Plus size={16} />
              新建活动
            </Button>
          </>
        }
      />
      <Panel>
        <TableToolbar filters={<>
            <SearchInput ariaLabel="搜索活动" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索活动或目标市场"/>
            <CustomSelect
              ariaLabel="筛选活动状态"
              value={filter}
              onChange={setFilter}
              options={["全部", "运行中", "已暂停", "草稿", "已完成", "已归档"].map(
                (label) => ({
                  value: label,
                  label: label === "全部" ? "全部状态" : label,
                  icon: label === "运行中"?<Play/>:label === "已暂停"?<Pause/>:label === "已完成"?<CheckCircle2/>:label === "草稿"?<Mail/>:<Target/>,
                }),
              )}
            />
            <CustomSelect
              ariaLabel="活动排序"
              value={sort}
              onChange={(value) => setSort(value as CampaignSort)}
              options={[
                {
                  value: "执行进度最高",
                  label: "执行进度最高",
                  icon: <ArrowUpDown />,
                },
                {
                  value: "活动名称 A–Z",
                  label: "活动名称 A–Z",
                  icon: <ArrowUp />,
                },
                {
                  value: "活动名称 Z–A",
                  label: "活动名称 Z–A",
                  icon: <ArrowDown />,
                },
                { value: "触达最多", label: "触达最多", icon: <Mail /> },
                { value: "商机最多", label: "商机最多", icon: <Target /> },
              ]}
            />
            <Button
              disabled={!query && filter === "全部" && sort === "执行进度最高"}
              onClick={() => {
                setQuery("");
                setFilter("全部");
                setSort("执行进度最高");
              }}
            >
              清除筛选
            </Button>
          </>} selection={checked.size>0?<SelectionBar count={checked.size} unit="个活动" actions={<>
              <Button onClick={() => updateCheckedStatus("运行中")}>
                <Play />
                恢复活动
              </Button>
              <Button onClick={() => updateCheckedStatus("已暂停")}>
                <Pause />
                暂停活动
              </Button>
              <Button onClick={() => archiveChecked(filter !== "已归档")}>
                <Archive />
                {filter === "已归档" ? "恢复为草稿" : "归档活动"}
              </Button>
              <Button
                onClick={() => {
                  const rows = campaigns.filter((c) => checked.has(c.id));
                  downloadCsv("sondara-selected-campaigns.csv", [
                    [
                      "活动",
                      "目标市场",
                      "状态",
                      "渠道",
                      "已触达",
                      "回复",
                      "商机",
                      "收入",
                    ],
                    ...rows.map((c) => [
                      c.name,
                      c.market,
                      c.status,
                      c.channel ?? "",
                      c.sent,
                      c.replies,
                      c.opportunities,
                      c.revenue,
                    ]),
                  ]);
                  showToast(`已导出 ${rows.length} 个活动`);
                }}
              >
                <Download />
                导出所选
              </Button>
              <Button
                aria-label="取消选择"
                title="取消选择"
                onClick={() => setChecked(new Set())}
              >
                <X size={16}/>
              </Button>
            </>}/>:undefined}/>
        {campaignQuery.isError&&<PageState status="error" title="营销活动载入失败" description={campaignQuery.error instanceof Error?campaignQuery.error.message:"请稍后重试。"} onRetry={()=>campaignQuery.refetch()}/>}
        {!campaignQuery.isError&&(
        <DataTable
          loading={campaignQuery.isFetching}
          emptyText={<EmptyState title={query||filter!=="全部"?"没有符合条件的营销活动":"暂无营销活动"} description={query||filter!=="全部"?"可以调整搜索词或状态筛选后重新查看。":"创建活动后，可以把客户、内容和执行节奏放进同一条工作流。"} icon={Mail}/>}
          columns={[
            {key:"select",title:<Checkbox disabled={!canWrite} aria-label="选择本页全部活动" checked={campaignPaging.pageItems.length>0&&campaignPaging.pageItems.every(c=>checked.has(c.id))} onChange={e=>setChecked(current=>{const next=new Set(current);campaignPaging.pageItems.forEach(c=>e.target.checked?next.add(c.id):next.delete(c.id));return next;})}/>,width:52},
            {key:"campaign",title:<Button onClick={()=>setSort(sort==="活动名称 A–Z"?"活动名称 Z–A":"活动名称 A–Z")}>活动档案{sortIcon(sort==="活动名称 A–Z"||sort==="活动名称 Z–A",sort==="活动名称 Z–A")}</Button>,width:320},
            {key:"status",title:"状态与渠道",width:170},{key:"progress",title:<Button onClick={()=>setSort("执行进度最高")}>执行进度{sortIcon(sort==="执行进度最高",true)}</Button>,width:170},
            {key:"results",kind:"metric",title:<Button onClick={()=>setSort(sort==="触达最多"?"商机最多":"触达最多")}>执行成效{sortIcon(sort==="触达最多"||sort==="商机最多",true)}</Button>,width:230},{key:"next",title:"下一执行节点",width:290},{key:"actions",title:"操作",width:104},
          ]}
          rows={campaignPaging.pageItems.map(c=>{const meta=metaFor(c);const isPaused=c.status==="已暂停";return {key:c.id,className:checked.has(c.id)?"selected":"",cells:[
            <Checkbox disabled={!canWrite} aria-label={`选择 ${c.name}`} checked={checked.has(c.id)} onChange={e=>setChecked(current=>{const next=new Set(current);e.target.checked?next.add(c.id):next.delete(c.id);return next;})}/>,
            <Button type="link" onClick={()=>setSelected(c)}><Avatar icon={<Mail/>}/><Space orientation="vertical" size={0} style={{maxWidth:220}}><Typography.Text strong ellipsis={{tooltip:c.name}}>{c.name}</Typography.Text><Typography.Text type="secondary" ellipsis={{tooltip:`${c.market} · 受众 ${meta.audience}`}}>{c.market} · 受众 {meta.audience}</Typography.Text></Space></Button>,
            <Space orientation="vertical" size={2}><Badge tone={c.status==="运行中"?"green":c.status==="草稿"?"orange":"neutral"}>{c.status}</Badge><Typography.Text type="secondary">{c.channel??meta.channel}</Typography.Text></Space>,
            <Space orientation="vertical" size={2}><Typography.Text strong>{meta.progress}%</Typography.Text><Progress aria-label={`${c.name}执行进度`} percent={meta.progress} showInfo={false}/></Space>,
            <Space orientation="vertical" size={0}><Typography.Text strong>{c.sent} 已触达 · {c.replies} 回复</Typography.Text><Typography.Text type="secondary">{c.opportunities} 个商机 · {c.revenue}</Typography.Text></Space>,
            <Space orientation="vertical" size={0}><Typography.Text strong>{meta.next}</Typography.Text><Typography.Text type="secondary">{c.status==="草稿"?"启动前需完成配置":"按当前活动节奏执行"}</Typography.Text><Typography.Text type="secondary">更新 {formatCompactTime(c.updatedAt)}</Typography.Text></Space>,
            <Space><Button aria-label={`查看 ${c.name}`} title="查看详情" onClick={()=>setSelected(c)}><ArrowRight/></Button><Button disabled={!canWrite||c.status==="草稿"||c.status==="已归档"} aria-label={isPaused?`恢复 ${c.name}`:`暂停 ${c.name}`} title={c.status==="草稿"?"草稿未启动":c.status==="已归档"?"已归档活动不可执行":isPaused?"恢复活动":"暂停活动"} onClick={async()=>{const next=isPaused?"运行中":"已暂停";try{await campaignApi.update(c.id,{status:next});await queryClient.invalidateQueries({queryKey:["campaigns"]});showToast(`${c.name}${next==="已暂停"?"已暂停":"已恢复"}`)}catch(error){showToast(error instanceof Error?error.message:"活动状态更新失败")}}}>{isPaused?<Play/>:<Pause/>}</Button></Space>,
          ]};})}
        />
        )}
        {!campaignQuery.isLoading && visible.length > 0 && (
          <Pagination
            page={campaignPaging.page}
            pageSize={campaignPaging.pageSize}
            total={visible.length}
            onPageChange={campaignPaging.setPage}
            onPageSizeChange={campaignPaging.setPageSize}
            itemName="个活动"
          />
        )}
      </Panel>
      {selected && !utility && (
        <DetailDrawer open title={selected.name} subtitle={selected.market} width={720} onClose={() => setSelected(null)} footer={<><Button onClick={() => setSelected(null)}>关闭</Button><Button variant="primary" onClick={() => setUtility("content")}>查看活动内容</Button></>}>
            <Space orientation="vertical" size="middle" style={{width:'100%'}}>
              <DetailSection title="活动概览" subtitle="当前运行状态和可用管理操作" extra={<Badge tone={selected.status==="运行中"?"green":selected.status==="草稿"?"orange":"neutral"}>{selected.status}</Badge>}>
                {canWrite?<Space wrap><Button onClick={()=>setUtility('edit')}>编辑活动</Button><Button onClick={()=>setUtility('schedule')}>调整排期</Button><Button onClick={async()=>{await campaignApi.update(selected.id,{status:selected.status==='已归档'?'草稿':'已归档'});await queryClient.invalidateQueries({queryKey:['campaigns']});showToast(selected.status==='已归档'?'活动已恢复为草稿':'活动已归档');setSelected(null)}}>{selected.status==='已归档'?'恢复为草稿':'归档活动'}</Button></Space>:<Typography.Text type="secondary">当前权限仅可查看活动信息。</Typography.Text>}
              </DetailSection>
              <DetailSection title="执行流程" subtitle="按顺序检查内容、受众和发送条件">
                {selected.steps.length ? (
                  <List dataSource={selected.steps} renderItem={(step,i)=><List.Item actions={["draft", "scheduled"].includes(step.status)?[<Button key="execute" variant="primary" onClick={()=>setExecuteTarget(step)}>启动检查</Button>]:undefined}><List.Item.Meta avatar={step.status === "completed" ? <CheckCircle2 /> : <Badge tone="blue">{i+1}</Badge>} title={step.name} description={step.status === "completed" ? "已完成" : step.scheduledAt?new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short"}).format(step.scheduledAt):"确认后立即执行"}/></List.Item>}/>
                ) : (
                  <EmptyState title="完善首个执行节点" description="当前活动还没有内容或排期节点。" icon={CalendarDays}/>
                )}
              </DetailSection>
              <DetailSection title="停止与保护规则" subtitle="防止对同一客户持续重复触达"><StatusNotice tone="info" title="自动停止条件" description="收到回复、退订或创建商机后，系统会停止后续触达。"/></DetailSection>
            </Space>
        </DetailDrawer>
      )}
      <Modal open={Boolean(executeTarget)} title={`启动检查 · ${executeTarget?.name ?? ""}`} description={`${selected?.name ?? "营销活动"} · ${executeTarget?.channel ?? selected?.channel ?? "待配置"}`} onClose={()=>!executing&&setExecuteTarget(null)} footer={<><Button disabled={executing} onClick={()=>setExecuteTarget(null)}>取消</Button>{readinessQuery.data?.checks.some(check=>check.key==='contacts'&&check.status==='block')&&<Button onClick={()=>{setExecuteTarget(null);setSelected(null);navigate('/customers')}}>前往客户库补全联系人</Button>}<Button variant="primary" loading={executing} disabled={readinessQuery.isLoading||!readinessQuery.data?.canExecute} onClick={async()=>{if(!selected||!executeTarget||!readinessQuery.data?.canExecute)return;setExecuting(true);try{const result=await campaignApi.executeStep(selected.id,executeTarget.id);await Promise.all([queryClient.invalidateQueries({queryKey:["campaigns"]}),queryClient.invalidateQueries({queryKey:["campaign-schedule"]}),queryClient.invalidateQueries({queryKey:["tasks"]}),queryClient.invalidateQueries({queryKey:["inbox-threads"]}),queryClient.invalidateQueries({queryKey:["outbox-jobs"]})]);setExecuteTarget(null);setSelected(null);showToast(result.manualTasks?`已创建 ${result.manualTasks} 项人工触达任务`:`已确认 ${result.recipientCount} 位收件人，${result.queued} 封进入发送队列`)}catch(cause){showToast(cause instanceof Error?cause.message:"活动执行失败")}finally{setExecuting(false)}}}>检查通过并执行</Button></>}><Space orientation="vertical" size="middle" style={{width:'100%'}}>{readinessQuery.isLoading?<PageState status="loading" title="正在检查受众、内容和发送服务"/>:readinessQuery.isError?<PageState status="error" title="启动检查失败" description={readinessQuery.error instanceof Error?readinessQuery.error.message:'请稍后重试'} onRetry={()=>readinessQuery.refetch()}/>:<><StatusNotice tone={readinessQuery.data?.canExecute?'success':'warning'} title={readinessQuery.data?.canExecute?'全部必要条件已通过':'还有必要条件未完成'} description={readinessQuery.data?`目标受众 ${readinessQuery.data.audienceCount} 位，当前渠道可执行 ${readinessQuery.data.reachableCount} 位。`:undefined}/><List dataSource={readinessQuery.data?.checks??[]} renderItem={check=><List.Item extra={<Badge tone={check.status==='pass'?'green':check.status==='warning'?'orange':'red'}>{check.status==='pass'?'通过':check.status==='warning'?'提醒':'需处理'}</Badge>}><List.Item.Meta title={check.label} description={check.detail}/></List.Item>}/><StatusNotice tone="info" title="执行保护" description="发送时仍会检查退订、投诉、退信和重复触达抑制规则。"/></>}</Space></Modal>
      <CreateDialog
        open={dialog === "campaign"}
        title="新建营销活动"
        description="先创建草稿，确认受众、内容、节奏与停止规则后再启动。"
        successMessage="营销活动草稿已创建"
        onClose={() => setDialog(null)}
        onSubmit={async(values)=>{const asset=contentAssets.find(item=>item.title===values.content);const startAt=values.schedule?new Date(values.schedule).getTime():null;await campaignApi.create({name:values.name,market:values.audience,audienceLabel:values.audience,status:"草稿",channel:values.channel,stopRule:values.stop,startAt:Number.isFinite(startAt)?startAt:null,contentAssetId:asset?.id??null,audienceCustomerIds:audienceIdsFor(values.audience)});await Promise.all([queryClient.invalidateQueries({queryKey:["campaigns"]}),queryClient.invalidateQueries({queryKey:["campaign-schedule"]}),queryClient.invalidateQueries({queryKey:["content-assets"]})])}}
        fields={[
          { name: "name", label: "活动名称", required: true },
          {
            name: "audience",
            label: "目标名单",
            type: "select",
            required: true,
            options: audienceOptions,
          },
          {
            name: "channel",
            label: "触达渠道",
            type: "select",
            required: true,
            options: [...outreachChannelOptions],
          },
          {
            name: "content",
            label: "内容模板",
            type: "select",
            required: true,
            options: contentAssets.length?contentAssets.map(item=>item.title):["暂无可用内容资产"],
          },
          { name: "schedule", label: "开始日期", type: "date", required: true },
          {
            name: "stop",
            label: "停止条件",
            type: "select",
            required: true,
            options: [
              "收到回复",
              "客户退订",
              "邮件退信",
              "创建商机",
              "达到触达上限",
              "手动停止",
            ],
          },
        ]}
      />
      <Modal open={dialog === "calendar"} title="活动排期" description="按时间查看当前工作区的活动执行节点。" onClose={()=>setDialog(null)} footer={<><Button onClick={()=>setDialog(null)}>关闭</Button><Button variant="primary" onClick={()=>setDialog("schedule-node")}>添加节点</Button></>}>
        {scheduleQuery.isLoading?<PageState status="loading" title="正在读取排期…"/>:scheduleQuery.data?.items.length?<List dataSource={scheduleQuery.data.items} renderItem={item=><List.Item extra={<Badge tone={item.status==="completed"?"green":item.status==="cancelled"?"neutral":"blue"}>{item.status==="completed"?"已完成":item.status==="cancelled"?"已取消":"已排期"}</Badge>}><List.Item.Meta avatar={<Badge tone="blue">{item.position}</Badge>} title={item.name} description={`${item.campaignName} · ${item.scheduledAt?new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short"}).format(item.scheduledAt):"待安排"}`}/></List.Item>}/>:<EmptyState title="暂无排期节点" icon={CalendarDays} />}
      </Modal>
      <CreateDialog
        open={dialog === "schedule-node"}
        title="添加排期节点"
        description="为活动添加一个真实执行节点。"
        submitLabel="添加节点"
        successMessage="排期节点已添加"
        onClose={() => setDialog("calendar")}
        onSubmit={async values=>{const campaign=campaigns.find(item=>item.name===values.campaign);if(!campaign)throw new Error("请选择有效活动");const scheduledAt=new Date(values.date).getTime();await campaignApi.addStep(campaign.id,{name:values.title,channel:campaign.channel,scheduledAt:Number.isFinite(scheduledAt)?scheduledAt:null});await Promise.all([queryClient.invalidateQueries({queryKey:["campaigns"]}),queryClient.invalidateQueries({queryKey:["campaign-schedule"]})])}}
        fields={[
          { name: "title", label: "节点名称", required: true },
          { name: "date", label: "执行时间", type: "datetime", required: true },
          {
            name: "campaign",
            label: "关联活动",
            type: "select",
            required: true,
            options: campaigns.map((c) => c.name),
          },
        ]}
      />
      <CreateDialog
        open={utility === "schedule"}
        title={`调整排期 · ${selected?.name ?? ""}`}
        description="修改下一次执行时间与发送窗口。"
        submitLabel="保存排期"
        successMessage="活动排期已更新"
        onClose={() => setUtility(null)}
        onSubmit={async values=>{if(!selected)throw new Error("活动不存在");const scheduledAt=new Date(values.date).getTime();await campaignApi.addStep(selected.id,{name:selected.nextAction||"下一执行节点",channel:selected.channel,scheduledAt:Number.isFinite(scheduledAt)?scheduledAt:null,note:values.note});await Promise.all([queryClient.invalidateQueries({queryKey:["campaigns"]}),queryClient.invalidateQueries({queryKey:["campaign-schedule"]})]);setSelected(null)}}
        fields={[
          { name: "date", label: "执行时间", type: "datetime", required: true },
          {
            name: "timezone",
            label: "受众时区",
            type: "select",
            required: true,
            options: ["Europe/Berlin", "Asia/Shanghai", "America/New_York"],
          },
          { name: "note", label: "执行备注", type: "textarea" },
        ]}
      />
      <CreateDialog
        open={utility === "edit"}
        title={`编辑活动 · ${selected?.name ?? ""}`}
        description="维护活动名称、目标、渠道和停止规则；历史执行数据不会被改写。"
        submitLabel="保存修改"
        successMessage="活动设置已更新"
        onClose={() => setUtility(null)}
        onSubmit={async values => {
          if (!selected) throw new Error("活动不存在");
          await campaignApi.update(selected.id, {
            name: values.name,
            market: values.market,
            audienceLabel: values.audience,
            channel: values.channel,
            nextAction: values.nextAction,
            stopRule: values.stopRule,
          });
          await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
          setUtility(null);
          setSelected(null);
        }}
        initialValues={selected ? { name: selected.name, market: selected.market, audience: selected.audienceLabel, channel: selected.channel, nextAction: selected.nextAction, stopRule: selected.stopRule } : undefined}
        fields={[
          { name: "name", label: "活动名称", required: true },
          { name: "market", label: "目标市场", required: true },
          { name: "audience", label: "受众说明", required: true },
          { name: "channel", label: "触达渠道", type: "select", required: true, options: [...outreachChannelOptions] },
          { name: "nextAction", label: "下一步动作", required: true },
          { name: "stopRule", label: "停止规则", type: "textarea", required: true },
        ]}
      />
      <Modal
        open={utility === "optimize"}
        title="活动优化建议"
        description="依据回复、商机和停止规则生成。"
        onClose={() => setUtility(null)}
        footer={
          <>
            <Button onClick={() => setUtility(null)}>关闭</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const actionable=recommendations.filter(item=>item.actionable);
                if(!actionable.length){showToast('暂无可应用的优化任务');return}
                try {
                  const results=await Promise.allSettled(actionable.map(item=>taskApi.create({
                    title:`活动优化：${item.title}`,
                    priority:item.priority,
                    dueAt:Date.now()+(item.priority==="高"?4*60*60*1000:24*60*60*1000),
                    company:item.campaignName,
                    nextAction:item.detail,
                    impact:"提升活动回复率与商机转化",
                    source:"营销活动优化",
                  })));
                  const succeeded=results.filter(r=>r.status==='fulfilled').length;
                  const failed=results.length-succeeded;
                  setUtility(null);
                  showToast(failed?`已创建 ${succeeded} 个任务，${failed} 个失败`:`已创建 ${succeeded} 个活动优化任务`);
                } catch(cause) {
                  showToast(cause instanceof Error?cause.message:'创建优化任务失败');
                }
              }}
            >
              应用为草稿
            </Button>
          </>
        }
      >
        {recommendations.length ? <List dataSource={recommendations} renderItem={(item,index)=><List.Item extra={<Badge tone={item.priority==='高'?'orange':item.priority==='中'?'blue':'neutral'}>{item.priority}优先级</Badge>}><List.Item.Meta avatar={<Badge tone="blue">{index+1}</Badge>} title={item.title} description={item.detail}/></List.Item>}/> : <EmptyState title="暂无优化建议" icon={Sparkles} />}
      </Modal>
      <Modal
        open={utility === "content"}
        title={`活动内容 · ${selected?.name ?? ""}`}
        description="当前正在使用的内容与执行顺序。"
        onClose={() => setUtility(null)}
        footer={
          <Button variant="primary" onClick={() => setUtility(null)}>
            完成
          </Button>
        }
      >
        {selected?.contentItems.length ? <List dataSource={selected.contentItems} renderItem={item=><List.Item extra={<Badge tone={item.status==="已发布"?"green":"blue"}>{item.status}</Badge>}><List.Item.Meta avatar={<Badge tone="blue">{item.position}</Badge>} title={item.title} description={`${item.purpose} · ${item.contentType} · ${item.status}`}/></List.Item>}/> : <EmptyState title="暂无关联内容" icon={Mail} />}
      </Modal>
    </PageContainer>
  );
}
