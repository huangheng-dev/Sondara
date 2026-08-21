/**
 * Customer stage state machine.
 *
 * Defines the canonical progression of a customer through the cross-border
 * acquisition funnel, along with allowed transitions, default next actions,
 * and badge tone mapping. Both the customer list and the detail drawer should
 * derive stage metadata from here instead of hard-coding strings.
 *
 * Stage flow:
 *   待补全 → 待验证 → 培育中 → 重点跟进 → 有商机 → 已成交
 *                                ↑           ↓
 *                              停滞 ←─── 已流失
 *
 * Archiving is a separate flag (archivedAt), not a stage value.
 */

export type CustomerStage =
  | "待补全"
  | "待验证"
  | "培育中"
  | "重点跟进"
  | "有商机"
  | "已成交"
  | "停滞"
  | "已流失";

export type StageTone = "neutral" | "orange" | "blue" | "green" | "red";

export interface StageDefinition {
  value: CustomerStage;
  label: string;
  tone: StageTone;
  /** Short description shown in stage selector and tooltips. */
  description: string;
  /** Default "next action" suggestion when a customer enters this stage. */
  defaultNextAction: string;
  /** Stages this stage can move to via the UI. */
  canMoveTo: CustomerStage[];
  /** Sort order used in lists and filters. */
  order: number;
}

export const CUSTOMER_STAGES: StageDefinition[] = [
  {
    value: "待补全",
    label: "待补全",
    tone: "neutral",
    description: "企业资料不完整，缺少行业、地区或联系人信息。",
    defaultNextAction: "补全企业档案和联系人信息",
    canMoveTo: ["待验证", "培育中"],
    order: 1,
  },
  {
    value: "待验证",
    label: "待验证",
    tone: "orange",
    description: "已导入或雷达发现，需要验证企业和联系人真实性。",
    defaultNextAction: "验证企业信息和联系人邮箱",
    canMoveTo: ["培育中", "待补全", "已流失"],
    order: 2,
  },
  {
    value: "培育中",
    label: "培育中",
    tone: "blue",
    description: "已验证，正在通过内容和轻触达培育需求。",
    defaultNextAction: "发送培育内容或行业洞察",
    canMoveTo: ["重点跟进", "停滞", "已流失"],
    order: 3,
  },
  {
    value: "重点跟进",
    label: "重点跟进",
    tone: "orange",
    description: "出现明确购买信号，安排主动触达和深度沟通。",
    defaultNextAction: "安排首次深度沟通或产品演示",
    canMoveTo: ["有商机", "培育中", "停滞", "已流失"],
    order: 4,
  },
  {
    value: "有商机",
    label: "有商机",
    tone: "green",
    description: "已确认需求和预算，进入报价、谈判或合同阶段。",
    defaultNextAction: "推进报价和合同流程",
    canMoveTo: ["已成交", "停滞", "已流失", "重点跟进"],
    order: 5,
  },
  {
    value: "已成交",
    label: "已成交",
    tone: "green",
    description: "合同签署或首付款到账，进入交付和复购维护。",
    defaultNextAction: "启动交付并确认首单到账",
    canMoveTo: ["重点跟进"],
    order: 6,
  },
  {
    value: "停滞",
    label: "停滞",
    tone: "neutral",
    description: "客户暂时无回应或项目延期，定期回访即可。",
    defaultNextAction: "设定回访提醒，暂停主动触达",
    canMoveTo: ["培育中", "重点跟进", "有商机", "已流失"],
    order: 7,
  },
  {
    value: "已流失",
    label: "已流失",
    tone: "red",
    description: "明确拒绝、选择竞品或预算取消。保留记录用于复盘。",
    defaultNextAction: "记录流失原因，暂停触达",
    canMoveTo: ["培育中", "重点跟进"],
    order: 8,
  },
];

const STAGE_MAP = new Map(CUSTOMER_STAGES.map((s) => [s.value, s]));

export function getStageDefinition(stage: string): StageDefinition | undefined {
  return STAGE_MAP.get(stage as CustomerStage);
}

export function getStageTone(stage: string): StageTone {
  return STAGE_MAP.get(stage as CustomerStage)?.tone ?? "neutral";
}

export function getDefaultNextAction(stage: string): string {
  return STAGE_MAP.get(stage as CustomerStage)?.defaultNextAction ?? "补全企业档案";
}

export function canTransitionTo(from: string, to: CustomerStage): boolean {
  const def = STAGE_MAP.get(from as CustomerStage);
  if (!def) return true; // unknown stage → allow setting to anything
  return def.canMoveTo.includes(to);
}

/**
 * Suggest the next stage based on objective customer signals.
 * Returns null if no change is recommended.
 */
export function suggestStage(input: {
  currentStage: string;
  score: number;
  validContacts: number;
  hasDeal?: boolean;
  hasRecentReply?: boolean;
  noResponseDays?: number;
}): CustomerStage | null {
  if (input.hasDeal && ["重点跟进", "培育中", "待验证"].includes(input.currentStage)) {
    return "有商机";
  }
  if (input.score >= 90 && input.validContacts > 0 && ["待补全", "待验证", "培育中"].includes(input.currentStage)) {
    return "重点跟进";
  }
  if (input.score >= 70 && input.validContacts > 0 && ["待补全", "待验证"].includes(input.currentStage)) {
    return "培育中";
  }
  if (input.validContacts > 0 && input.currentStage === "待补全") {
    return "待验证";
  }
  if (input.noResponseDays && input.noResponseDays >= 30 && ["培育中", "重点跟进", "有商机"].includes(input.currentStage)) {
    return "停滞";
  }
  if (input.hasRecentReply && input.currentStage === "停滞") {
    return input.score >= 85 ? "重点跟进" : "培育中";
  }
  return null;
}
