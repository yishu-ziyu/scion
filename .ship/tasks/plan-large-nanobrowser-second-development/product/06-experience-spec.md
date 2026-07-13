# Experience specification

## Key Screens

### Task console in the existing side panel

- current goal and task status;
- latest meaningful action and active site/tab;
- compact progress log;
- pending approval or user-action card;
- follow-up input that stays enabled when the task can accept control.

### Completion receipt

- outcome summary;
- completion criteria with observed evidence;
- consequential actions performed;
- affected URL/tab and timestamp;
- `Save as Skill` action.

### Local Skills

- saved Skill list using the existing favorites/prompt surface where practical;
- Skill name, instruction template, inputs, completion criteria, and approval policy;
- run, edit, and delete.

## Core States

- Idle: no active task.
- Running: actions are executing.
- Waiting for approval: proposed external commit is visible; approve/reject are the only advancing actions.
- Waiting for user: login, CAPTCHA, unavailable information, or unsupported proof requires help.
- Interrupted: extension worker/UI lifecycle ended; task may be explicitly resumed from stored context.
- Completed: all supported criteria passed and a receipt exists.
- Failed: retry budget exhausted or a blocking error remains.
- Cancelled: user stopped the task.

## Empty, Loading, Error States

- Empty: show one goal example and saved Skills; do not show a feature tour.
- Loading: show the current intent (“正在定位飞书表单”) rather than a generic spinner.
- Recoverable error: explain what failed and offer retry/continue.
- Login/CAPTCHA: stop and ask the user to complete it in the page, then continue the same task.
- Lost target tab: explain which target was lost and offer to rebind to the active tab.
- Unsupported completion proof: show observed state and ask the user to confirm; do not claim success.

## Golden Journeys

### Journey A — form completion

1. User asks the Agent to open a form and provides field values.
2. Agent navigates and fills fields using the current login.
3. Submit is classified as a consequential external commit.
4. User reviews the proposed submit and approves.
5. Agent submits and verifies a success indicator/URL/state.
6. Receipt shows what was submitted and the evidence.
7. User saves the task as a Skill with variable field inputs.

### Journey B — continuous media control

1. User asks the Agent to open a Bilibili favorite and play a video.
2. Agent navigates, selects the video, starts playback, and records the target media/tab.
3. User says “暂停这个视频”.
4. Follow-up resolves `这个视频` to the same task target.
5. Agent pauses the active HTML media and verifies `paused=true`.

### Journey C — Skill rerun

1. User selects a saved form Skill.
2. Side panel asks only for declared inputs.
3. A new task session runs the semantic instruction and current completion criteria.
4. It may adapt to changed element positions because it does not replay old indexes.
