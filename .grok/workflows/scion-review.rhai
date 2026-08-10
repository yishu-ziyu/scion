// /scion-review — independent read-only review after important scion changes.
// Verdict is only PASS or FAIL, plus P0/P1/P2 with file + reason.
// Default: read-only. Do not modify the worktree via shell, scripts, or agents.

let meta = #{
    name: "scion-review",
    description: "Read-only review of scion worktree/diff against product truth, architecture, verification, regression, and repo consistency",
    when_to_use: "After important product/code/docs changes in scion. Invoke as /scion-review or /workflow scion-review",
    phases: [
        #{ title: "Scope", detail: "resolve diff and changed paths" },
        #{ title: "Review", detail: "five independent check faces in parallel" },
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

// --- args ---
// Optional: { base: "origin/main" } or { range: "HEAD~3..HEAD" } or { paths: "docs AGENTS.md" }
// Default: review unstaged+staged worktree vs HEAD, else last commit if clean.

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
scope_prompt += "You are scoping a scion repo review. READ-ONLY only. ";
scope_prompt += "Never edit files, never run write/destructive shell, never stage/commit/push. ";
scope_prompt += "Repo root is the current workspace (scion). ";
scope_prompt += "Run: git status --short; git rev-parse --show-toplevel; ";
if range != "" {
    scope_prompt += "git diff --stat " + range + "; git diff " + range + " --name-only; ";
} else {
    scope_prompt += "git diff --stat; git diff --cached --stat; git diff --name-only; git diff --cached --name-only; ";
    scope_prompt += "If working tree is clean, use git show --stat --name-only HEAD instead. ";
    scope_prompt += "Base hint: " + base + ". ";
}
if paths != "" {
    scope_prompt += "Focus paths filter: " + paths + ". ";
}
scope_prompt += "Return a short plain-text scope report with: changed files list, whether docs and/or code changed, ";
scope_prompt += "and a one-line product risk guess. Do not invent files.";

let scope = agent(scope_prompt, #{
    label: "scope",
    capability_mode: "read-only",
});

let scope_text = "";
if scope != () && scope.success && scope.output != () {
    scope_text = scope.output + "";
} else {
    scope_text = "Scope agent failed; reviewers must discover diff themselves via git status/diff.";
}
log("scope ready");

phase("Review");

let common = "";
common += "READ-ONLY review for scion / 持节. Never modify the worktree. ";
common += "Never run shell that writes, formats, installs, commits, or pushes. ";
common += "Use read_file, grep, and read-only git (status/diff/show/log) only. ";
common += "Product truth chain (later rows lose): ";
common += "1) docs/product/021-long-horizon-task-agent.md north star; ";
common += "2) docs/decisions/004-task-scoped-autonomy.md task-scoped autonomy; ";
common += "3) docs/product/020-eval-master.md eval contract; ";
common += "4) docs/product/019-ai-agent-book-build-plan.md roadmap; ";
common += "5) .ship/.../run_state.yaml live status only. ";
common += "Historical docs (003/011/016/017/018 etc.) never override. ";
common += "Scope report:\n" + scope_text + "\n";
common += "Return JSON with face, ok, summary, findings[{severity:P0|P1|P2,file,reason}]. ";
common += "Empty findings only if you actually inspected the diff/files. ";
common += "Each finding needs a concrete file path and a falsifiable reason.\n";

let p_product = common;
p_product += "FACE=product_truth. Check whether changes violate 021 or decision 004. ";
p_product += "Fail (P0) if they reintroduce default step-approval as product policy, ";
p_product += "re-promote Claw 30 / 018 / 011 / 003 as current north star, ";
p_product += "or rewrite entry docs (README/AGENTS/CONTEXT) against long-horizon Chrome Agent. ";
p_product += "Read AGENTS.md and any touched product docs in the diff.";

let p_arch = common;
p_arch += "FACE=architecture. Check for a second Task/Agent loop, second storage/control path, ";
p_arch += "or broken single main pipeline under projects/chijie-browser. ";
p_arch += "P0 if a parallel executor/task manager path is introduced without design decision. ";
p_arch += "Prefer control core + existing task shell. Inspect code paths in the diff only.";

