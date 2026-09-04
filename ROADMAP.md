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
After that, operate and tune.

---

## Built

| Tool | Command | What it does |
|---|---|---|
| **Radar** | `collect` `report` `diff` | Detects which ATS a company runs from public job-board APIs, snapshots daily, emits 8 priority-ranked change events |
| **Ingest** | `ingest` | Turns any CRM export into a target list. Reads any CSV shape, resolves companies to their ATS, routes failures to a fix-by-hand file |
| **Show-rate pack** | `brief` | Three confirmation touches plus a pre-call one-pager from the prospect's own board |
| **AE handoff** | `handoff` | One-page brief so the AE has context to move it to Develop, with the competitor battlecard attached automatically |
| **Ledger** | `ledger` | Append-only opportunity log with the commission agreement's arithmetic |
| **Loop closing** | `learn` | Joins the ledger against snapshot history to find which signals actually convert |

Six ATS adapters: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee.
Battlecards for all of those plus Workday, iCIMS and a no-ATS-detected case.

### Data traps already handled

Posting age reads the true publish field, not `updated_at`, which resets on any edit.
Reqs past a year are classed evergreen and kept out of "stuck" counts. Ashby's
`isRemote` means remote-eligible and stays out of prospect-facing copy. Lever and
SmartRecruiters answer 200-with-zero-results for companies that do not exist, so
detection requires a non-empty result. Partial runs (`--limit`) and fixture diffs
write to separate files, because both were silently corrupting real history.

---

## Still to build

### 4. Research brief `src/research.mjs`
Not an email generator. A per-account page that puts board facts next to their
engineering blog, recent funding, and headcount trajectory, so a good first message
takes ninety seconds instead of fifteen minutes.

The distinction matters. Generic AI outreach is the most saturated category in the
market and it is the part currently failing. The leverage is in compressing research,
not in generating the words.

### 5. Voice note to handoff and ledger
Largest daily time saving. Thirty seconds of dictation after a call fills the handoff
brief and logs the opportunity, instead of ten minutes of typing while the next call
starts. Transcription runs locally. Depends on a working local whisper setup, so it is
the one item with a dependency outside this repo.

### Ongoing, not a build
- Swap the seed target list for the real territory the day Amanda hands one over,
  then `npm run ingest -- --file <export>.csv --replace`.
- Put the real quota into `config/comp.json`.
- Tune the battlecards against Greenhouse's own enablement material, which will have
  actual win/loss data behind it.
- Run `npm run learn` monthly from December, once there is enough ledger data for a
  percentage to mean anything.

---

## Deliberately not building

**An AI email writer.** Saturated, and it is the part of the stack currently failing.
AI raises the floor and does not raise the ceiling: agents beat mid-pack reps and lose
to top performers. Writing the message is where the ceiling is.

**A CRM, a sequencer, or anything that sends.** Salesforce is mandated and Outreach or
Salesloft will exist. Sending from the company domain through anything unapproved is an
IT and deliverability problem not worth owning in month one.

**Contact enrichment.** Greenhouse pays for ZoomInfo or similar. Rebuilding it wastes
the window and drags private data into a repo that must stay public-data-only.

---

## The actual thesis on AI leverage

The goal is not for AI to do the job. It is for AI to remove everything that is not
the conversation.

Research, prep, post-call admin, and pattern-finding over your own results are all
compressible to near zero. Talking to people is not, and it is the only part that
separates a top performer from an agent. Every tool here is pointed at the first
category so more of the day lands in the second.

The measurable version: if research and admin drop from three hours a day to thirty
minutes, that is roughly ten extra hours a week on the phone, on the same headcount,
with better prep than anyone else on the team.
