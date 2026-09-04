# Roadmap

## The date that organizes everything

CIIA Section 2.2 assigns to Greenhouse any invention "connected with any work
performed by me for Company." Employment starts **2026-09-28**.

So the roadmap is not sorted by value. It is sorted by ownership.

| | Before 27 Sep | After 28 Sep |
|---|---|---|
| New tools | Yours, if listed on the Prior Inventions page | Greenhouse's |
| Config changes to a listed prior invention | Yours | Defensible as maintenance |
| Substantial new functionality on a listed tool | Yours | Murky, assume theirs |

The practical rule: **anything that needs building gets built before the 27th.**
After that, operate and tune. If something genuinely needs writing later, write it
knowing where it lands and decide deliberately.

---

## Built

| Tool | What it does | State |
|---|---|---|
| **Radar** `collect` `report` `diff` | Detects which ATS a company runs from public job-board APIs, snapshots daily, emits 8 priority-ranked change events | Running, scheduled 06:30, auto-commits and pushes |
| **Show-rate pack** `brief` | Three confirmation touches plus a pre-call one-pager from the prospect's own board | Working |
| **AE handoff** `handoff` | One-page brief so the AE has context to move it to Develop | Working |
| **Ledger** `ledger` | Append-only opportunity log with the commission agreement's arithmetic | Working, 12 hand-computed cases pass |

Supporting: shared fact layer (`lib/facts.mjs`), four ATS adapters, fixture generator
that exercises all eight event types, commission-math test suite, the gameplan.

### Known data traps already handled

Posting age reads `first_published` not `updated_at`. Reqs past a year are classed
evergreen and kept out of "stuck" counts. Ashby's `isRemote` means remote-eligible and
stays out of prospect-facing copy. Lever and SmartRecruiters answer 200-with-zero-results
for companies that do not exist, so detection requires a non-empty result.

---

## To build, in order

### 1. Territory ingestion `src/ingest.mjs`
**Blocking on day one.** Amanda hands over a territory as company names, probably a
Salesforce export, not domains. The collector needs domains. Name-to-domain resolution
is the gap: "Acme Health Systems, Inc." to `acmehealth.com` is a job heuristics do badly
and a language model does well. Without this, day one is manual data entry for a few
hundred rows.

Should accept a CSV in whatever shape Salesforce exports, resolve names to domains,
run detection, and report what it could not resolve so those get handled by hand.

### 2. Battlecards, wired to detection `data/battlecards/`
The radar already knows the incumbent before the first call. Right now that fact goes
unused past the ranking. Write one card per competitor (Lever, Ashby, Workday, iCIMS,
SmartRecruiters, Workable) from public comparison material, then have `brief` and
`handoff` pull the matching card automatically.

Detect Ashby, get the Ashby talk track. That is the difference between knowing the
incumbent and using it.

### 3. Workable and Recruitee adapters
Every documented public endpoint for both returned 404 on 2026-09-03. Needs a live board
to probe against. Both skew SMB and Europe, so the gap sits below the mid-market line,
which may not matter depending on the segment. Do it only if the real territory needs it.

### 4. Research brief `src/research.mjs`
Not an email generator. A per-account page that puts the board facts next to their
engineering blog, recent funding, and headcount trajectory, so a good first message takes
ninety seconds instead of fifteen minutes.

The distinction matters. Generic AI outreach is the single most saturated category in the
market and it is the part currently failing. The leverage is in compressing research, not
in generating the words.

### 5. Voice note to handoff and ledger
Largest daily time saving. Thirty seconds of dictation after a call fills the handoff
brief and logs the opportunity, instead of ten minutes of typing while the next call
starts. Transcription runs locally.

### 6. Loop closing `src/learn.mjs`
**Build the pipe before the 27th, run the analysis in December.**

By month two there will be a ledger of what converted and a snapshot history of what
preceded it. Joining them answers questions nobody else on the team can ask:

- Which signal type actually produced advanced opportunities, not just replies?
- Does the 35-day call-on window for a closed talent-leader req hold, or is it 21 days?
- Which confirmation variant got the better show rate?
- Which AEs advance, and what do their advanced meetings have in common?

This is the whole "refine the process" ambition, and it only works because the collector
has been running since 3 September. The scaffolding is a tool and belongs on the Prior
Inventions list; the answers it produces are just findings.

---

## Deliberately not building

**An AI email writer.** Saturated, and it is the part of the stack currently failing.
AI raises the floor and does not raise the ceiling: agents beat mid-pack reps and lose to
top performers. Writing the message is where the ceiling is.

**A CRM, a sequencer, or anything that sends.** Salesforce is mandated and Outreach or
Salesloft will exist. Sending from the company domain through anything unapproved is an
IT and deliverability problem not worth owning in month one.

**Contact enrichment.** Greenhouse pays for ZoomInfo or similar. Rebuilding it wastes the
window and drags private data into a repo that must stay public-data-only.

---

## The actual thesis on AI leverage

The goal is not for AI to do the job. It is for AI to remove everything that is not the
conversation.

Research, prep, post-call admin, and pattern-finding over your own results are all
compressible to near zero. Talking to people is not, and it is the only part that
separates a top performer from an agent. Every tool here is pointed at the first category
so more of the day lands in the second.

The measurable version: if research and admin drop from three hours a day to thirty
minutes, that is roughly ten extra hours a week on the phone, on the same headcount, with
better prep than anyone else on the team.