let p_verify = common;
p_verify += "FACE=verification. Fail if model says done becomes completion, ";
p_verify += "or page evidence / false_complete / wrong-tab protections are weakened. ";
p_verify += "P0 for removing evidence gates or treating done text as verified_pass. ";
p_verify += "Inspect completion/control-policy/e2e/tests touched in the diff.";

let p_reg = common;
p_reg += "FACE=regression. From the actual diff, recommend the MINIMUM necessary checks ";
p_reg += "(type-check / unit / build / targeted eval). Do NOT demand full browser E2E for docs-only. ";
p_reg += "P1 if high-risk code landed with no tests and no stated reason. ";
p_reg += "P2 for missing cheap checks that should have been run. ";
p_reg += "Do not run expensive eval yourself unless already cheap and clearly necessary; prefer stating the command.";

let p_repo = common;
p_repo += "FACE=repo_consistency. Check AGENTS.md, README.md, CONTEXT.md, docs/README.md, ";
p_repo += "docs/DOCS_INDEX.md, run_state.yaml, projects/chijie-browser/README.md, projects/chijie-browser/AGENTS.md ";
p_repo += "for new conflicts with the truth chain. ";
p_repo += "P0 if run_state says deferred_plan_only while outer-loop candidates exist and 021 says otherwise, ";
p_repo += "or if entry docs claim submit-before-approve as current policy. ";
p_repo += "P1 if outer_rl_status implies a live continuous runner (e.g. running_with_candidates) instead of fact candidates_generated when candidates exist but no live loop is claimed. ";
p_repo += "P1 for milestone/next_default mismatch across 019/020/021/run_state.";

let jobs = [
    #{ prompt: p_product, label: "face:product_truth", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_arch, label: "face:architecture", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_verify, label: "face:verification", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_reg, label: "face:regression", capability_mode: "read-only", output_schema: face_schema },
    #{ prompt: p_repo, label: "face:repo_consistency", capability_mode: "read-only", output_schema: face_schema },
];

let results = parallel(jobs);

let faces_blob = "";
let i = 0;
for r in results {
    if r == () || !r.success || r.output == () {
        faces_blob += "FACE_SLOT_" + i.to_string() + " FAILED OR EMPTY — treat as unverified, not as pass.\n";
    } else {
        faces_blob += json_encode(r.output) + "\n";
    }
    i += 1;
}
log("five faces collected");

phase("Verdict");
let vp = "";
vp += "You are the final scion-review synthesizer. READ-ONLY. Do not edit files. ";
vp += "You may re-read key files if needed to confirm severity, but do not expand scope. ";
vp += "Inputs (five face JSON or failures):\n" + faces_blob + "\n";
vp += "Rules:\n";
vp += "- Final verdict is ONLY PASS or FAIL.\n";
vp += "- Any confirmed P0 => FAIL.\n";
vp += "- Multiple material P1 on product truth/architecture/verification => FAIL.\n";
vp += "- Docs-only nit P2 alone may still PASS.\n";
vp += "- Failed face slots are not automatic P0; if evidence missing, emit P1 about review gap on that face.\n";
vp += "- Deduplicate findings. Every item needs concrete file + reason.\n";
vp += "- markdown must start with a single line that is exactly PASS or FAIL, then blank line, then sections P0 / P1 / P2 as bullet lists `- file: reason`. Empty section write `none`.\n";
vp += "Return verdict, p0, p1, p2 arrays, and markdown.";

let final = agent(vp, #{
    label: "verdict",
    capability_mode: "read-only",
    output_schema: verdict_schema,
});

if final == () || !final.success || final.output == () {
    let fail_md = "FAIL\n\n## P0\n- scion-review: synthesizer failed; no reliable verdict\n\n## P1\nnone\n\n## P2\nnone\n";
    let report_path = write_scratch_file("scion-review-report.md", fail_md);
    complete(#{
        verdict: "FAIL",
        path: report_path,
        report: fail_md,
        p0: [#{ file: "scion-review", reason: "synthesizer failed; no reliable verdict" }],
        p1: [],
        p2: [],
    });
}

let out = final.output;
let md = out.markdown + "";
if md == "" {
    md = out.verdict + "\n\n(empty markdown from synthesizer)\n";
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
