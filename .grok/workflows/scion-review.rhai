// /scion-review — truth verifier for scion / 持节 (read-only).
// Verdict: PASS or FAIL + P0/P1/P2 with file + reason.
// Never modify the worktree.

let meta = #{
    name: "scion-review",
    description: "Read-only scion review: product truth, architecture, verification, regression, repo consistency, and runtime truth (docs vs default flags)",
    when_to_use: "After important scion changes. /scion-review or /workflow scion-review",
    phases: [
        #{ title: "Scope", detail: "resolve git range and changed paths" },
        #{ title: "Review", detail: "six faces in parallel including runtime_truth" },
        #{ title: "Verdict", detail: "PASS or FAIL with P0/P1/P2" },
    ],
};

let face_schema = #{
    "type": "object",
    "required": ["face", "ok", "findings"],
    "properties": #{
        "face": #{ "type": "string" },
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["severity", "file", "reason"],
                "properties": #{
                    "severity": #{ "type": "string", "enum": ["P0", "P1", "P2"] },
                    "file": #{ "type": "string" },
                    "reason": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["verdict", "p0", "p1", "p2", "markdown"],
    "properties": #{
        "verdict": #{ "type": "string", "enum": ["PASS", "FAIL"] },
        "p0": #{
            "type": "array",
            "items": #{
                "type": "object",
                "required": ["file", "reason"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "reason": #{ "type": "string" },
                },
            },
        },
        "p1": #{
            "type": "array",
            "items": #{
                "type": "object",
                "required": ["file", "reason"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "reason": #{ "type": "string" },
                },
            },
        },
        "p2": #{
            "type": "array",
            "items": #{
                "type": "object",
                "required": ["file", "reason"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "reason": #{ "type": "string" },
                },
            },
        },
        "markdown": #{ "type": "string" },
    },
};

// args: { base, range, paths } — base is real for git when range empty and base != HEAD

let base = "HEAD";
let range = "";
let paths = "";
if args != () {
    if type_of(args) == "string" {
        range = args;
    } else {
        if args.base != () { base = args.base + ""; }
        if args.range != () { range = args.range + ""; }
        if args.paths != () { paths = args.paths + ""; }
        if args.query != () && range == "" { range = args.query + ""; }
        if args.objective != () && range == "" { range = args.objective + ""; }
    }
}

phase("Scope");
let scope_prompt = "";
scope_prompt += "You are scoping a scion repo review. READ-ONLY. Never edit files or commit. ";
scope_prompt += "Repo root = current workspace (scion). ";
scope_prompt += "Run: git status --short; git rev-parse --show-toplevel; git rev-parse HEAD; ";
if range != "" {
    scope_prompt += "USE THIS EXACT RANGE for diffs (not a hint): git diff --stat " + range + "; git diff --name-only " + range + "; ";
} else if base != "" && base != "HEAD" {
    scope_prompt += "USE THIS EXACT BASE (three-dot merge-base diff vs HEAD): ";
    scope_prompt += "git diff --stat " + base + "...HEAD; git diff --name-only " + base + "...HEAD; ";
    scope_prompt += "If three-dot fails, fall back to two-dot: git diff --stat " + base + "..HEAD; ";
} else {
    scope_prompt += "git diff --stat; git diff --cached --stat; git diff --name-only; git diff --cached --name-only; ";
    scope_prompt += "If working tree clean, git show --stat --name-only HEAD. ";
}
if paths != "" {
    scope_prompt += "Focus paths filter: " + paths + ". ";
}
scope_prompt += "Return plain-text: changed files, docs vs code, one product risk line. Do not invent files.";

let scope = agent(scope_prompt, #{
    label: "scope",
    capability_mode: "read-only",
});

let scope_text = "";
if scope != () && scope.success && scope.output != () {
    scope_text = scope.output + "";
} else {
    scope_text = "Scope agent failed; reviewers must discover state via git and reads.";
}
log("scope ready");

phase("Review");

let common = "";
common += "READ-ONLY scion / 持节 review. Never modify worktree. ";
common += "Use read_file, grep, and read-only git only. ";
common += "Product truth chain: 021 north star → decision 004 autonomy → 020 eval → 019 roadmap → run_state. ";
common += "Historical 003/011/016-018 never override. ";
common += "Scope:\n" + scope_text + "\n";
common += "Return JSON face, ok, summary, findings[{severity:P0|P1|P2,file,reason}]. ";
common += "Empty findings only after real inspection. Concrete file paths required.\n";

let p_product = common;
p_product += "FACE=product_truth. Violations of 021 or decision 004 = P0/P1. ";
p_product += "P0 if default step-approval restored as product policy or Claw 30 re-promoted as north star.";

let p_arch = common;
p_arch += "FACE=architecture. Second Task/Agent loop or broken single control path = P0. Inspect diff code only if code changed.";

let p_verify = common;
p_verify += "FACE=verification. Model done as complete, or weakened false_complete/wrong-tab evidence = P0.";

let p_reg = common;
p_reg += "FACE=regression. Name minimum checks for this diff. Docs/i18n-only must not demand full E2E. ";
p_reg += "P1 if high-risk code has no tests and no reason.";

