# Iris agent guide

## Purpose and scope

Iris is a local orthodontic record-writing assistant embedded in the E看牙 web application. It helps a clinician turn review notes or a structured first-visit form into editable medical-record fields, then fills those fields into the open E看牙 edit page. The clinician must review and manually save every record.

Repository scope is this `Iris` directory only. `../EKanYa AutoLogin` is a local runtime dependency, not source to publish with Iris: its Chrome profile may contain E看牙 cookies, saved credentials, site storage, and patient-related browser data.

## Read before changing code

1. `docs/PROJECT.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DECISIONS.md`
4. `docs/HANDOFF.md`
5. The exact functions involved in the requested change.

For E看牙 interaction changes, also read the relevant part of `chrome-extension/content.js` and the local login handoff at `../EKanYa AutoLogin/HANDOFF-EKanYa.md` without editing its profile or credentials.

## Engineering rules

- Preserve the clinical boundary: Iris organizes clinician-provided text; it does not diagnose, prescribe, or automatically save.
- Prefer a small, directly testable rule change over a refactor. This project intentionally contains many explicit clinical parsing rules.
- Do not move API keys, cookies, credentials, patient data, or Chrome profile data into source code, extension storage, logs, documentation, or Git.
- Do not add automatic E看牙 save behavior. The extension UI must keep saving as a clinician-only action.
- Do not change `chrome-extension/manifest.json` permissions or host permissions without documenting the reason in `docs/DECISIONS.md`.
- Treat E看牙 DOM selectors and history-panel traversal as high risk: they depend on an external webpage and must be verified in a real logged-in edit page.
- Keep AI fallback behavior intact unless the task explicitly changes it: local deterministic rules remain available if AI is absent or fails.
- Do not edit generated/runtime directories: `logs/`, `__pycache__/`, or any Chrome profile.

## Key files

- `iris_server.py`: local HTTP service, deterministic follow-up rules, AI calls, OCR, and legacy CDP helper endpoints.
- `chrome-extension/content.js`: Iris UI, structured initial-visit template, E看牙 DOM read/fill logic, and history-copy logic.
- `chrome-extension/background.js`: extension-to-local-service bridge.
- `chrome-extension/panel.css`: all embedded panel styling.
- `terms.json`: editable spoken-to-written normalization terms; review changes as clinical-content changes.
- `Start-Iris.ps1`: starts the local service and optionally invokes E看牙 login.

## Validate each change

Run from `D:\DailyRootine\Iris`:

```powershell
node --check chrome-extension\content.js
node --check chrome-extension\background.js
python -m py_compile iris_server.py
```

For parser changes, add a focused local invocation or test case using representative, non-patient text. For E看牙 UI changes, refresh the E看牙 page after reloading the unpacked extension and manually verify that fill works but save is still manual.

Restart the service after server changes using `Start-Iris.ps1`; do not terminate unrelated Chrome processes.

## Documentation and handoff

When a task changes behavior, update:

- `docs/CHANGELOG.md` with date, agent, reason, files, tests, and any residual issue.
- `docs/DECISIONS.md` if a durable design decision or compatibility constraint changes.
- `docs/TODO.md` if a known issue is added, resolved, or reprioritized.
- `docs/HANDOFF.md` with the current state and next verification step.

Keep unknown history marked as “无法从当前项目确认”; do not infer it.

## Git workflow

- Check `git status --short --branch` before work.
- Keep commits focused: documentation/setup, UI, local rules, OCR, and E看牙 interaction changes should normally be separate commits.
- Never commit `.env`, logs, local E看牙 configuration, screenshots, Chrome profile data, or runtime caches.
- Before a commit, review `git diff --check` and `git diff --cached`.
- Do not create a public remote or push without explicit user approval. This project should be private if it is hosted.
