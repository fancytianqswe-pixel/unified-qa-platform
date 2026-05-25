---
name: 技能创建助手
description: 创建、修改、评估、基准测试、打包或优化可复用的 Skill。当用户明确在处理 SKILL.md 或某个 skill 文件夹、希望把可重复流程沉淀为可复用 skill、希望按 rubric 审核某个 skill、为 skill 运行评测或基准测试、优化 skill 的 description 以提升触发准确性，或将已完成的 skill 打包安装时，触发本技能。对于普通的一次性写作、编码、表格、PDF 或其他 artifact 任务，除非用户明确是在构建或维护可复用 skill，否则不要触发。
---

# 技能创建助手

Create new skills, revise existing skills, and evaluate skill quality with a controlled workflow.

This skill is for **skill lifecycle work** only: defining a reusable skill, improving it, validating it, and packaging it. It is **not** the right tool for completing the end-user task itself unless the user is explicitly asking to convert that task into a reusable skill.

## What this skill owns

Use this skill when the user wants to do one of these:

1. **Create** a new skill from a workflow, prompt pattern, or repeated task.
2. **Revise** an existing skill's routing, instructions, resources, or outputs.
3. **Evaluate** a skill with test prompts, assertions, or human review.
4. **Benchmark** two or more skill versions or compare a skill to a baseline.
5. **Optimize description / triggering** for a finished skill.
6. **Package** a ready skill into a distributable file.

## Do not trigger in these cases

Do **not** use this skill when:

- The user only wants a one-off answer or artifact, not a reusable skill.
- The user only wants general advice about prompts, agents, or product strategy.
- The user wants to edit a document, spreadsheet, PDF, or code file that is **not** a skill.
- The user asks for a dangerous, deceptive, malicious, or unauthorized skill.
- The user asks for actions outside the current permissions and is not asking to design the skill itself.

If the request is ambiguous, decide which of the routes below best matches the user's intent and say which route you are taking.

---

## Route first, then execute

Before doing anything else, classify the request into exactly one primary route.

### Route A — Create
Choose this when the user says things like:
- “Turn this workflow into a skill”
- “Make a skill for X”
- “Draft a SKILL.md”

Deliverable:
- New skill folder or draft `SKILL.md`
- Optional bundled resources
- Optional starter eval set

### Route B — Revise
Choose this when the user already has a skill and wants to change it.

Deliverable:
- Revised skill contents
- Summary of changes
- Diff or before/after explanation

### Route C — Evaluate / Audit
Choose this when the user wants to assess a skill against tests, a rubric, or observed behavior.

Deliverable:
- Test prompts and/or eval files
- Results summary
- Clear pass/fail or findings against requested criteria

### Route D — Benchmark / Compare
Choose this when the user wants to compare versions, compare against a baseline, or quantify improvement.

Deliverable:
- Benchmark inputs
- Comparison output and methodology
- Recommendation with evidence

### Route E — Optimize Description
Choose this only after the skill logic is already stable enough to optimize triggering.

Deliverable:
- Revised description candidates or best description
- Triggering evaluation summary
- Explicit before/after text

### Route F — Package
Choose this when the user wants a distributable installable file for a finished skill.

Deliverable:
- Packaged skill file
- Installation path or handoff path

If multiple routes are requested, execute them in this order unless the user specifies otherwise:
**Create/Revise → Evaluate → Benchmark/Compare → Optimize Description → Package**.

---

## Non-negotiable rules

These rules override convenience.

### Truthfulness and evidence

- **Do not invent** files, eval results, benchmark scores, human feedback, permissions, or tool outputs.
- **Do not guess** the contents of unread files or the behavior of unrun scripts.
- If a result was not actually produced, say so plainly.
- If a benchmark or grade is partial, label it partial.

### Permission and boundary control

- **Do not read, write, package, publish, overwrite, or delete** outside the paths and permissions you actually have.
- If authorization fails, a path is read-only, or a required tool is missing, stop that action and either degrade safely or ask the user to confirm an alternative.
- **Do not claim** installation, packaging, or file delivery succeeded unless you have the output file.

### Safe write behavior

