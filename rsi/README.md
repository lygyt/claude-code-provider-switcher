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
node rsi/bin/rsi.mjs suite --proposer command --optimize-performance --iterations 3
node rsi/bin/rsi.mjs doctor --calibrate --tasks top-k-frequent,union-find
npm run rsi:measure -- --before rsi/runs --after rsi/runs/bench/after --json
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
node rsi/bin/rsi.mjs doctor [--calibrate] [--tasks <id,id>] [--trials <n>] [--json]
```

Common options:

| Option | Meaning |
| --- | --- |
| `--proposer reference\|command\|http` | Proposal backend. Default `command`. |
| `--provider <id>` | Provider profile from the switcher config. |
| `--model <name>` | Model override for the CLI/HTTP proposer. |
| `--iterations <n>` | Maximum proposal iterations per task. Default 3. |
| `--min-delta <n>` | Minimum score improvement to accept. Default 0.01. |
| `--optimize-performance` | Continue after `targetScore` and accept an equal-score candidate when it is sufficiently faster (`--min-speedup` and `--min-speedup-ms`). |
| `--min-speedup <n>` | Minimum fractional benchmark reduction for a performance-only win. Default 0.05. |
| `--min-speedup-ms <ms>` | Minimum absolute benchmark win for a performance-only acceptance. Default 0.5. |
| `--timeout <ms>` | Proposer timeout. Default 300000. |
| `--no-archive` | Do not write `rsi/runs/`. |
| `--archive-dir <dir>` | Alternate run archive and lesson store. |
| `--json` | Machine-readable output on stdout. |
| `--apply --target <dir> --yes` | Human-gated write of the best files into an existing directory. |
| `--rounds`, `--max-regression`, `--min-cost-reduction` | Meta-loop controls. |

`doctor` prints the Node version, benchmark list, config path, and a redacted provider summary. It never prints tokens. With `--calibrate`, it also measures every selected task's reference solution against itself, runs `--trials` independent trials per task (default 5), and exits 1 if the performance gate would accept identical code.

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
  gate: hidden pass rate not lower AND
        (score > best + minDelta OR performance-only win)
        |
        +--> accept: update best files, clear failure memory
        +--> reject: summarize failure (tests, policy, benchmark shortfall)
        |
        v
  lessons.jsonl + runs/<task>/iterations.jsonl + best files + report.md
```

At the start of a run, the weak baseline is evaluated with the benchmark enabled too, so it has the same score basis as candidates. If a baseline or candidate benchmark exceeds its timeout, performance is scored as zero rather than hanging the loop indefinitely.

Each proposal prompt includes the current best hidden/public counts, measured median benchmark time, target, maximum, and performance score. With `--optimize-performance`, the baseline and every candidate use at least five benchmark runs, the loop does not stop at `targetScore`, and an equal-score candidate is accepted when its median is at least `--min-speedup` faster and at least `--min-speedup-ms` milliseconds faster. When the current best has a usable benchmark, every candidate is measured against it in alternating rounds inside two sandboxes, and both sides are scored from that one comparison. If the best never completed a benchmark run (for example, an exponential starter that times out), the first candidate is measured alone and a score acceptance establishes the reference.

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

A candidate's hidden pass rate must never fall. Given that, it is accepted if either:

```text
candidate.score > previousBest.score + minDelta
```

or, with `--optimize-performance`, when the score is not lower and the benchmark improves by at least `minSpeedup` **and** at least `minSpeedupMs` milliseconds. When a paired comparison is available, the gate uses the per-round differences rather than two independent medians:

```text
candidate.score >= previousBest.score - 1e-9
AND median(candidate_i / previousBest_i) < 1 - minSpeedup
AND median(previousBest_i - candidate_i) >= minSpeedupMs
AND candidate_wins >= ceil(5/6 * paired_rounds)
AND the same conditions hold in a second, independent comparison
```

Round `i` runs the candidate and the best back to back. Requiring a win in almost every round rejects a single lucky pair, and the second comparison rejects a timing artifact that does not reproduce. Without a paired comparison (for example, when calling `acceptanceDecision` directly), the medians provide the fallback: `candidate.benchMs < previousBest.benchMs * (1 - minSpeedup)` and `previousBest.benchMs - candidate.benchMs >= minSpeedupMs`.

This deliberately forbids trading correctness for speed. The absolute floor keeps sub-millisecond timer noise from counting as a win; the regex-match benchmark originally exposed this failure mode (a 0.01ms median could "improve" to 0.00ms), so that workload was recalibrated. The union-find and top-k-frequent workloads were later enlarged (3M elements; 250k numbers called three times) because their optimized times sat under 10ms, where 5% is smaller than the 0.5ms floor and a legitimate speedup could never be accepted. The loop stops early when the best score reaches `targetScore` (default 0.98), unless performance mode is enabled; performance mode uses the remaining iterations to seek faster equal-score implementations and takes at least five benchmark runs per evaluation.

