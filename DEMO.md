# GitLab Oracle — Demo & Submission Playbook

## The staged "money-shot" scenario

We ingest a bounded slice of **gitlab-org/gitlab** that is guaranteed (via the
`MR_SEARCH="Revert"` pass) to contain real reverted MRs with their discussion.
The live demo happens on **your fork** (`VedantMoghe16/gitlab`).

**Setup (once, before recording):**
1. After ingestion, find a juicy reverted MR in the memory:
   ```
   ./venv/bin/python -m tools.find_revert   # prints reverted MRs + their reasons
   ```
   Pick one with a clear rationale (e.g. "reverted — caused N+1 queries / race / regression").
2. On your fork, create a branch that **re-attempts that same approach** (mirror the
   original change the revert undid). Keep it small and legible on camera.
3. Open a merge request from that branch. The webhook fires → the Oracle comments
   within seconds, citing the original `!MR`, the revert, and any linked issue.

## 3-minute video script (≤180s — only the first 3 min are judged)

| Time | Beat | What's on screen |
|---|---|---|
| 0:00–0:25 | **The problem** | "AI tools see today's code but are blind to its past. Teams re-make mistakes they already paid for." One line, fast. |
| 0:25–1:15 | **Money-shot** | Open the re-attempt MR on the fork. Cut to the Oracle's auto-comment appearing: *"This approach was reverted in !X — caused Y. The team chose Z. See #W."* Let it land. |
| 1:15–1:55 | **Chat: why is it built this way?** | In the UI, ask about the payment/auth area. Show the grounded answer with clickable commit/MR/issue citations. |
| 1:55–2:25 | **Onboarding brief** | "I come from Django — what will surprise me here?" → list of decisions + rationale. |
| 2:25–2:55 | **Architecture** | 15-second diagram: Gemini + ADK on Agent Engine, GitLab MCP, Vertex Vector Search + Firestore, Cloud Run. Mention Phoenix tracing. |
| 2:55–3:00 | **Close** | "GitLab Oracle — your repo's memory, on demand." |

Tips: record the webhook comment live (most convincing); have the chat answers
pre-warmed (ask once before recording so the model/index are hot); keep cuts tight.

## Submission checklist (Rule 7)

- [ ] **Public repo** with **MIT LICENSE visible in About** ✅ (LICENSE present)
- [ ] **Hosted URL** for judging — the Cloud Run UI URL (`gitlab-oracle-ui`)
- [ ] **Code repo URL** — this repo, public, with run instructions (README ✅)
- [ ] **≤3-min video** on YouTube/Vimeo, public, English, shows it working on web
- [ ] **Text description**: features, **Google Cloud services used** (Vertex AI /
      Gemini / Agent Engine / Vector Search / Firestore / Cloud Run / Secret Manager),
      **GitLab MCP** integration, Arize Phoenix, findings & learnings
- [ ] Built **new** during the contest period; uses Gemini + Agent Builder + GitLab MCP
- [ ] Submit before **June 11, 2026, 2:00 PM PT**

## Judging criteria (equal weight) — how we hit each

- **Technological implementation**: ADK + Agent Engine + GitLab MCP + Vector Search,
  temporal graph in Firestore, streaming upserts, Phoenix tracing.
- **Design**: clean chat UI with citations; zero-friction MR webhook (no user action).
- **Potential impact**: lost institutional knowledge is a multi-billion-dollar problem;
  every team with turnover feels it.
- **Quality of idea**: reframes a coding agent as a *historian* — no existing tool does this.
