import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canTransitionTo,
  getDefaultNextAction,
  getStageDefinition,
  getStageTone,
  suggestStage,
} from "./customer-stages";

describe("customer stages", () => {
  it("exposes canonical metadata for every lifecycle stage", () => {
    assert.equal(getStageDefinition("有商机")?.tone, "green");
    assert.equal(getStageTone("已流失"), "red");
    assert.match(getDefaultNextAction("已成交"), /交付|到账/);
  });

  it("allows configured transitions and rejects backwards or unsupported jumps", () => {
    assert.equal(canTransitionTo("待验证", "培育中"), true);
    assert.equal(canTransitionTo("培育中", "已成交"), false);
    assert.equal(canTransitionTo("未知阶段", "待补全"), true);
  });

  it("suggests objective progression from score, contacts and deals", () => {
    assert.equal(
      suggestStage({ currentStage: "待补全", score: 50, validContacts: 1 }),
      "待验证",
    );
    assert.equal(
      suggestStage({ currentStage: "待验证", score: 74, validContacts: 2 }),
      "培育中",
    );
    assert.equal(
      suggestStage({ currentStage: "培育中", score: 92, validContacts: 2 }),
      "重点跟进",
    );
    assert.equal(
      suggestStage({ currentStage: "重点跟进", score: 80, validContacts: 2, hasDeal: true }),
      "有商机",
    );
  });

  it("suggests staleness and reactivation without changing unrelated stages", () => {
    assert.equal(
      suggestStage({ currentStage: "重点跟进", score: 80, validContacts: 2, noResponseDays: 45 }),
      "停滞",
    );
    assert.equal(
      suggestStage({ currentStage: "停滞", score: 88, validContacts: 2, hasRecentReply: true }),
      "重点跟进",
    );
    assert.equal(
      suggestStage({ currentStage: "已成交", score: 99, validContacts: 5 }),
      null,
    );
  });
});