Before any risky write action, you must do all applicable steps below:

1. Show or summarize what will change.
2. Preserve the original when feasible by editing a copy or keeping a backup.
3. Get user confirmation before destructive or user-visible-risk actions.
4. Only then write, overwrite, package, send, publish, or delete.

Risky actions include:
- Overwriting an existing `SKILL.md`
- Replacing a description in-place
- Writing assertions/evals the user will rely on
- Packaging a final installable skill
- Deleting files or modifying installed skills

### No silent route switching

- Do **not** silently switch to unrelated tools, sibling skills, or ad hoc substitute workflows when this skill defines a supported path.
- Prefer the bundled scripts and references in this skill over improvised replacements.
- Do **not** use `/skill-test` as a substitute path for this skill's evaluation workflow.
- Do **not** write a custom evaluator or custom HTML reviewer if `eval-viewer/generate_review.py` already covers the need.

### Security and acceptable use

- Do not help create misleading, malicious, exploitative, or unauthorized skills.
- Do not embed malware, credential capture, privilege escalation, or exfiltration logic.
- Refuse unsafe requests and offer a safer alternative when possible.

---

## Preflight checks

Run these checks before entering the main workflow.

### Required inputs by route

- **Create**: clear goal, trigger conditions, expected output, and at least one example or concrete scenario.
- **Revise**: existing skill folder or `SKILL.md`, plus the requested change.
- **Evaluate / Audit**: skill folder plus either test prompts, rubric, or desired success criteria.
- **Benchmark / Compare**: at least two candidates or one candidate plus a defined baseline.
- **Optimize Description**: stable skill logic and a trigger eval set or willingness to create one.
- **Package**: a finished skill folder with valid `SKILL.md` frontmatter.

### Environment checks

Check and record which of these are available if relevant:

- Writable working directory
- Python runtime for bundled scripts
- Browser/display or static HTML fallback
- Subagents / parallel execution support
- `claude -p` availability for description optimization scripts
- Ability to open or deliver output files to the user

### If a precondition is missing

Use this order:
1. See whether the missing detail already exists in the current conversation or files.
2. If it does not, ask only for the smallest missing piece.
3. If the route can safely degrade, say how and continue.
4. If the route cannot safely continue, stop and explain exactly why.

Never barrel ahead with guessed requirements.

### Hermes / Docker 网关上的路径（必读）

在 Hermes 网关或容器内执行 **Route C（评测）/ D（基准）** 并调用「按文件名查找、glob」等工具时：

- 待评测的**其他技能**通常位于 `~/.hermes/skills/<目录名>/SKILL.md`；若部署挂载了平台包，还可能在 `/opt/platform-skills/<目录>/SKILL.md`。
- **不要**仅在 `~/` 根目录用 `**/*.md` 盲搜并因 `total_count: 0` 就断定「技能加载失败」——容器主目录下可能没有 Markdown，这与技能未安装不是一回事。
- 应优先列出 `~/.hermes/skills/` 再进入子目录读取 `SKILL.md`，或请用户提供 Hermes 技能 id（如 `h0:dogfood`）或粘贴 `SKILL.md` 全文。

---

## File map and when to read each file

Keep `SKILL.md` focused. Load bundled resources only when needed.

### Core files

- `SKILL.md` — primary routing, workflow, and rules.
- `references/schemas.md` — read when you need exact JSON structure for evals, grading, benchmark, or related files.
- `agents/grader.md` — read before using a grader subagent.
- `agents/comparator.md` — read before blind A/B comparison.
- `agents/analyzer.md` — read before analyzing why one version beat another.

### Scripts

Use these instead of rewriting the same logic manually when applicable.

- `scripts/quick_validate.py` — basic validation / sanity checks
- `scripts/run_eval.py` — run triggering evals or description-related evals
- `scripts/run_loop.py` — iterative description optimization loop
- `scripts/aggregate_benchmark.py` — aggregate comparison results
- `scripts/generate_report.py` — generate summary/report outputs
- `scripts/improve_description.py` — description improvement helper
- `scripts/package_skill.py` — package a skill folder
- `eval-viewer/generate_review.py` — generate the review UI or static review artifact

