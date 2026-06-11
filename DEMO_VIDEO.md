# DevGenie — Demo Video Production Guide (≤3 min)

## Strategy (read this first)

AI video generators (Omni/Veo/Sora-class) are **great at cinematic b-roll and
terrible at rendering real UI text** — buttons and code come out as garbled
glyphs, and judges notice. The winning formula for a hackathon demo:

> **AI-generated cinematic intro + outro (≈25s total) · real screen recordings
> of the live product for the middle (≈2:20) · one AI voiceover track over
> everything.**

Judges must see the real product doing real things. Use Omni for emotion,
screen capture for proof.

---

## The story arc (3 acts, 2:55 total)

| Time | Act | Source |
|---|---|---|
| 0:00–0:15 | **The problem** — knowledge evaporates | Omni (generated) |
| 0:15–2:35 | **The product** — 6 features, one continuous session | Screen recording |
| 2:35–2:55 | **The close** — stack + tagline | Omni (generated) + logo card |

---

## Act 1 — Omni prompts (generated intro, 0:00–0:15)

Generate these two clips. Keep the style tokens identical so they cut together.

**Clip 1 (8s) — "the leaving engineer":**
```
Cinematic shot, dark moody office at night lit by monitor glow. A senior
software engineer packs a cardboard box and walks away from a desk with two
glowing monitors covered in code. As they exit, the code on the screens
flickers and fades to black, line by line, like memory being erased.
Slow dolly-in on the dying screens. Photorealistic, shallow depth of field,
teal and orange color grade, 24fps, no on-screen text.
```

**Clip 2 (7s) — "the genie awakens":**
```
Continuation, same dark office, same teal-and-orange grade. The black monitor
flickers back to life: glowing teal threads of light rise from a git commit
graph and weave themselves into a luminous network of connected nodes floating
above the desk — a knowledge graph taking shape like a genie of light emerging
from a lamp. Magical but precise, particles condensing into order.
Photorealistic CGI, slow upward camera tilt, 24fps, no on-screen text.
```

> Tip: if Omni supports a reference image, feed it `frontend/public/devgenie.png`
> for the genie's color language. Never ask it to render readable UI/text.

---

## Act 2 — Screen-recording shot list (the real product, 0:15–2:35)

Record at 1920×1080, 125% browser zoom, cursor visible. One take per shot is
fine — you'll trim. Use the **live site** so the URL bar shows it's real:
`https://devgenie-app-70965519212.us-central1.run.app`

| # | Time | What to capture (exact actions) |
|---|---|---|
| 1 | 0:15–0:30 | Landing page → click **Continue with GitLab** → land on **Dashboard**: linger 3s on the stat cards (1,500 commits · 697 MRs · 63 REVERTS) and Top risky areas panel |
| 2 | 0:30–1:00 | Click **Open chat** → type: `Which parts of this codebase are the riskiest to touch, based on revert and bug history?` → let the answer stream → **hover 2 clickable citations**, click one, show the real GitLab MR opening in a new tab |
| 3 | 1:00–1:25 | Back to chat → type: `Tell me the full story behind MR !236381 — what was tried and why?` → show the Attempt → Failure → Revert narrative with links |
| 4 | 1:25–1:50 | Type: `Explain commit 2391b107 in detail — what exactly did it change?` → show the line-by-line explanation (proves it reads real diffs) |
| 5 | 1:50–2:10 | Click **Score MR** → paste an MR title/description/files → show the **0–100 risk badge** and the explainable reasons appearing |
| 6 | 2:10–2:25 | Click **Knowledge graph** → drag the force-directed graph, hover a **red reversion edge** |
| 7 | 2:25–2:35 | Open **Settings** → show the GitLab PAT field validating ("✓ Token works — N projects visible") → flash the Sign out / account card |

> Optional power-shot if you have time: open a real MR on your fork and show the
> **webhook's auto-posted risk comment** on the GitLab MR page itself. This is
> the single most impressive 8 seconds you can include — it shows DevGenie
> acting *without being asked*.

---

## Act 3 — Omni prompt (outro, 2:35–2:55)

```
Cinematic closing shot, same teal-and-orange grade. Camera pulls back from a
single glowing knowledge-graph node to reveal a vast constellation of
connected commits, merge requests, and decisions forming the silhouette of a
genie above a laptop. The constellation gently pulses like a heartbeat.
Dark background, particles, photorealistic CGI, slow pull-back, 24fps,
no on-screen text.
```

End on a **static title card** (make in Canva/Figma, 5s):
**DevGenie** — *Your repository already wrote the documentation. Now it answers back.*
`devgenie-app-70965519212.us-central1.run.app · Built on Google Cloud · GitLab track`

---

## Voiceover script (~430 words ≈ 2:50 at natural pace)

Timed to the acts. Record/generate as ONE track, then nudge clips to fit it.

