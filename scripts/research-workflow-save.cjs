/* eslint-disable */
// Portable one-off: creates the "科研 Vibe Coding 协作流水线 v2" workflow (8 roles, 2 loops).
// Reads installed skills by NAME from skills.json, so it works on any machine that has imported
// the required skills (see 安装使用说明.md). Run with: node scripts/research-workflow-save.cjs
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { WorkflowStore, createWorkflowStepId } = require(path.join(__dirname, "..", "dist", "workflowStore.js"));

// --- Discover installed skills by name from skills.json ---
function loadSkillDirectoriesByName() {
  const candidates = [
    path.join(os.homedir(), ".claude-code-provider-switcher", "skills.json"),
    path.join(process.cwd(), ".claude-code-provider-switcher", "skills.json")
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const entries = Array.isArray(raw.skills) ? raw.skills : [];
      const map = new Map();
      for (const entry of entries) {
        if (entry && entry.name && entry.directory) {
          map.set(String(entry.name).trim(), entry.directory);
        }
      }
      if (map.size > 0) return map;
    } catch {
      /* try next */
    }
  }
  return new Map();
}

const skillByName = loadSkillDirectoriesByName();
function skillDir(name) {
  const dir = skillByName.get(name);
  if (!dir) console.warn(`  ⚠ skill not found in skills.json, step will run without a skill: ${name}`);
  return dir;
}

const DEEPSEEK = "preset-deepseek";
const PRO = "deepseek-v4-pro";
const FLASH = "deepseek-v4-flash";

const literatureId = createWorkflowStepId();
const researcherId = createWorkflowStepId();
const architectId = createWorkflowStepId();
const coderId = createWorkflowStepId();
const testerId = createWorkflowStepId();
const statsId = createWorkflowStepId();
const writerId = createWorkflowStepId();
const reviewerId = createWorkflowStepId();

