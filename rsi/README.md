# RSI Harness

An evaluation-driven, scaffold-level recursive self-improvement loop for coding agents.

This is **not** weight-level self-modification. The base model is frozen. What can change is the external scaffold: candidate code, the proposer prompt template, the lesson memory, and the benchmark suite. Every change is judged by executable tests, a performance budget, and a static policy check before it can be accepted.

The harness has zero runtime dependencies and uses only Node.js built-ins (`node:test`, `node:child_process`, `node:fs`). Tested on Node 26.4.0; it requires Node 20+.

## Quick start

From the repository root:

```bash
npm run rsi -- list
npm run rsi:test
npm run rsi:demo
```

`npm run rsi:demo` runs a **scripted reference oracle** over all twelve benchmark tasks. It proves that the sandbox, evaluator, acceptance gate, and report writer work end to end. It is not evidence that a model improved itself: the proposals are hard-coded correct solutions.

A real model run uses the Claude Code CLI:

```bash
node rsi/bin/rsi.mjs run --task interval-merge --proposer command --iterations 3
node rsi/bin/rsi.mjs suite --tasks interval-merge,lru-cache --proposer command
node rsi/bin/rsi.mjs meta --tasks interval-merge,lru-cache --rounds 2
```

Provider selection uses the same config as the VS Code extension:

```bash
node rsi/bin/rsi.mjs run --task top-k-frequent --proposer command --provider <profile-id> --model <model>
node rsi/bin/rsi.mjs run --task top-k-frequent --proposer http --provider <profile-id> --model <model>
```

`--proposer command` invokes `claude -p --output-format text` and sends the prompt on stdin. `--proposer http` calls an Anthropic-compatible `/v1/messages` endpoint directly. `--proposer reference` is the scripted oracle used by tests and the demo.

## Commands

```text
node rsi/bin/rsi.mjs list [--json]
node rsi/bin/rsi.mjs run --task <id> [options]
node rsi/bin/rsi.mjs suite [--tasks <id,id>] [options]
node rsi/bin/rsi.mjs meta --tasks <id,id> [--rounds 2] [options]
node rsi/bin/rsi.mjs demo [--json]
node rsi/bin/rsi.mjs doctor [--json]
```

Common options:

| Option | Meaning |
| --- | --- |
| `--proposer reference\|command\|http` | Proposal backend. Default `command`. |
| `--provider <id>` | Provider profile from the switcher config. |
| `--model <name>` | Model override for the CLI/HTTP proposer. |
| `--iterations <n>` | Maximum proposal iterations per task. Default 3. |
| `--min-delta <n>` | Minimum score improvement to accept. Default 0.01. |
| `--timeout <ms>` | Proposer timeout. Default 300000. |
| `--no-archive` | Do not write `rsi/runs/`. |
| `--archive-dir <dir>` | Alternate run archive and lesson store. |
| `--json` | Machine-readable output on stdout. |
| `--apply --target <dir> --yes` | Human-gated write of the best files into an existing directory. |
| `--rounds`, `--max-regression`, `--min-cost-reduction` | Meta-loop controls. |

`doctor` prints the Node version, benchmark list, config path, and a redacted provider summary. It never prints tokens.

## Loop architecture

```text
task spec + weak baseline
        |
        v
  proposer (CLI / HTTP / scripted)
        |
        v
  allow-list validation  (editable paths, size, non-empty)
        |
        v
  static policy check    (fs, child_process, net, env, eval, ...)
        |
        v
  temp sandbox           (workspace + public tests + benchmark + TASK.md)
        |
        +--> public tests (TAP) --> hidden tests (TAP) --> benchmark (median)
        |
        v
  score + gate: score > best + minDelta AND hidden pass rate not lower
        |
        +--> accept: update best files, clear failure memory
        +--> reject: summarize failure for the next prompt
        |
        v
  lessons.jsonl + runs/<task>/iterations.jsonl + best files + report.md
```