After a rejected interleaved comparison, the next proposal prompt adds a `Latest interleaved check` block with the freshly measured reference median, the last candidate's median, the performance score of that measurement, and the exact acceptance rule. The accepted median can be seconds or minutes old; this block makes the proposer aim at what the current best measures on this machine now. The archive and report still record the accepted measurement, which remains the score basis.

In performance mode the two sides are measured together: `evaluateTask` runs the candidate and the current best alternately, starting with a different side each round and rounding an odd run count up to an even number of rounds. Per-round pairs are stored in `benchmarkComparison.pairs`, and the medians, paired ratio, paired delta, win count, and run counts are written to `iterations.jsonl` and the CLI JSON (`referenceBenchMs`, `referenceRuns`, `pairedRatio`, `pairedDeltaMs`, `pairedWins`, `pairedRounds`). The loop recomputes `previousBest.score` from that comparison before deciding, so CPU-frequency drift and JIT warm-up cannot systematically favour either solution. A benchmark-driven acceptance (performance-only, or a score gain that comes entirely from the benchmark component) is then re-measured with `compareBenchmarks`; the confirmation does not re-run the public or hidden tests. Both comparisons must pass, and the accepted iteration records the confirmation measurement. A score gain that also raises hidden correctness or static quality is not benchmark-driven and does not need a confirmation.

### Benchmark calibration

`doctor --calibrate` measures the reference solution against itself. Each trial runs one interleaved comparison with the performance-mode run count (at least six rounds per side). If that comparison would pass the performance gate, the command runs a second, independent comparison exactly as `runTask` does; a task is `noisy` only when both stages pass, because only then would identical code replace the best.

The report shows, per task, the number of first-stage and confirmed false acceptances, the median paired ratio, and the mean round-win rate. A healthy workload centers on ratio 1.0 and a 50% win rate. The command exits 1 if any task would accept identical code, so it can gate benchmark changes in CI. Trials are independent but limited: zero confirmed false acceptances in five trials is evidence, not proof.

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

The real model run used during development accepted two consecutive shortening rounds on `interval-merge` and `lru-cache` while both tasks stayed at score 1.0 (1784 → 1428 → 1213 characters). A later verification run archived a one-round result at 1784 → 1443 characters (about 19% shorter). This is a genuine scaffold-level improvement that does not require a score gain: the same behavior with a smaller prompt.