> **[0:00]** Every codebase has a memory problem. Engineers spend more than
> half their time just understanding existing code — and the hardest question
> is never *what* the code does. It's *why*. The answers exist — buried in
> old merge requests, review threads, and reverted commits. And when an
> engineer leaves, that context walks out the door with them.
>
> **[0:15]** This is DevGenie — institutional memory on demand, for any GitLab
> repository. Sign in with GitLab, and DevGenie builds a reversion-aware
> knowledge graph of your repo's entire history — here, GitLab's own
> repository: fifteen hundred commits, almost seven hundred merge requests,
> and sixty-three reverts it learned from.
>
> **[0:30]** Ask it what's risky to touch. DevGenie doesn't guess — it mines
> your actual revert history, and every claim comes with a clickable citation
> back to the real commit, merge request, or incident. Click one — that's the
> actual MR on GitLab. No hallucinations. Receipts.
>
> **[1:00]** Ask for the full story behind any decision, and you get the
> complete arc: what was attempted, how it failed, and the revert that
> followed — the lesson your team already paid for, finally retrievable.
>
> **[1:25]** It reads real code, too. Ask about any commit and DevGenie pulls
> the actual diff and walks you through it line by line — what changed, and
> why it matters.
>
> **[1:50]** Before you merge, Score your MR. DevGenie compares it against
> every approach your team has ever reverted and returns a zero-to-one-hundred
> risk score — with explainable reasons, not a black box. And through GitLab
> webhooks, it does this automatically on every new merge request — warning
> the author *before* the mistake is repeated.
>
> **[2:10]** Explore the knowledge graph itself — decisions and their
> reversion edges, in red.
>
> **[2:25]** It's a real multi-tenant product: OAuth-scoped access — you can
> only query what you can already read — plus personal access tokens for
> teams that need more.
>
> **[2:35]** DevGenie is built on Google Cloud: Gemini 2.5 Pro with the Agent
> Development Kit, Vertex AI Vector Search, Firestore, and Cloud Run — with
> the official GitLab MCP server live in every review. Your repository
> already wrote the documentation. DevGenie makes it answer back.

---

## How to add audio (3 options, best → fastest)

### Option A — Google Cloud TTS (free with your project, on-brand for judges)
```bash
# Chirp3 HD voices are the newest; en-US-Chirp3-HD-Charon is a good male narrator,
# en-US-Chirp3-HD-Kore female. List voices: gcloud beta tts voices list (or API).
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: autodev-agent" \
  -H "Content-Type: application/json" \
  https://texttospeech.googleapis.com/v1/text:synthesize \
  -d '{
    "input": {"text": "PASTE THE VOICEOVER SCRIPT HERE"},
    "voice": {"languageCode": "en-US", "name": "en-US-Chirp3-HD-Charon"},
    "audioConfig": {"audioEncoding": "MP3", "speakingRate": 1.0}
  }' | python3 -c "import sys,json,base64;open('voiceover.mp3','wb').write(base64.b64decode(json.load(sys.stdin)['audioContent']))"
```
(Enable once: `gcloud services enable texttospeech.googleapis.com`.)

### Option B — ElevenLabs (most natural, free tier covers 3 min)
Paste the script at elevenlabs.io → pick "Adam" or "Brian" → download MP3.

### Option C — record yourself (judges often prefer a human founder voice)
QuickTime → New Audio Recording. Read at a calm pace; re-take per paragraph.

### Mixing it together (no editor needed — pure ffmpeg)
```bash
# 1. Concatenate your clips (same resolution/fps):
printf "file 'intro1.mp4'\nfile 'intro2.mp4'\nfile 'screen.mp4'\nfile 'outro.mp4'\nfile 'titlecard.mp4'\n" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy assembled.mp4

# 2. Lay the voiceover over it (replaces any screen-recording audio):
ffmpeg -i assembled.mp4 -i voiceover.mp3 -map 0:v -map 1:a -c:v copy -shortest demo_final.mp4

# 3. (Optional) duck in background music at 12% volume under the voice:
ffmpeg -i demo_final.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.12[m];[0:a][m]amix=inputs=2:duration=first" \
  -c:v copy demo_final_music.mp4
```
Royalty-free music: YouTube Audio Library → search "ambient technology"
(e.g. anything tagged Cinematic/Ambient, no attribution required).

If you prefer a GUI: **CapCut** (free) or **DaVinci Resolve** — drop clips on
the timeline, drop `voiceover.mp3` under them, trim video to the narration.

---

## Final checklist
- [ ] ≤ 3:00 total (Devpost limit) — target 2:55
- [ ] Live URL visible in the browser bar during screen recordings
- [ ] At least one citation clicked through to real GitLab
- [ ] The webhook MR comment shot if time allows (biggest wow)
- [ ] Upload to YouTube as **Unlisted**, paste link into SUBMISSION.md + Devpost