const steps = [
  {
    id: literatureId,
    name: "文献综述员 Literature Reviewer",
    providerId: DEEPSEEK, model: PRO,
    skillDirectory: skillDir("Literature Review"),
    prompt: [
      "你是文献综述员（科研 vibe-coding · 角色 1/8）。",
      "针对任务，梳理相关已有工作、关键方法与已知结论，明确研究空白(research gap)。",
      "输出结构化综述：①核心已有工作 ②主流方法 ③研究空白 ④可借鉴思路。不要写代码。",
      "", "任务: {{task}}"
    ].join("\n")
  },
  {
    id: researcherId,
    name: "研究设计员 Research Designer",
    providerId: DEEPSEEK, model: PRO,
    skillDirectory: skillDir("Deep Research"),
    prompt: [
      "你是研究设计员（科研 vibe-coding · 角色 2/8）。",
      "基于文献综述，提出可检验假设，设计研究：变量、实验/分析设计、数据需求、可复现性约束。",
      "输出：研究问题、假设、变量定义、分析设计、数据需求。不要写代码。",
      "", "文献综述:", "{{previous}}"
    ].join("\n")
  },
  {
    id: architectId,
    name: "架构师 Architect",
    providerId: DEEPSEEK, model: PRO, skillDirectory: undefined,
    prompt: [
      "你是科研工程架构师（科研 vibe-coding · 角色 3/8）。",
      "基于研究设计，给出可复现的分析/代码方案：模块拆分、技术栈(Python优先)、数据流、目录结构、验证策略。",
      "只输出技术方案（伪代码/模块清单），先不写完整实现。",
      "", "研究设计:", "{{previous}}"
    ].join("\n")
  },
  {
    id: coderId,
    name: "原型编码者 Prototype Coder",
    providerId: DEEPSEEK, model: FLASH,
    execute: true,
    skillDirectory: skillDir("Exploratory Data Analysis"),
    prompt: [
      "你是数据分析工程师，vibe coding 风格：用最少的代码快速验证假设，保持可复现与可读（科研 vibe-coding · 角色 4/8）。",
      "如果输入是 Review loop revision context，请优先根据其中的 review feedback 修正代码（不要只复述反馈）。",
      "基于技术方案，编写探索性数据分析(EDA)代码：数据加载/清洗/EDA/可视化，并简要说明每步科学依据。",
      "直接给出可运行 Python 代码块（pandas 优先），代码必须自包含、可独立运行。",
      "", "输入:", "{{previous}}"
    ].join("\n")
  },
  {
    id: testerId,
    name: "代码测试员 Code Tester",
    providerId: DEEPSEEK, model: PRO, skillDirectory: undefined,
    prompt: [
      "你是代码测试员（科研 vibe-coding · 角色 5/8）。",
      "对上面的代码做静态测试与审查：编写关键 pytest 测试用例（边界、空值、数值正确性、可复现性），并逐条 mentally trace 执行，判断能否通过。",
      "如果代码正确且测试用例齐全能通过，第一行写 `Decision: APPROVED`，再给出测试用例与通过说明。",
      "如果有 bug、不可运行、或测试会失败，第一行写 `Decision: REVISE`，再给出失败测试与具体修复要求。",
      "只有代码无需修改时才写 APPROVED；任何需要修改的情况都必须写 REVISE。",
      "", "待测代码:", "{{previous}}"
    ].join("\n")
  },
  {
    id: statsId,
    name: "统计审稿人 Statistical Reviewer",
    providerId: DEEPSEEK, model: PRO,
    skillDirectory: skillDir("Statistical Analysis"),
    prompt: [
      "你是统计方法学审稿人（科研 vibe-coding · 角色 6/8）。",
      "审视上面的(已通过测试的)分析代码与统计方法，从假设检验、多重比较、效应量、样本量、可复现性角度指出问题，给出修正建议与关键代码片段。",
      "", "待审分析:", "{{previous}}"
    ].join("\n")
  },
  {
    id: writerId,
    name: "科学写作 Scientific Writer",
    providerId: DEEPSEEK, model: PRO,
    skillDirectory: skillDir("Scientific Writing"),
    prompt: [
      "你是科学写作助手（科研 vibe-coding · 角色 7/8）。",
      "如果输入是 Review loop revision context，请优先根据 peer review feedback 修订初稿。",
      "基于以上研究、代码与统计审稿，撰写 IMRAD 结构的方法(Methods)与结果(Results)初稿。",
      "要求：完整段落、不要 bullet、APA 引用风格、可复现性描述清晰。",
      "", "输入材料:", "{{previous}}"
    ].join("\n")
  },
  {
    id: reviewerId,
    name: "同行评审 Peer Reviewer",
    providerId: DEEPSEEK, model: PRO,
    skillDirectory: skillDir("Academic Paper Reviewer"),
    prompt: [
      "你是严格的同行评审（科研 vibe-coding · 角色 8/8）。",
      "对下面的方法与结果初稿做评审，给出 接受/小修/大修/拒绝 判断、3 条主要问题、3 条改进建议。",
      "第一行必须写 `Decision: APPROVED` 或 `Decision: REVISE`。只有无需继续修改时才写 APPROVED；小修/大修/拒绝都必须写 REVISE。",
      "", "初稿:", "{{previous}}"
    ].join("\n")
  }
];

(async () => {
  console.log("Discovered skills:", skillByName.size > 0 ? [...skillByName.keys()].join(", ") : "(none — skills.json not found)");
  const store = new WorkflowStore();
  const existing = await store.getWorkflows();
  const prior = existing.find((wf) => wf.name.startsWith("科研 Vibe Coding"));
  if (prior) {
    await store.deleteWorkflow(prior.id);
    console.log("Removed previous version:", prior.name);
  }
  const wf = await store.createWorkflow(
    "科研 Vibe Coding 协作流水线 v2",
    steps,
    "8 角色全流程：文献综述→研究设计→架构→[代码测试循环: 编码↔测试]→统计审稿→[稿件评审循环: 写作↔同行评审]。pro 为主，flash 负责快速原型编码。两个循环各自最多 3 轮，实现自主纠错。",
    [
      { enabled: true, name: "code-test", reviseFromStepId: coderId, reviewStepId: testerId, maxIterations: 3 },
      { enabled: true, name: "manuscript-review", reviseFromStepId: writerId, reviewStepId: reviewerId, maxIterations: 3 }
    ]
  );
  console.log("\nSaved workflow:", wf.id);
  console.log("Steps:");
  wf.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} [${s.model}]${s.skillDirectory ? " +skill" : " (no skill)"}`));
  console.log("Loops:", wf.reviewLoops.map((l) => l.name).join(", "));
  console.log("File:", path.join(os.homedir(), ".claude-code-provider-switcher", "workflows.json"));
})().catch((err) => { console.error(err); process.exit(1); });