At the start of a run, the weak baseline is evaluated with the benchmark enabled too, so it has the same score basis as candidates. If a baseline or candidate benchmark exceeds its timeout, performance is scored as zero rather than hanging the loop indefinitely.

### Score

Weights come from `task.json` and are normalized:

```text
score = correctness_weight * hidden_pass_rate
      + performance_weight * performance_score
      + quality_weight * quality_score
```

- `hidden_pass_rate` is the TAP pass count divided by the total hidden test count.
- `performance_score` is 1 at or below `targetMs`, 0 at or above `maxMs`, and linear in between. The benchmark median is used.
- `quality_score` starts at 1 and loses 0.25 per static policy violation, plus 0.1 if total editable bytes exceed 1.5x the per-file limit.

A candidate is accepted only if:

```text
candidate.score > previousBest.score + minDelta
AND candidate.hiddenPassRate >= previousBest.hiddenPassRate - 1e-9
```

This deliberately forbids trading correctness for speed. The loop stops early when the best score reaches `targetScore` (default 0.98).

### Hidden tests

Hidden test files are stored in the task directory but are copied into a separate `hidden/` directory inside the sandbox only after the public tests run. The proposer sees aggregate pass/fail counts and the names of failing hidden tests, never their source or inputs. The command proposer also runs in an empty temporary directory by default, so a tool-using model cannot read the repository's `hidden/` directories or evaluator source. Pass `--proposer-cwd <dir>` only when you deliberately want to give it a workspace. This limits, but does not eliminate, overfitting to the test names.

### Static policy check

Candidate code is rejected before execution if it matches any of these patterns:

- `fs`, `child_process`, `net`, `http`, `https`, `dgram`, `tls`, `worker_threads`, `vm`
- `process.env`
- dynamic `import()`
- `eval`
- `new Function`

This is a coarse regex-based guard, not a hardened sandbox. Candidate code still executes as the current user. Do not point the harness at untrusted third-party code without OS-level isolation (container, VM, restricted user). The evaluation child environment strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and other non-essential variables.

### Lesson memory

Accepted and rejected proposals can contribute lessons. Lessons are stored in JSONL, deduplicated case-insensitively, and retrieved by token overlap with the task id/title/category/tags plus an accepted/score-delta bonus. They are injected into the next proposal prompt. This is the main mechanism by which experience persists across tasks and runs.

### Run archive

```text
rsi/runs/
  lessons.jsonl
  algorithms-interval-merge/
    iterations.jsonl
    report.md
    best/solution.js
```

`rsi/runs/` and `rsi/.cache/` are git-ignored. Reports contain scores, hidden/public counts, benchmark times, acceptance decisions, and rationales. They do not contain provider tokens.

## Meta-loop: prompt template optimization

`meta` optimizes the proposer prompt itself:

1. Evaluate the current `rsi/prompts/proposer.v1.md` template on the validation tasks.
2. Ask the meta proposer (`claude -p`, using `rsi/prompts/meta.v1.md`) for a full replacement template in JSON.
3. Validate length (200–30000 chars) and require every placeholder used by the proposal prompt.
4. Evaluate the candidate template on the same tasks.
5. Accept if the mean best score improves by at least `minDelta` and no task regresses by more than `maxRegression` (default 0.03). If the validation scores are already saturated, accept a template that is at least `minCostReduction` (default 10%) shorter, provided every task keeps its previous score. Prompt length is a deterministic proxy for proposer input cost.

Every meta round is archived under `rsi/runs/meta/` (`latest.md`, `latest.json`, plus timestamped copies). The accepted template is **not** written back automatically: use `--apply --yes [--target rsi/prompts/proposer.v1.md]` after reviewing it. The meta-loop changes prompts, not weights or evaluator code. It cannot add tests or change scoring. This is intentional: the optimizer must not be able to redefine success.

