# DevGenie — Self-Recorded Demo Script (≤3:00)

You talk over a live screen recording. Every input below is **verified working
against the live deployment** (the Score-MR examples return HIGH 63/100 with
real citations — tested 2026-06-11).

## Before you hit record

- [ ] Sign in at https://devgenie-app-70965519212.us-central1.run.app (fresh session, so no expired-token banner)
- [ ] Repo selector = **gitlab-org/gitlab** (richest memory)
- [ ] Browser zoom 110–125%, close other tabs, hide bookmarks bar
- [ ] Keep this file open on a second screen — chat questions and Score-MR text must be pasted **exactly** (paraphrasing changes the semantic match)
- [ ] Optional pre-opened tab: the real MR https://gitlab.com/gitlab-org/gitlab/-/merge_requests/235315 (saves a load during the money-shot)
- [ ] Run Beat 2's question once off-camera first (warms the backend; the on-camera run streams faster)

---

## BEAT 1 — Hook + Dashboard (0:00–0:25)

**DO:** Start on the dashboard. Slowly move the cursor across the stat cards
(1,500 commits · 697 MRs · 63 reverts), then over "Top risky areas".

**SAY:**
> "Engineers spend more than half their time understanding code that already
> exists — and the hardest question is never *what* the code does, it's *why*.
> This is DevGenie. Sign in with GitLab, point it at any repo you can read —
> here, GitLab's own repository — and it builds a memory of your project's
> entire history: every commit, merge request, and crucially, all sixty-three
> times this team tried something and had to revert it."

## BEAT 2 — Has this been tried before? (0:25–1:05) ← the heart of the demo

**DO:** Click **Open chat**. Type and send EXACTLY (verified — returns a crisp
story with the !235315 link every run):
```
Has a central identity verification gate for the Duo Agent Platform ever been tried in this repo? What happened to it?
```
While the answer streams, hover the citation link. Then **click the !235315
link** and let the real GitLab MR open.

**SAY (while it streams):**
> "Ask the question every engineer asks before starting work: has this been
> tried before? DevGenie walks the actual history: there was a spike — built
> to stop large-scale abuse of trial credits that was costing real money — a
> feature-flagged identity gate. It was investigated, and abandoned. That MR
> is still sitting open. And the claim carries a clickable citation…"

**(click the link, pause a beat on the GitLab page)**
> "…that's the real merge request, on GitLab. No hallucinations. Receipts."

*(Two more verified alternatives if you prefer a broader opener:*
1. `Which parts of this codebase are the riskiest to touch, based on revert and bug history? Cite with links.`
   *— multi-section Attempt → Revert → Reason chains with links.*
2. `What changes have been tried and reverted in this repo? Tell the story of 2-3 of them with links — what was attempted and why was it undone?`
   *— returns full revert stories (e.g. the SCIP code-intelligence rollback,
   staged across milestones to avoid database downtime) with linked MRs.)*

## BEAT 3 — It reads real code (1:05–1:30)

**DO:** Back to chat. Type and send:
```
Explain commit 2391b107 in detail — what exactly did it change in the code?
```

**SAY:**
> "It reads real code too. Give it any commit and it pulls the actual diff and
> explains the change line by line — the new GraphQL field, the feature flag
> guarding it, even the specs that were added. This is what onboarding onto a
> ten-year-old codebase should feel like."

## BEAT 4 — Risk Radar: the money shot (1:30–2:10)

**DO:** Click **Score MR**. Paste EXACTLY (verified → HIGH 63/100, and it
cites **!235315 — the very MR from Beat 2**, closing the loop on camera):

- **Title:**
```
Add a central identity verification gate for Duo Agent Platform
```
- **Description:**
```
Introduces a centralized DAP identity verification gate that all agent platform requests must pass through before execution.
```
- **Files:**
```
ee/lib/gitlab/duo/identity_gate.rb
```
Submit. The red **HIGH (63/100)** badge appears: *"Closely matches a
previously REVERTED approach: Spike: central DAP identity verification gate"*
— linking back to !235315.

**SAY:**
> "Now the part that saves teams real money. Imagine a new engineer — who
> wasn't here for any of that history — proposes the same idea next quarter.
> They paste their merge request into Risk Radar… and DevGenie flags it: HIGH
> risk — this closely matches the exact approach we just read about, the one
> this team already walked away from — with the link to prove it. Not a black
> box: an explainable score, computed from your own history. And through
> GitLab webhooks, this exact check runs automatically on every new MR and
> posts the warning as a comment — before the mistake is merged, not after."

*(Verified backup input: title "Track last used IP addresses on project and
group access tokens", description "Adds a last_used_ips column to
project_access_tokens and group_access_tokens so admins can audit where
tokens are being used from.", file "app/models/project_access_token.rb"
— also HIGH 63/100, citing !236381.)*

## BEAT 5 — Graph + Settings flash (2:10–2:30)

**DO:** Click **Knowledge graph**, drag a node, hover a red edge (2–3s). Then
**Settings** — point at the PAT card (2–3s). Don't linger.

**SAY:**
> "Under it all is a knowledge graph — decisions connected to the reverts that
> killed them, in red. And it's built like a real product: GitLab OAuth means
> you can only ever query repos you can already read, and teams can add a
> scoped access token for long-running use."

## BEAT 6 — Tools used (2:30–2:45)

**DO:** Stay on screen or cut to the architecture diagram in the README.

**SAY:**
> "DevGenie runs entirely on Google Cloud: Gemini 2.5 Pro orchestrated by the
> Agent Development Kit, with nine grounded tools; Vertex AI Vector Search for
> semantic recall; Firestore for the reversion graph; everything serving from
> Cloud Run. And the GitLab integration is deep: OAuth, webhooks, the REST
> API — and the official GitLab MCP server, which fetches the live diff in
> every automatic MR review."

## BEAT 7 — Future work + close (2:45–3:00)

**DO:** Return to the dashboard. End cursor resting on the DevGenie logo.

**SAY:**
> "Next: org-wide memory — 'has *any* team here tried this?' — proactive
> weekly risk reports, and IDE hints on risky lines as you type. Your
> repository already wrote the documentation. DevGenie makes it answer back."

---

## Timing cheat-sheet

| Beat | Content | Ends at |
|---|---|---|
| 1 | Hook + dashboard | 0:25 |
| 2 | Decision story + citation click | 1:05 |
| 3 | Commit diff explanation | 1:30 |
| 4 | Risk Radar HIGH score | 2:10 |
| 5 | Graph + settings | 2:30 |
| 6 | Tools used | 2:45 |
| 7 | Future + tagline | 3:00 |

## Recording tips

- Record the screen and your voice **separately if possible** (QuickTime screen
  recording + Voice Memos) — lets you fix narration without re-clicking.
- Agent answers take 10–25s to stream. Either talk over the wait (script above
  is written for that) or pause recording and trim the dead air later.
- Do Beat 2's question once **off-camera first** — the backend session warms up
  and the on-camera run streams faster.
- If a response is slow or weak, just re-run it — temperature is 0, retries are
  cheap.
- Upload as YouTube **Unlisted**, paste the link into SUBMISSION.md and Devpost.