let p_repo = common;
p_repo += "FACE=repo_consistency. AGENTS/README/CONTEXT/docs/run_state/chijie AGENTS-README must not re-conflict. ";
p_repo += "P0 if deferred_plan_only while candidates exist; P0 if submit-before-approve as current policy.";

// Mandatory runtime_truth — does NOT depend on diff alone
let p_runtime = "";
p_runtime += "FACE=runtime_truth. MANDATORY truth verifier. Do NOT only look at the git diff. ";
p_runtime += "You MUST actively open and read (or grep) at least: ";
p_runtime += "(1) docs/product/021-long-horizon-task-agent.md; ";
p_runtime += "(2) docs/product/022-adaptive-browser-harness-v1.md if present (status + §0 implementation tables); ";
p_runtime += "(3) docs/DOCS_INDEX.md and docs/README.md 022 lines; ";
p_runtime += "(4) .ship/tasks/plan-large-nanobrowser-second-development/control/run_state.yaml; ";
p_runtime += "(5) projects/chijie-browser/packages/storage/lib/settings/evalSettings.ts DEFAULT_EVAL_SETTINGS; ";
p_runtime += "(6) projects/chijie-browser/chrome-extension/src/background/agent/backends/control-llm.ts flag usage for Kernel/Diff/Skill; ";
p_runtime += "(7) projects/chijie-browser/chrome-extension/src/background/task/manager.ts artifact verify path; ";
p_runtime += "(8) projects/chijie-browser/packages/i18n/locales/zh_CN/messages.json and en/messages.json app_metadata_*; ";
p_runtime += "(9) docs/product/019-ai-agent-book-build-plan.md Current gaps vs historical baseline sections; ";
p_runtime += "(10) git log --oneline -15 for major feat commits (e.g. 022 harness). ";
p_runtime += "CHECK and emit P1 (or P0 if user-facing lie) when: ";
p_runtime += "A) product doc says proposed/not default route but DEFAULT flags enable the capability on production control path; ";
p_runtime += "B) product doc says not implemented but main code path exists and is default_enabled; ";
p_runtime += "C) product doc says landed/default but only dead code or flag always false with no path; ";
p_runtime += "D) current roadmap Current gaps still lists already-done Wave1/2 items as missing; ";
p_runtime += "E) user-visible app_metadata claims browser action agent / step approval / 关键处审批. ";
p_runtime += "Also record if product_status proposed + implementation default_enabled is EXPLICITLY dual-tracked (ok) vs silently contradicted (P1). ";
p_runtime += "Known positive test case: if 022 is proposed AND enableBrowserKernelV1/enableSkillRuntime true, docs must dual-state it; else P1. ";
p_runtime += "Scope note (secondary):\n" + scope_text + "\n";
p_runtime += "Return JSON face=runtime_truth, ok, summary, findings.";

let jobs = [
    #{ prompt: p_product, label: "face:product_truth", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_arch, label: "face:architecture", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_verify, label: "face:verification", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_reg, label: "face:regression", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_repo, label: "face:repo_consistency", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_runtime, label: "face:runtime_truth", capability_mode: "read-only", output_schema: face_schema },
];

let results = parallel(jobs);

let faces_blob = "";
let i = 0;
for r in results {
    if r == () || !r.success || r.output == () {
        faces_blob += "FACE_SLOT_" + i.to_string() + " FAILED OR EMPTY — treat as unverified, not pass.\n";
    } else {
        faces_blob += json_encode(r.output) + "\n";
    }
    i += 1;
}
log("six faces collected");

phase("Verdict");
let vp = "";
vp += "Final scion-review synthesizer. READ-ONLY. ";
vp += "Inputs:\n" + faces_blob + "\n";
vp += "Rules: verdict ONLY PASS or FAIL. Any confirmed P0 => FAIL. ";
vp += "Material P1 on product_truth/runtime_truth/architecture/verification => FAIL. ";
vp += "Docs-only P2 alone may PASS. Failed face slots => P1 review gap. Deduplicate. ";
vp += "markdown starts with PASS or FAIL line, then P0/P1/P2 bullets `- file: reason` (or none). ";
vp += "Return verdict, p0, p1, p2, markdown.";

let final = agent(vp, #{
    label: "verdict",
    capability_mode: "read-only",
    output_schema: verdict_schema,
});

if final == () || !final.success || final.output == () {
    let fail_md = "FAIL\n\n## P0\n- scion-review: synthesizer failed\n\n## P1\nnone\n\n## P2\nnone\n";
    let report_path = write_scratch_file("scion-review-report.md", fail_md);
    complete(#{
        verdict: "FAIL",
        path: report_path,
        report: fail_md,
        p0: [#{ file: "scion-review", reason: "synthesizer failed" }],
        p1: [],
        p2: [],
    });
}

let out = final.output;
let md = out.markdown + "";
if md == "" {
    md = out.verdict + "\n\n(empty markdown)\n";
}
let report_path = write_scratch_file("scion-review-report.md", md);
complete(#{
    verdict: out.verdict,
    path: report_path,
    report: md,
    p0: out.p0,
    p1: out.p1,
    p2: out.p2,
});