The real model run used during development accepted two consecutive shortening rounds on `interval-merge` and `lru-cache` while both tasks stayed at score 1.0 (1784 → 1428 → 1213 characters). A later verification run archived a one-round result at 1784 → 1444 characters (about 19% shorter). This is a genuine scaffold-level improvement that does not require a score gain: the same behavior with a smaller prompt.

## Task format

```text
rsi/benchmarks/algorithms/<task>/
  task.json
  prompt.md
  workspace/           # weak baseline (editable files)
  tests/               # public tests, visible to the proposer
  hidden/              # held-out tests, not visible to the proposer
  bench.mjs            # prints {"ms": <number>, ...}
```

Minimal `task.json`:

```json
{
  "id": "algorithms/interval-merge",
  "title": "Merge Intervals",
  "category": "algorithms",
  "difficulty": 2,
  "tags": ["sorting", "intervals", "greedy"],
  "prompt": "prompt.md",
  "workspace": "workspace",
  "editable": ["solution.js"],
  "publicTestsDir": "tests",
  "hiddenTestsDir": "hidden",
  "testCommand": ["node", "--test", "--test-reporter=tap", "tests/public.test.mjs"],
  "hiddenCommand": ["node", "--test", "--test-reporter=tap", "hidden.test.mjs"],
  "benchmarkFile": "bench.mjs",
  "benchmark": {
    "command": ["node", "bench.mjs"],
    "targetMs": 120,
    "maxMs": 1000,
    "runs": 3,
    "timeoutMs": 20000
  },
  "timeoutMs": 30000,
  "maxFileBytes": 30000,
  "weights": { "correctness": 0.7, "performance": 0.2, "quality": 0.1 }
}
```

Important details:

- Put `--test-reporter=tap` **before** the test file. Node may otherwise use the spec reporter and the harness will fall back to treating the whole command as one test.
- Test files import the editable module relative to their own location. Public tests run with the sandbox root as cwd (`tests/public.test.mjs`); hidden tests run with `hidden/` as cwd (`hidden.test.mjs`).
- Benchmarks print one JSON line with `ms`, `elapsedMs`, or `timeMs`. The harness takes the median of `runs` successful runs.
- The baseline should be deliberately weak. It can be incorrect (like interval-merge), or correct but algorithmically slow (like the other eleven tasks).
- Hidden tests should include seeded randomized cases against an independent reference implementation, not just hand-picked examples.

## Current benchmark suite

| Task | Baseline weakness | Main lesson |
| --- | --- | --- |
| `algorithms/interval-merge` | Does not sort, so unsorted input is wrong | Sort before merging; copy input; handle touching intervals |
| `algorithms/lru-cache` | Array scan on every operation | Map plus recency tracking gives average O(1) |
| `algorithms/top-k-frequent` | Full scan per distinct value | Count once, then sort counts |
| `algorithms/edit-distance` | Exponential recursion with slicing | Iterative DP with two rows |
| `algorithms/sliding-window-max` | Nested scan of every window | Monotonic deque gives O(n) |
| `algorithms/union-find` | Unbalanced parent chain, no compression | Path compression plus union by size/rank |
| `algorithms/median-stream` | Sorts the whole stream on every query | Two balanced heaps give O(log n) updates |
| `algorithms/dijkstra` | Bellman-Ford relaxation in adversarial edge order | Adjacency list plus binary heap gives O((V+E) log V) |
| `algorithms/lfu-cache` | Scans every entry on eviction | Frequency buckets with recency-ordered membership give O(1) |
| `algorithms/regex-match` | Exponential recursive branching | DP over text and pattern positions |
| `algorithms/aho-corasick` | Checks every pattern at every text position | Trie plus failure links, then aggregate visits |
| `algorithms/max-flow` | Edmonds-Karp re-scans dead-end decoys on every augmentation | Dinic level graph plus blocking flow |

Scripted-oracle demo result (not a model measurement):

