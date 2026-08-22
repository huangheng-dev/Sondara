import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  Mail,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { outreachChannels } from "@/data/channels";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { useUiStore } from "@/stores/ui-store";
import { CreateDialog } from "@/components/ui/CreateDialog";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/hooks/usePagination";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { SearchInput } from "@/components/ui/SearchInput";
import { downloadCsv } from "@/utils/download";
import { campaignApi, contentApi, customerApi, taskApi, type CampaignApiRecord } from "@/lib/api";
import { Checkbox } from 'antd'

type CampaignRecord = CampaignApiRecord & { sent:number; replies:number; opportunities:number; revenue:string }

type CampaignSort =
  "执行进度最高" | "活动名称 A–Z" | "活动名称 Z–A" | "触达最多" | "商机最多";

export function CampaignsPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const [sort, setSort] = useState<CampaignSort>("执行进度最高");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CampaignRecord | null>(null);
  const [executeTarget, setExecuteTarget] = useState<CampaignApiRecord["steps"][number] | null>(null);
  const [executing, setExecuting] = useState(false);
  const [dialog, setDialog] = useState<"campaign" | "calendar" | "schedule-node" | null>(null);
  const [utility, setUtility] = useState<
    "optimize" | "schedule" | "content" | "menu" | null
  >(null);
  const showToast = useUiStore((s) => s.showToast);
  const queryClient = useQueryClient();
  const campaignQuery = useQuery({queryKey:["campaigns"],queryFn:()=>campaignApi.list({pageSize:100,sort:"progress_desc"}),retry:1});
  const scheduleQuery = useQuery({queryKey:["campaign-schedule"],queryFn:campaignApi.schedule,retry:1});
  const contentQuery = useQuery({queryKey:["content-assets"],queryFn:()=>contentApi.list({pageSize:100,sort:"updated_desc"}),retry:1});
  const customerQuery = useQuery({queryKey:["customers","campaign-audience"],queryFn:()=>customerApi.list({pageSize:100,sort:"score_desc"}),retry:1});
  const contentAssets = contentQuery.data?.items??[];
  const customerItems = customerQuery.data?.items??[];
  const scheduledCount = scheduleQuery.data?.total??0;
  const formatRevenue=(amount:number,currency:string)=>new Intl.NumberFormat("zh-CN",{style:"currency",currency,maximumFractionDigits:0}).format(amount);
  const campaigns = useMemo<CampaignRecord[]>(()=>campaignQuery.data?.items.map(campaign=>({...campaign,sent:campaign.sentCount,replies:campaign.replyCount,opportunities:campaign.opportunityCount,revenue:formatRevenue(campaign.revenueAmount,campaign.currency)}))??[],[campaignQuery.data]);
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
        (filter === "全部" || c.status === filter),
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
    6,
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
  const sortIcon = (active: boolean, descending: boolean) => (
    <span className="customer-sort-icon" aria-hidden="true">
      {active ? descending ? <ArrowDown /> : <ArrowUp /> : <ArrowUpDown />}
    </span>
  );
  return (
    <div className="page-content campaigns-page">
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
            <Button variant="primary" onClick={() => setDialog("campaign")}>
              <Plus size={16} />
              新建活动
            </Button>
          </>
        }
      />
      <Panel className="campaign-workspace standard-list-panel">
        <div className="campaign-toolbar customer-toolbar module-toolbar standard-list-toolbar">
          <div className="customer-filter-controls">
            <SearchInput className="campaign-search customer-search module-search" ariaLabel="搜索活动" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索活动或目标市场"/>
            <CustomSelect
              className="campaign-status-select"
              ariaLabel="筛选活动状态"
              value={filter}
              onChange={setFilter}
              options={["全部", "运行中", "已暂停", "草稿", "已完成"].map(
                (label) => ({
                  value: label,
                  label: label === "全部" ? "全部状态" : label,
                  icon: label === "运行中"?<Play/>:label === "已暂停"?<Pause/>:label === "已完成"?<CheckCircle2/>:label === "草稿"?<Mail/>:<Target/>,
                }),
              )}
            />
            <CustomSelect
              className="sort-select"
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
              className="customer-refresh"
              disabled={campaignQuery.isFetching}
              onClick={async () => {await campaignQuery.refetch();showToast("营销活动列表已刷新")}}
            >
              <RefreshCw className={campaignQuery.isFetching ? "is-spinning" : undefined} />
              刷新
            </Button>
            <Button
              className="customer-clear module-clear"
              disabled={!query && filter === "全部" && sort === "执行进度最高"}
              onClick={() => {
                setQuery("");
                setFilter("全部");
                setSort("执行进度最高");
              }}
            >
              清除筛选
            </Button>
          </div>
          <div
            className={`customer-selection-tools${checked.size > 0 ? " has-selection" : " is-empty"}`}
            aria-hidden={checked.size === 0}
          >
            <span>
              <CheckCircle2 />
              <small>已选择</small>
              <strong>{checked.size}</strong>
              <small>个</small>
            </span>
            <div>
              <Button onClick={() => updateCheckedStatus("运行中")}>
                <Play />
                恢复活动
              </Button>
              <Button onClick={() => updateCheckedStatus("已暂停")}>
                <Pause />
                暂停活动
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
            </div>
          </div>
        </div>
        {campaignQuery.isLoading&&<div className="standard-list-state"><RefreshCw className="is-spinning"/><strong>正在载入营销活动</strong><span>从当前工作区读取活动、执行节点与关联内容。</span></div>}
        {campaignQuery.isError&&<div className="standard-list-state"><Target/><strong>营销活动载入失败</strong><span>{campaignQuery.error instanceof Error?campaignQuery.error.message:"请稍后重试。"}</span><Button onClick={()=>campaignQuery.refetch()}>重新加载</Button></div>}
        {!campaignQuery.isLoading&&!campaignQuery.isError&&visible.length===0&&<EmptyState className="list-empty-state" title="暂无营销活动" description="创建活动后，可以把客户、内容和执行节奏放进同一条工作流。" icon={Mail} action={<Button variant="primary" onClick={()=>setDialog("campaign")}><Plus/>新建活动</Button>}/>}
        {visible.length>0&&(
        <DataTable
          className="customer-table customer-table-pro campaign-table"
          columns={[
            {key:"select",title:<span className="customer-check"><Checkbox aria-label="选择本页全部活动" checked={campaignPaging.pageItems.length>0&&campaignPaging.pageItems.every(c=>checked.has(c.id))} onChange={e=>setChecked(current=>{const next=new Set(current);campaignPaging.pageItems.forEach(c=>e.target.checked?next.add(c.id):next.delete(c.id));return next;})}/></span>,width:52},
            {key:"campaign",title:<Button className="customer-sort-head" onClick={()=>setSort(sort==="活动名称 A–Z"?"活动名称 Z–A":"活动名称 A–Z")}>活动档案{sortIcon(sort==="活动名称 A–Z"||sort==="活动名称 Z–A",sort==="活动名称 Z–A")}</Button>},
            {key:"status",title:"状态与渠道"},{key:"progress",title:<Button className="customer-sort-head" onClick={()=>setSort("执行进度最高")}>执行进度{sortIcon(sort==="执行进度最高",true)}</Button>},
            {key:"reach",title:<Button className="customer-sort-head" onClick={()=>setSort("触达最多")}>触达与回复{sortIcon(sort==="触达最多",true)}</Button>},{key:"revenue",title:<Button className="customer-sort-head" onClick={()=>setSort("商机最多")}>商机与收入{sortIcon(sort==="商机最多",true)}</Button>},{key:"next",title:"下一执行节点"},{key:"actions",title:"操作"},
          ]}
          rows={campaignPaging.pageItems.map(c=>{const meta=metaFor(c);const isPaused=c.status==="已暂停";return {key:c.id,className:checked.has(c.id)?"selected":"",cells:[
            <span className="customer-check"><Checkbox aria-label={`选择 ${c.name}`} checked={checked.has(c.id)} onChange={e=>setChecked(current=>{const next=new Set(current);e.target.checked?next.add(c.id):next.delete(c.id);return next;})}/></span>,
            <Button className="standard-entity" onClick={()=>setSelected(c)}><i><Mail/></i><span><strong>{c.name}</strong><small>{c.market} · 受众 {meta.audience}</small></span></Button>,
            <div className="standard-cell-stack"><Badge tone={c.status==="运行中"?"green":c.status==="草稿"?"orange":"neutral"}>{c.status}</Badge><small>{c.channel??meta.channel}</small></div>,
            <div className="standard-progress"><span><strong>{meta.progress}%</strong><small>执行进度</small></span><i><u style={{width:`${meta.progress}%`}}/></i></div>,
            <div className="standard-cell-stack"><strong>{c.sent} 已触达</strong><small>{c.replies} 回复 · {meta.replyRate}</small></div>,
            <div className="standard-value"><strong className="money">{c.revenue}</strong><small>{c.opportunities} 个商机</small></div>,
            <div className="standard-next"><strong>{meta.next}</strong><small>{c.status==="草稿"?"启动前需完成配置":"按当前活动节奏执行"}</small></div>,
            <div className="standard-row-actions"><Button aria-label={`查看 ${c.name}`} title="查看详情" onClick={()=>setSelected(c)}><ArrowRight/></Button><Button disabled={c.status==="草稿"} aria-label={isPaused?`恢复 ${c.name}`:`暂停 ${c.name}`} title={c.status==="草稿"?"草稿未启动":isPaused?"恢复活动":"暂停活动"} onClick={async()=>{const next=isPaused?"运行中":"已暂停";try{await campaignApi.update(c.id,{status:next});await queryClient.invalidateQueries({queryKey:["campaigns"]});showToast(`${c.name}${next==="已暂停"?"已暂停":"已恢复"}`)}catch(error){showToast(error instanceof Error?error.message:"活动状态更新失败")}}}>{isPaused?<Play/>:<Pause/>}</Button><Button aria-label={`更多操作：${c.name}`} title="更多操作" onClick={()=>{setSelected(c);setUtility("menu")}}><MoreHorizontal/></Button></div>,
          ]};})}
        />
        )}
        {visible.length > 0 && (
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
        <DetailDrawer className="campaign-drawer" open title={selected.name} subtitle={selected.market} onClose={() => setSelected(null)} footer={<><Button onClick={() => setUtility("schedule")}><CalendarDays/>调整排期</Button><Button variant="primary" onClick={() => setUtility("content")}>查看活动内容</Button></>}>
            <div className="app-detail-drawer-body">
              <Badge tone={selected.status==="运行中"?"green":selected.status==="草稿"?"orange":"neutral"}>{selected.status}</Badge>
              <section>
                <h3>执行流程</h3>
                {(selected.steps.length?selected.steps:[{id:"pending",name:"完善首个执行节点",status:"draft",scheduledAt:null}]).map((step, i) => (
                  <article className={step.status === "completed" ? "done" : ""} key={step.id}>
                    <i>{step.status === "completed" ? <CheckCircle2 /> : i + 1}</i>
                    <span>
                      <strong>{step.name}</strong>
                      <small>{step.status === "completed" ? "已完成" : step.scheduledAt?new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short"}).format(step.scheduledAt):"待排期"}</small>
                    </span>
                    {step.id !== "pending" && ["draft", "scheduled"].includes(step.status) && <Button size="sm" variant="primary" onClick={()=>setExecuteTarget(step as CampaignApiRecord["steps"][number])}><Play/>确认执行</Button>}
                  </article>
                ))}
              </section>
              <section>
                <h3>停止与保护规则</h3>
                <p>
                  收到回复、退订或创建商机后自动停止后续触达，避免重复联系。
                </p>
              </section>
            </div>
        </DetailDrawer>
      )}
      <Modal open={Boolean(executeTarget)} title={`确认执行 · ${executeTarget?.name ?? ""}`} description={`${selected?.name ?? "营销活动"} · ${executeTarget?.channel ?? selected?.channel ?? "待配置"}`} onClose={()=>!executing&&setExecuteTarget(null)} footer={<><Button disabled={executing} onClick={()=>setExecuteTarget(null)}>取消</Button><Button variant="primary" disabled={executing} onClick={async()=>{if(!selected||!executeTarget)return;setExecuting(true);try{const result=await campaignApi.executeStep(selected.id,executeTarget.id);await Promise.all([queryClient.invalidateQueries({queryKey:["campaigns"]}),queryClient.invalidateQueries({queryKey:["campaign-schedule"]}),queryClient.invalidateQueries({queryKey:["tasks"]}),queryClient.invalidateQueries({queryKey:["inbox-threads"]}),queryClient.invalidateQueries({queryKey:["outbox-jobs"]})]);setExecuteTarget(null);setSelected(null);showToast(result.manualTasks?`已创建 ${result.manualTasks} 项人工触达任务`:`已确认 ${result.recipientCount} 位收件人，${result.queued} 封进入发送队列${result.awaitingConfiguration?`，${result.awaitingConfiguration} 封等待 SMTP 配置`:""}`)}catch(cause){showToast(cause instanceof Error?cause.message:"活动执行失败")}finally{setExecuting(false)}}}>{executing?"正在建立执行任务…":"确认内容与受众并执行"}</Button></>}><div className="danger-copy"><p>系统会使用当前活动受众和关联内容。邮件渠道将进入统一 SMTP 队列；LinkedIn、电话、WhatsApp、短信和微信等渠道会为每位客户创建人工触达任务。</p><p>退订、投诉和退信地址仍会被抑制名单拦截。</p></div></Modal>
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
            options: [...outreachChannels],
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
      <Modal open={dialog === "calendar"} title="活动排期" description="按时间查看当前工作区的活动执行节点。" onClose={()=>setDialog(null)} footer={<><Button onClick={()=>setDialog(null)}>关闭</Button><Button variant="primary" onClick={()=>setDialog("schedule-node")}><Plus/>添加节点</Button></>}>
        <div className="campaign-content-dialog">{scheduleQuery.isLoading?<p>正在读取排期…</p>:scheduleQuery.data?.items.length?scheduleQuery.data.items.map(item=><article key={item.id}><i>{item.position}</i><span><strong>{item.name}</strong><small>{item.campaignName} · {item.scheduledAt?new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short"}).format(item.scheduledAt):"待安排"}</small></span><Badge tone={item.status==="completed"?"green":item.status==="cancelled"?"neutral":"blue"}>{item.status==="completed"?"已完成":item.status==="cancelled"?"已取消":"已排期"}</Badge></article>):<EmptyState className="list-empty-state compact" title="暂无排期节点" icon={CalendarDays} />}</div>
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
        <div className="recommendation-list">
          {recommendations.length ? recommendations.map((item,index)=>(
            <article key={item.title}>
              <b>{index+1}</b>
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
            </article>
          )) : <EmptyState className="list-empty-state compact" title="暂无优化建议" icon={Sparkles} />}
        </div>
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
        <div className="campaign-content-dialog">
          {selected?.contentItems.length ? selected.contentItems.map((item) => (
            <article key={item.id}>
              <i>{item.position}</i>
              <span>
                <strong>{item.title}</strong>
                <small>{item.purpose} · {item.contentType} · {item.status}</small>
              </span>
              <Badge tone={item.status==="已发布"?"green":"blue"}>{item.status}</Badge>
            </article>
          )) : <EmptyState className="list-empty-state compact" title="暂无关联内容" icon={Mail} />}
        </div>
      </Modal>
      <Modal
        open={utility === "menu"}
        title={`${selected?.name ?? ""} · 活动操作`}
        onClose={() => {
          setUtility(null);
          setSelected(null);
        }}
      >
        <div className="action-sheet-list">
          <Button onClick={() => setUtility("schedule")}>
            <CalendarDays />
            <span>
              <strong>调整排期</strong>
              <small>更改下一执行日期与发送时区</small>
            </span>
            <ArrowRight />
          </Button>
          <Button onClick={() => setUtility("content")}>
            <Mail />
            <span>
              <strong>查看活动内容</strong>
              <small>检查邮件、案例和跟进顺序</small>
            </span>
            <ArrowRight />
          </Button>
          <Button
            onClick={() => {
              setUtility(null);
            }}
          >
            <Target />
            <span>
              <strong>查看活动详情</strong>
              <small>打开执行流程和停止规则</small>
            </span>
            <ArrowRight />
          </Button>
        </div>
      </Modal>
    </div>
  );
}