If a repeated action is not yet scripted and will likely recur, prefer adding or reusing a script rather than stuffing large command logic into this file.

---

## State model

This skill should be treated as **filesystem-backed state**, not memory-backed state.

When you run a multi-step iteration, keep artifacts in the working skill folder or a dedicated writable copy. Typical state files include:

- `evals/evals.json`
- `feedback.json`
- `grading.json`
- `benchmark.json` / `benchmark.md`
- iteration folders or reports produced by scripts

Always tell the user where the important outputs were written.

---

## Output contract

A route is only complete when it produces the matching output below.

### Create
Must produce:
- Draft or final `SKILL.md`
- Clear description with routing conditions
- Any referenced files created or explicitly deferred

### Revise
Must produce:
- Updated skill contents
- What changed and why
- Confirmation of whether originals were preserved

### Evaluate / Audit
Must produce:
- Test prompts and/or eval assets actually used
- Results grounded in observed outputs
- Clear findings, including what was not tested

### Benchmark / Compare
Must produce:
- What variants were compared
- Method used
- Results summary tied to evidence
- Recommendation or conclusion

### Optimize Description
Must produce:
- Previous description
- New description candidate(s)
- Evidence for why the proposed description is better

### Package
Must produce:
- Final packaged file path
- Confirmation that packaging actually succeeded
- Any installation or handoff note the user needs

---

## Main workflow by route

## Route A — Create

### 1) Capture intent

Start by extracting what is already known from the current conversation and files before asking questions.

Collect these fields:
1. What capability should the skill enable?
2. When should it trigger?
3. When should it **not** trigger?
4. What is the expected output format?
5. What tools, scripts, permissions, or dependencies does it rely on?
6. What edge cases matter?
7. Should it include evals now, later, or not at all?

If the conversation already contains a workflow the user wants to capture, mine it for:
- sequence of steps
- tools used
- corrections and constraints
- observed input/output shapes
- success criteria

### 2) Research only what is necessary

If you need examples, similar skills, schemas, or platform facts, inspect the local skill files first. Use subagents only when they clearly reduce work and you actually have them.

### 3) Draft the skill

Write a first-pass `SKILL.md` that includes:
- explicit route conditions in the description
- non-trigger boundaries
- preconditions
- ordered workflow
- exceptions / gotchas
- output contract
- references to bundled resources instead of large inlined material

Prefer imperative instructions. Explain why critical steps matter when that improves reliability.

### 4) Validate the draft

Before calling the draft done, check:
- name is clear and not overlapping too much with sibling skills
- description includes trigger conditions and boundaries
- risky writes are guarded
- outputs are specified
- repeated actions are offloaded to scripts where appropriate

### 5) Propose test prompts

For objective or workflow-heavy skills, create 2-3 realistic user prompts and save them to `evals/evals.json`. Do not invent assertions yet unless the user requested them or the route requires them.

Show the prompts to the user before relying on them.

---

## Route B — Revise

1. Read the current skill and determine whether the requested change affects routing, execution, resources, evals, or packaging.
2. If the installed location may be read-only, copy the skill to a writable location first and preserve the original.
3. Summarize the intended edits before making risky changes.
4. Apply the edits.
5. Report exactly what changed, including any files added or moved.
6. Recommend evaluation if the edits affect triggering or core behavior.

Preserve the original skill name unless the user explicitly wants a rename.

---

## Route C — Evaluate / Audit

Use this route when the user wants to know whether a skill works, whether it meets a rubric, or what to improve next.

### Evaluation order

1. Confirm what is being evaluated: the current skill, a draft, or multiple versions.
2. Confirm the evaluation mode:
   - rubric / checklist review
   - prompt-based test run
   - human review of outputs
   - quantitative assertions
3. Define or collect test prompts.
4. Run the tests using the available environment.
5. Present results for human review before making major revisions.
6. Summarize findings and next actions.

### Rules for evaluation quality

- Do not grade outputs that were never generated.
- Do not claim quantitative rigor if you only performed qualitative review.
- If a viewer or benchmark tool fails, degrade to inline reporting and label the limitation.

### Review UI