```text
task                          baseline   best   delta   hidden
algorithms/aho-corasick       0.8000    1.0000  0.2000   3/3
algorithms/dijkstra           0.8000    1.0000  0.2000   2/2
algorithms/edit-distance      0.8000    1.0000  0.2000   2/2
algorithms/interval-merge     0.6500    1.0000  0.3500   4/4
algorithms/lfu-cache          0.8000    1.0000  0.2000   3/3
algorithms/lru-cache          0.8810    1.0000  0.1190   3/3
algorithms/max-flow           0.8000    1.0000  0.2000   4/4
algorithms/median-stream      0.8000    1.0000  0.2000   2/2
algorithms/regex-match        0.8000    1.0000  0.2000   3/3
algorithms/sliding-window-max 0.8000    1.0000  0.2000   3/3
algorithms/top-k-frequent     0.8000    1.0000  0.2000   2/2
algorithms/union-find         0.8000    1.0000  0.2000   3/3
```

The optimization baselines are correct but miss the performance budget, so their score is `0.7 * 1 + 0.2 * 0 + 0.1 * 1 = 0.8`. The interval-merge baseline additionally fails two hidden correctness tests. Benchmark times vary by machine; the demo asserts hidden-test success, not a fixed score.

## Repository layout

```text
rsi/
  bin/rsi.mjs             CLI
  src/task.mjs            task loading and validation
  src/workspace.mjs       sandbox creation, proposal validation, apply
  src/evaluator.mjs       commands, TAP parsing, static check, benchmark, scoring
  src/prompts.mjs         prompt rendering and formatting
  src/proposers.mjs       scripted, CLI, and HTTP proposers
  src/provider.mjs        switcher config and provider environment mapping
  src/memory.mjs          lesson store and run archive
  src/loop.mjs            per-task and suite loops
  src/meta.mjs            prompt-template meta-optimization
  prompts/proposer.v1.md  current proposer template
  prompts/meta.v1.md      meta-optimizer template
  benchmarks/             tasks and reference solutions
  examples/demo.mjs       scripted end-to-end demo
  tests/                  node:test suite
```

## What improves, and what does not

What can improve:

- Candidate implementations, selected by hidden tests and a performance budget.
- The proposer prompt template, selected by validation-suite performance.
- Lesson memory, which changes future prompts.
- The benchmark suite itself, when a human adds tasks (this is manual and audited).

What does not improve:

- Base model weights.
- The evaluator, hidden tests, or scoring rules during a loop.
- The model's raw reasoning ability.

This distinction matters. Calling the loop "RSI" is useful shorthand for the scaffold, but it is not evidence of recursive weight-level self-improvement. The honest claim is: **the system can accumulate verified improvements to its external problem-solving scaffold, subject to the tests we can write.**

## Safety and limitations

- Not a hardened security sandbox. Static checks are regex-based and can be bypassed in principle. Use OS-level isolation for untrusted code.
- Hidden tests are fixed. Repeated iterations can overfit to test names or distributions. Add held-out tests and randomized generators before trusting a score.
- Benchmarks are noisy and machine-dependent. The harness uses medians and generous target/max bands, but a slow CI machine can reduce performance scores.
- The same model family often proposes and evaluates. There is no independent oracle beyond the tests.
- The acceptance gate prevents hidden-pass-rate regression, but a candidate can still pass tests with hard-coded outputs. Randomized hidden tests and static checks reduce this risk; they do not prove generality.
- `--apply` is human-gated and requires an explicit existing target directory plus `--yes`. The loop never modifies a real repository by default.
- Do not commit `rsi/runs/`, provider configs, tokens, or generated best files unless you have reviewed them.

## Roadmap

- Add repo-level tasks with multi-file edits and project test suites.
- Generate held-out property-based tests per iteration instead of one fixed hidden suite.
- Mutation testing to detect weak hidden tests.
- Patch-based proposals plus a reviewer model that must justify the diff.
- Cost and latency budgets alongside score.
- Multi-proposer ensembles and cross-model review.
- Contamination checks that reject suspiciously specific solutions.
- A human review UI that shows the diff, test deltas, and benchmark deltas before `--apply`.
