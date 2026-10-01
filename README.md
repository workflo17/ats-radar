# ats-radar

[github.com/workflo17/ats-radar](https://github.com/workflo17/ats-radar) (private). Roadmap and the
ownership deadline that orders it: [ROADMAP.md](ROADMAP.md). **Step-by-step instructions for
using these day to day: [RUNBOOK.md](RUNBOOK.md)**, or double-click `START-HERE.cmd` for a menu.
This file is the reference for how they work; the runbook is the one to read first.

Nine commands for the Greenhouse SDR job, built on one idea: every major ATS publishes
its customers' job boards as a free, unauthenticated JSON API, so you can see which
ATS a company runs and watch their hiring change day by day.

| Tool | Command |
|---|---|
| Displacement radar: who runs a competitor ATS, and what changed | `npm run collect` `report` `diff` |
| Territory ingest: any CRM export to a resolved target list | `npm run ingest` |
| Show-rate pack: the three touches that get a prospect to actually attend | `npm run brief` |
| AE handoff brief: the page that gets a meeting moved to Develop | `npm run handoff` |
| Attribution ledger: your own record, with the comp plan's math in it | `npm run ledger` |
| Call-on queue: the dated follow-ups the radar generates, resurfaced when due | `npm run queue` |
| Health: is the collector actually running, and what is still a placeholder | `npm run health` |
| Dashboard: the whole morning on one page, in Greenhouse's own palette | `npm run dashboard` |
| Recommendation: grade, why them, why now, what to lead with | `src/approach.mjs`, used by the dashboard |
| Loop closing: which signals actually convert | `npm run learn` |

They map to the four terms your pay actually runs through. A Stage Two Opportunity
is a meeting you booked, **that the prospect attended**, **that the AE advanced**.
Most SDR tooling attacks the first term. Tools 2 and 3 attack the two your plan names.

## Why the radar is worth running yourself

ZoomInfo, HG Insights and 6sense all sell ATS technographics, so "who runs what" is
already purchasable. Two things make polling it yourself worth the effort:

1. **Freshness.** Practitioner benchmarks put ZoomInfo's technographic lag at 90 to
   180 days for mid-market records. These APIs are same-day.
2. **Change, not state.** Vendors sell a snapshot. "You're on Lever" is a
   technographic. "You closed your Head of Talent req three weeks ago" is a reason
   to call. Change only exists if you have been collecting, which is why the daily
   job matters more than any single run.

---

## Tool 1: displacement radar

```bash
npm run collect          # poll every target, write today's snapshot
npm run report           # rank the latest snapshot into a call list
npm run diff             # what changed since yesterday
npm run diff -- --days 30    # what changed in a month (best for reposts)
```

`collect:smoke` does the first 8 targets. `collect:force` re-detects everything from
scratch. Replace `config/targets.csv` with your real territory on day one; the seed
list is 65 recognizable tech companies, there only to prove the pipeline.

### Pinning a board the detector cannot find

`config/targets.csv` takes `domain,name` or `domain,name,ats,token`. The second form
skips detection and never expires.

```
front.com,Front,ashby,frontcareers
```

Front is the case that justified it: `frontcareers` is derivable from neither `front.com`
nor "Front", so candidate generation can never reach it and the account sits unresolved
forever. Pinning it moved the seed list from 54 resolved to 55, and their board has 18
open reqs on a competitor ATS.

The ATS and token are read off the end of the row, and only when the second-to-last field
names a real adapter, because company names contain commas and splitting from the front
eats them.

A pin also stays silent in the next diff. Taking manual control changes what you believe,
not what the company runs, so a newly pinned account emits neither `BOARD_APPEARED` nor
`ATS_MIGRATION`. Front had been misfiled under Workable on an empty board; without that
rule, correcting it read back as "they just churned off a competitor" at priority 9.

### How detection works

Given `figma.com`, `src/detect.mjs` generates candidate board tokens (`figma`, plus
name-derived and vanity-suffix-stripped variants) and probes each ATS in turn.
Candidates are the outer loop because the domain label is the right token most of the
time, so a hit usually costs one round of probes rather than a full cross product.

**The gotcha that matters.** Probed with a nonsense token:

| ATS | Bad token returns | Safe to detect on status alone? |
|---|---|---|
| Greenhouse | 404 | yes |
| Ashby | 404 | yes |
| Recruitee | 404 (subdomain does not resolve) | yes |
| Lever | 200 with `[]` | **no**, require count > 0 |
| SmartRecruiters | 200 with `totalFound: 0` | **no**, require count > 0 |
| Workable | 404 | **no**, and a nonsense token is not the test that matters |

Verified against `zzznotacompany9` on 2026-09-03. Treating a bare 200 as confirmation
would file a large share of the target list under whichever of those two got probed
first. On the first real run this caught `retool.com`, which SmartRecruiters answered
200-with-zero-results for; it is recorded unresolved, not as a customer.

**Workable needed the same rule for a different reason.** It does 404 a nonsense
token, which is why it sat in the safe column until 2026-09-16. The case the nonsense
probe never reaches is a *real brand* holding a dormant Workable account:
`accounts/scale` answers 200 with `{"name":"Scale","jobs":[]}` while Scale AI's 221
reqs sit on Greenhouse. Workable is probed before SmartRecruiters, so on 2026-09-16
four accounts flipped to Workable on empty boards, Scale AI among them, and the diff
reported them as `ATS_MIGRATION` at priority 9. An empty board now counts as
ambiguous, the same rule Lever and SmartRecruiters already had. The lesson: the
question is not "does a fake token 404", it is "can this API say yes about a company
that is not a customer".

Resolutions cache in `data/registry.json` and re-verify every 7 days, because an ATS
change is itself one of the strongest signals available.

### Signals

From a single snapshot (`report`): on a competitor ATS · hiring a talent leader ·
growing TA team · stuck reqs.

From two or more snapshots (`diff`), ranked by priority:

| P | Event | Why it matters |
|--:|---|---|
| 10 | `TALENT_LEADER_HIRED` | A senior talent req closed. They hired. The report gives you a **call-on date** 35 days out, which lands in week two of the new person's tenure while they are still listing what is broken. |
| 9 | `ATS_MIGRATION` | They moved platforms. Just churned off a competitor, or mid-evaluation. |
| 8 | `TALENT_LEADER_POSTED` | The buyer is being recruited right now. |
| 7 | `REPOST` | Closed a req and posted it again. They cannot fill it. |
| 6 | `VELOCITY_SPIKE` | Hiring accelerating past what their current process handles. |
| 5 | `TA_TEAM_GROWING` | Two or more new recruiter reqs. |
| 4 | `BOARD_APPEARED` | Started hiring properly where there was nothing. |
| 3 | `BOARD_EMPTIED` | Freeze or cleanup. Worth knowing before you call. |

### Data traps this handles

**Requisition ids are not ids.** Greenhouse hands Stripe the literal string
`See Opening ID` for all 651 of their reqs, and Brex reuses one id across every location
a role is open in: 261 reqs, 80 distinct ids. Keyed naively, one survivor per id then
matches every new posting that shares it, which reported 114 Stripe reposts in the
2026-09-16 diff and buried the two events worth calling under 190 rows. An identifier now
counts only when it names exactly one req on each side of the comparison, with an exact
title match under the same rule as the fallback. Same diff, 193 events down to 58.

**Posting age.** Greenhouse returns both `updated_at` and `first_published`. The
adapter uses `first_published`, because `updated_at` resets on any edit and would
make every stale req look freshly opened.

**Evergreen reqs.** Anything open past a year is a pipeline posting, not a role
anyone is failing to fill. Ramp has a frontend req at 1,274 days. Quoting that back
as "stuck" reads as not understanding their board, so evergreen is counted separately
and kept out of the examples. "Stuck" means 60 to 365 days.

**Remote flags lie.** Ashby marks a Security Engineer sitting at Ramp's NYC HQ as
`isRemote`, so 92% of that board reads remote while 110 of 143 reqs are in New York.
The field is exposed as `remoteEligibleShare` and stays out of prospect-facing copy.

---

## Tool 2: show-rate pack

```bash
npm run brief -- --account Ramp --contact "Jane Doe" --role "Head of Talent" \
                 --when "Tue Oct 14, 2:00pm ET" --ae "Sam Rivera" --copy
```

`--account` takes a name or a domain. `--copy` puts the first message on the clipboard,
because the ten-minute window is the point and it closes while you scroll a markdown file
looking for the right fenced block.

Your quota only counts meetings the prospect attends. The benchmark show rate is 75
to 80%, an instant personal confirmation cuts no-shows by around 40%, and a
personalized pre-call asset moves close rates on positive replies from 8.4% to 31.2%.
Teams running the full stack report 70% to 88% inside a month. On 12 booked meetings
at quota 10, that is the difference between missing and clearing.

Generates three touches (immediate, day-before, two-hours-out) plus the pre-call
one-pager built from their own board data.

**It writes text and never sends anything.** Sending from the company domain through
anything unapproved is an IT and deliverability problem you do not want to own.

## Tool 3: AE handoff brief

```bash
npm run handoff -- --account ramp.com --contact "Jane Doe" --role "Head of Talent" \
                   --when "Tue Oct 14, 2:00pm ET" --ae "Sam Rivera" \
                   --trigger "Closed their Head of Talent Ops req 3 weeks ago" \
                   --notes "On Ashby. Reporting across sources is the pain."
```

The meeting only counts once the AE moves it to Develop, and that call gets made off
whatever context they have ten minutes beforehand. One page: who, why now, what they
said, their board from the outside, and four questions worth asking, chosen from what
their board actually shows.

The second-order effect is the bigger one. AEs talk about which SDR makes their life
easier, and that is how you end up with the good territory.

## Tool 4: attribution ledger

```bash
npm run ledger -- add --account ramp.com --contact "Jane Doe" --when 2026-10-14
npm run ledger -- held k3f9x2
npm run ledger -- noshow k3f9x2 --note "rescheduled to 10/21"
npm run ledger -- advanced k3f9x2 --ae "Sam Rivera"
npm run ledger -- closed k3f9x2 --value 42000 --on 2026-11-20
npm run ledger -- list
npm run ledger -- month 2026-10
```

Append-only event log in `data/ledger.jsonl`. Corrections are events too, so nothing
is overwritten and the history stays intact. `--on` backdates a status change to the
day it really happened, so backfilling a week on Friday does not stamp everything
Friday.

`month` computes attainment, show rate, AE accept rate, and what the plan says you
earned, using the arithmetic in Sections II, III and IV of the 2026 Individual
Commission Agreement: nothing below 70% of quota, a flat per-opportunity rate from
70% to just under quota, then the 150 / 175 / 200% accelerator bands above it, plus
the Sales Contract Bonus with its per-deal and quarterly caps.

`config/comp.json` holds quota, the Monthly Role Bonus and the ramped monthly quotas.
**Quota is not in the agreement**, so fill it in once Amanda gives you the number.

`npm test` checks the payout function against twelve values worked by hand from the
contract text.

Why bother: the plan says bonuses are "in the complete and sole discretion of the
Company" and "not earned until paid", and attainment comes from a Salesforce record
you do not control, where the qualifying event is an AE changing a picklist. You will
probably never need this. The month you do, it is the difference between a
conversation and a shrug.

---

## Territory ingest

```bash
npm run ingest -- --file territory.csv --dry-run
npm run ingest -- --file territory.csv --replace
```

A CRM export gives company names, sometimes a website column, rarely a clean domain,
and never a board token. This reads any CSV shape, works out which columns matter,
strips legal suffixes ("Hugging Face, Inc." to `huggingface`), resolves each company
to its ATS and appends the hits to `config/targets.csv`. Failures go to
`data/unresolved.csv` with the original row intact.

**A domain is not required.** Board tokens are derived from the company name at least
as often as from the domain, so a bare list of names resolves most of the way. Tested
against a Salesforce-shaped export: "Gopuff" with an empty website column still
resolved to Lever.

## Loop closing

```bash
npm run learn
npm run learn -- --window 30
```

Replays every consecutive snapshot pair into a dated signal history, joins it against
the ledger, and reports advance rate by preceding signal, whether the 35-day call-on
delay is right, where the funnel leaks, and per-AE accept rate.

It refuses to show a percentage below n=5, because a rate computed on four rows is
noise wearing a suit. With an empty ledger it says so and explains what it will report
once there is data, rather than printing an empty table.

## Dashboard

```bash
npm run dashboard      # -> data/dashboard.html, opened by menu option 1
```

One page, rebuilt by the 06:30 job, in four sections: **Now** (health, then the calls
worth making), **Soon** (the call-on queue), **Where to dig** (the territory, filterable
and sortable), and **How this works** (the pipeline, explained with the morning's own
numbers).

The organising rule is that a claim is always visible, the evidence behind it is one
click away, and the rule that produced it is findable. Every signal card opens to its
trail: which req closed, when it was last seen, which rule its title matched, why the
call-on date is 35 days out, and the two snapshot files it was read from. Every account
opens to its scorecard: the five components, what each scored, and why that component
exists at all. The last section explains collect, detect, snapshot, compare and rank
using today's real figures, plus an honest list of what the system cannot see.

The palette and type are Greenhouse's own, read off their live design tokens on
2026-09-16: evergreen `#15372c` for ink, green-700 `#008561` for accounts already on
Greenhouse, blue-500 `#3574d6` for everyone on a rival ATS, marigold for warnings. Their
faces are Untitled Sans and Untitled Serif, which are licensed, so this uses Instrument
Sans and Instrument Serif, the same pairing as the LinkedIn kit.

The chart worth explaining is **where hiring is stuck**. One tick per open role, placed
by how many days it has been open, with the 60-day line marked and anything past a year
pushed to the right as an evergreen pipeline post. A dense cluster left of the line is a
company hiring normally. A long tail to the right is a company that cannot fill what it
posts, which is the whole pitch, drawn. It is the one chart here that is not a summary:
it plots all 145 of Ramp's reqs individually.

Below 760px the comb is hidden rather than squeezed, because 145 ticks in 98px is a
smear, not a chart. The generated file is git-ignored: it is derived from committed data
and regenerating it takes a second.

## The recommendation

Every account on the dashboard carries a grade and a plan. `src/approach.mjs` builds it,
and three research findings from 2026-09-16 shape it.

**New business or not, first.** On the day this was written, three of the four
highest-priority signals in the territory were at Datadog, Twilio and Figma, all of them
already running Greenhouse. A talent leader hired at a customer is a real event, worth
flagging to whoever owns the account, but it is not a meeting an SDR can book and it does
not count toward quota. Every recommendation says which it is before it says anything
else, and the headline counts only bookable calls. It read "Four calls worth making
today" before this landed; it reads "One" now, which is the true number.

**Two axes, not one.** The 30-point score asks how much visible pain a board is in. The
grade asks whether to call. **Pain** out of 10 is what the board shows. **Timing** out of
10 is whether there is a dated reason to call this week. A board can hurt a great deal
and have no reason to be called today, and a trigger at a company with no visible pain is
a call with nothing to talk about. A is 13 or more, B is 8 to 12, C is 4 to 7, D is under
4 or under 15 open reqs, which usually means a company below the 150 employees
Greenhouse's ICP starts at.

**Stack the signals and name a peer.** Signal-personalised outreach replies at around 18%
against 3.43% for generic, and trigger plus research plus a named peer reference sits in
the 15 to 25% band. So each recommendation stacks every signal it has, and names a
comparable company from the same territory that already runs Greenhouse, sized within
half to double their req count. That peer is the one input a generic tool cannot produce,
because it needs the rest of the territory resolved first.

The generated opener is checked against the words that cost 30 to 50% of opens when they
read as a pitch, and flagged rather than silently handed over. It will not write the
message. Generic AI outreach is the most saturated category in the market; the leverage
is in compressing the research, not generating the words.

Competitive positioning is internal. The recommendation draws on `config/battlecards.json`
for the angle, the question that opens it, and the thing not to say, and it is wired into
the dashboard and the AE handoff but never into `brief.mjs`, which a prospect reads.

## Call-on queue and health

```bash
npm run queue                  overdue, due today, and the next two weeks
npm run queue -- done a1b2c3   you called them
npm run health                 is the collector running, what is still a placeholder
```

`TALENT_LEADER_HIRED` computes a call-on date 35 days out and used to write it into a
markdown file nobody reopens 35 days later, so the best signal in the system expired
unread. The diff now files every dated signal into `data/callons.jsonl`, append-only and
idempotent, and the morning menu shows what is due before anything else.

`health` exists because on 2026-09-16 the collector had been dead for eight days and
nothing noticed. The scheduled task was set to refuse to start on battery, the laptop was
on battery at 06:30, and Windows declined it every morning in silence while the report
still rendered and the diff still ran against whatever two files were newest. It checks
snapshot age, fetch errors, whether quota is still the placeholder, whether the seed
target list is still in place, and meetings whose date has passed while still marked
booked. It prints nothing when there is nothing to say, because a check that prints a
wall of green teaches you to skip it.

## Data layout

```
config/targets.csv          domain,name  (your territory)
                            domain,name,ats,token to pin a board by hand
data/callons.jsonl          append-only queue of dated follow-ups
config/comp.json            quota, role bonus, accelerators, caps
data/registry.json          domain -> {ats, token, detectedAt, lastVerified, history}
data/snapshots/YYYY-MM-DD.json   full job list per account, one file per day
data/reports/YYYY-MM-DD.md       ranked call list
data/reports/diff-YYYY-MM-DD.md  change events
data/briefs/                     generated show-rate packs and AE handoffs
data/ledger.jsonl                append-only opportunity log
logs/daily.log                   scheduled run output
```

Snapshots are the asset. Never delete them; the whole point is the time series.

## Scheduling

`run-daily.cmd` runs the collector, the report and the diff, appending to
`logs/daily.log`, then commits any new snapshot and pushes it to the private GitHub
repo. Registered as Windows scheduled task `ats-radar-daily` at 06:30.

The push matters for two reasons. Snapshots are the asset, and change signals only
exist because yesterday's file is still around, so losing the disk loses the history.
It also keeps a continuous dated record on a third-party host, which is what makes the
Prior Inventions build date verifiable by someone other than you.

```bash
schtasks /query /tn ats-radar-daily        # check it
schtasks /run   /tn ats-radar-daily        # run it now
schtasks /delete /tn ats-radar-daily /f    # remove it
```

Deliberately a `.cmd` and not a `.ps1`, because AVG deletes scheduled PowerShell
scripts on this machine.

## Boundaries

Two rules, both CIIA consequences:

**Data flows one way.** Public web in, ranked list out. Nothing from Greenhouse's
Salesforce, customer records or internal data ever enters this repo. CIIA 1.1 says
company information "cannot be downloaded or retained for my personal use", and
CIIA 9 lets them inspect a personal machine used for company data. Keep this reading
public APIs only and that exposure never exists.

**Built before the start date.** Greenhouse employment begins 2026-09-28. CIIA 2.2
assigns anything "connected with work performed for Company", so a tool built after
that date to do the job belongs to them. This was built 2026-09-03 and the git
history is the contemporaneous record. List it on the CIIA Prior Inventions page
before signing. Using it at work still grants Greenhouse a perpetual free licence
under CIIA 2.3(b) and triggers a written-notice duty, but ownership stays here.

## Not done

- **Department data for Greenhouse accounts.** The basic feed omits it and the
  `/departments` endpoint would double the request count, so the talent-role signal
  reads job titles instead.
- **Contact discovery.** Out of scope on purpose. Greenhouse will supply ZoomInfo or
  similar, and this stays a public-data-only asset.
- **Real diff history.** The first genuine diff needs tomorrow's 06:30 run. Until
  then, `npm run fixture` builds a synthetic yesterday in `test/fixtures/` that
  exercises all eight event types without touching the real snapshot store.