If you need the human review UI, use `eval-viewer/generate_review.py` rather than inventing a bespoke reviewer.

---

## Route D — Benchmark / Compare

Use this when the goal is to compare versions, not just to get one route working.

### Minimum method

1. Define the candidates.
2. Define the comparison basis.
3. Run the same test set across candidates where possible.
4. Use the comparator/analyzer resources if blind comparison or analysis is needed.
5. Aggregate results with the provided scripts if available.
6. State the recommendation and why.

If conditions are not equivalent or sample sizes are small, say so explicitly.

---

## Route E — Optimize Description

Only do this after the skill body is reasonably stable. Do **not** optimize the description first and hope that it fixes weak instructions.

### Step 1: Build a triggering eval set
Create or refine a set of user queries that should trigger and should not trigger the skill. Good trigger evals are substantive, realistic, and varied. Avoid trivial one-step queries that Claude would handle directly without consulting any skill.

### Step 2: Review the eval set
Use the bundled review flow when available so the human can inspect, edit, add, remove, and export the eval set.

### Step 3: Run the optimization loop
If `claude -p` and the relevant scripts are available, run the optimization loop now and report progress while it executes. Do not promise future/background work. If the environment does not support the scripts, fall back to manual description proposals and label the result as manual.

### Step 4: Apply safely
Before replacing the existing description:
1. show the old and new description,
2. show the evidence,
3. get confirmation,
4. then update the frontmatter.

---

## Route F — Package

Package only when the user wants a deliverable installable artifact or clearly indicates the skill is finished enough.

### Packaging rules
- Validate the skill first if possible.
- Package from a writable copy if the installed path is read-only.
- Confirm the package path exists before telling the user it is ready.
- Preserve the original skill name unless the user asked to rename it.

Use:

```bash
python -m scripts.package_skill <path/to/skill-folder>
```

Report the resulting file path and any limitations of the delivery environment.

---

## Exception handling and gotchas

At minimum, handle these explicitly.

### Missing parameters or unclear intent

- Ask for the smallest missing input.
- If the conversation already contains the answer, do not ask again.

### Empty results

- If no meaningful eval output, benchmark output, or package file is produced, do not continue as if success happened.
- Explain what is missing and what you can do next.

### Permission failures / read-only paths

- Stop writes to that path.
- Copy to a writable path if safe and tell the user.
- Never imply the original installed skill was modified when it was not.

### Missing tools or environment support

- No browser/display: generate static HTML or report inline.
- No subagents: run serially and label the evaluation as lower-rigor.
- No `claude -p`: skip scripted description optimization and do manual proposals instead.
- No packaging capability: stop after validation and explain the blocker.

### Timeouts / flaky runs / rate limits

- Retry only when the operation is idempotent and failure looks transient.
- Keep retries bounded and say when a result may be incomplete.
- If repeated failures continue, stop and present the best grounded partial result.

---

## Environment-specific notes

### Claude.ai
- No subagents: run test cases one at a time.
- If there is no browser/display, present review output inline or generate a static file when possible.
- Skip quantitative benchmarking if the environment cannot support a meaningful baseline.
- Skip scripted description optimization if `claude -p` is unavailable.
- Packaging can still work if Python and filesystem access are available.

### Cowork
- Subagents are available, but you may still run serially if timeouts are severe.
- No browser/display: use static HTML output for the review UI.
- After running tests, generate the eval viewer before doing your own deep interpretation so the human can review examples early.
- Feedback may arrive as a downloaded file rather than a live service response.
- Description optimization should happen only after the skill itself is already in good shape.

---

## Maintenance guidance
- Keep the main `SKILL.md` readable and below roughly 500 lines.
- Move schemas, long templates, and repeated logic into `references/` and `scripts/`.
- If a route becomes large enough, split execution detail into a dedicated reference file and keep this file focused on routing and control rules.

---

## Completion checklist
Before finishing, confirm all that apply:
- The correct route was selected and stated.
- Preconditions were checked.
- Risky writes were previewed and confirmed.
- Results are grounded in real outputs.
- Important files were written to a known path.
- The user received the promised deliverable for the chosen route.