The archived 1443-character template predates the `{{BENCHMARK_RESULT}}` placeholder. Do not apply it to the current proposer prompt: `validateMetaPrompt` now requires that placeholder, and removing benchmark feedback would undo the performance-optimization channel. Re-run `meta` before applying a shortened template.

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
task                          baseline   best   delta   hidden  baseMs  bestMs  targetMs
algorithms/aho-corasick       0.8000    1.0000  0.2000   3/3      2541    22      50
algorithms/dijkstra           0.8000    1.0000  0.2000   2/2      -       74      200
algorithms/edit-distance      0.8000    1.0000  0.2000   2/2      -       25      80
algorithms/interval-merge     0.6500    1.0000  0.3500   4/4      6       49      120
algorithms/lfu-cache          0.8000    1.0000  0.2000   3/3      -       57      100
algorithms/lru-cache          0.8773    1.0000  0.1227   3/3      794     105     150
algorithms/max-flow           0.8000    1.0000  0.2000   4/4      2908    67      200
algorithms/median-stream      0.8000    1.0000  0.2000   2/2      -       28      100
algorithms/regex-match        0.8000    1.0000  0.2000   3/3      -       95      120
algorithms/sliding-window-max 0.8000    1.0000  0.2000   3/3      639     17      60
algorithms/top-k-frequent     0.8000    1.0000  0.2000   2/2      -       31      120
algorithms/union-find         0.8000    1.0000  0.2000   3/3      -       40      150
```

The optimization baselines are correct but miss the performance budget, so their score is `0.7 * 1 + 0.2 * 0 + 0.1 * 1 = 0.8`. The interval-merge baseline additionally fails two hidden correctness tests. A missing baseline time means the weak baseline produced no successful benchmark run; top-k-frequent and union-find now time out by design because their enlarged workloads make the O(n·distinct) and O(n²) baselines hopeless. Benchmark times vary by machine; the demo asserts hidden-test success, not a fixed score. The lru-cache baseline score depends on its measured baseline time and therefore varies between runs.

## Measured model run: before vs after performance mode

This run used `deepseek-v4-flash` through the Claude Code CLI (`--proposer command`) on one Windows machine, over all twelve tasks. Both suites started from the same 73-lesson snapshot. **Before** used the 1786-character proposer prompt (no benchmark-feedback section) and the score-only gate; each task stopped as soon as its score reached the target. **After** used the 2246-character prompt with the `BENCHMARK_RESULT` section and `--optimize-performance --iterations 3`; the loop kept iterating after the target and could accept equal-score speedups.

The after in-loop decisions used 3-run medians (the code at the time); the before suite used each task's configured 2-3 runs. The table re-measures the archived before/after/reference files with 10 rounds of **interleaved** runs per solution (`npm run rsi:measure`), rotating the solution order every round to cancel CPU-frequency drift. This is the reproducible comparison; the in-loop numbers were noisier.

| Task | Target | Before | After | Change | Reference |
| --- | ---: | ---: | ---: | ---: | ---: |
| `algorithms/aho-corasick` | 50 | 10.98 | 5.91 | -46.2% | 15.80 |
| `algorithms/dijkstra` | 200 | 11.41 | 11.45 | +0.4% | 64.58 |
| `algorithms/edit-distance` | 80 | 17.78 | 3.29 | -81.5% | 22.50 |
| `algorithms/interval-merge` | 120 | 67.36 | 9.21 | -86.3% | 50.91 |
| `algorithms/lfu-cache` | 100 | 55.81 | 25.66 | -54.0% | 56.02 |
| `algorithms/lru-cache` | 150 | 94.82 | 21.46 | -77.4% | 92.28 |
| `algorithms/max-flow` | 200 | 14.11 | 11.00 | -22.0% | 66.97 |
| `algorithms/median-stream` | 100 | 24.63 | 10.66 | -56.7% | 26.54 |
| `algorithms/regex-match` | 120 | 18.33 | 10.62 | -42.1% | 88.96 |
| `algorithms/sliding-window-max` | 60 | 13.43 | 9.33 | -30.6% | 16.98 |
| `algorithms/top-k-frequent` | 120 | 6.18 | 4.88 | -21.1% | 6.46 |
| `algorithms/union-find` | 150 | 3.95 | 3.60 | -8.6% | 4.12 |

Times are milliseconds; lower is better. The median reduction is **44.1%** and the geometric-mean reduction is **52.3%**. Eleven tasks are at least 5% faster; dijkstra is flat within noise. Every after time meets its target (the tightest is lfu-cache at 25.66ms against 100ms). The after solution is also faster than the hand-written reference on every task.

The performance gate fired inside the loop, not only in the final re-measurement. In-loop examples (3-run medians, so treat single values as approximate):

- edit-distance: 17ms → 5ms → 4ms, two performance-only acceptances.
- lru-cache: 96ms → 28ms; lfu-cache: 82ms → 25ms.
- interval-merge: 59ms → 12ms; max-flow: 24ms → 20ms.
- sliding-window-max: 12ms → 10ms; dijkstra: 14ms → 12ms on its third iteration (its 25ms second-iteration candidate was rejected).
- aho-corasick accepted at 6ms on the first iteration; its two follow-ups (9ms, 6ms) were rejected for missing the 5% threshold.
- median-stream rejected a candidate that dropped hidden tests to 1/2, and top-k-frequent rejected a malformed proposal.

Caveats:

- Single machine, single model, one suite per side. Absolute times vary between sessions by several percent; the interleaved 10-round medians are the best estimate here, not a portable benchmark.
- The before suite stopped at score 1.0 after one iteration by design. The comparison measures the whole scaffold change (benchmark feedback, continued iteration, and the performance gate), not the gate in isolation.
- The after suite ran in two segments because a 2-hour background budget covered seven tasks. The remaining five continued with the same archive and lesson store; no task was re-run or cherry-picked.
- Two iteration-3 proposer calls timed out at 600s (interval-merge and max-flow) and were recorded as rejected iterations; the earlier accepted solutions stayed best.
- The 3-run in-loop medians were sometimes misleading: dijkstra's before best read 25ms in the suite but 11.41ms under interleaved measurement, so its apparent 2× gain was mostly noise. This is why performance mode now takes at least five benchmark runs, requires an absolute win, re-measures candidate and best in alternating rounds, and confirms every performance-only acceptance with a second comparison. On this machine, identical code compared in six paired rounds still produced a 5%-plus median win in 1 of 20 trials; the 5/6 win requirement and the confirmation stage exist to reject exactly that artifact.
- `regex-match` was recalibrated after the run because its old workload measured 0ms. The table uses the new 20,000-character workload (target 120ms). The suite's in-loop regex iteration saw the old workload and accepted a sub-millisecond "win"; the new `--min-speedup-ms` floor would reject it.
- The `top-k-frequent` and `union-find` rows were measured on the pre-calibration workloads (50k numbers ×2 and 100k elements), so their absolute times are not comparable to the current bench. The after archives re-measure at 22.3ms and 32.2ms on the current 250k ×3 and 3M-element workloads. Those sizes were chosen so a 5% win (1.1ms and 1.6ms) clears the 0.5ms floor; at the old scale it could not, which made further performance acceptance impossible on those tasks.

## Repository layout

```text
rsi/
  bin/rsi.mjs             CLI
  src/task.mjs            task loading and validation
  src/workspace.mjs       sandbox creation, proposal validation, apply
  src/evaluator.mjs       commands, TAP parsing, static check, benchmark, scoring
  src/calibrate.mjs       identical-code trials for the performance gate
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
  examples/measure-best.mjs  interleaved before/after/reference benchmark measurement
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
- Archive calibration reports alongside benchmark-suite changes so workload edits remain auditable.
- Multi-proposer ensembles and cross-model review.
- Contamination checks that reject suspiciously specific solutions.
- A human review UI that shows the diff, test deltas, and benchmark deltas before `--apply`.
