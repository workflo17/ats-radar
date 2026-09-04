# ats-radar

[github.com/workflo17/ats-radar](https://github.com/workflo17/ats-radar) (private). Roadmap and the ownership deadline that orders it: [ROADMAP.md](ROADMAP.md).

Four tools for the Greenhouse SDR job, built on one idea: every major ATS publishes
its customers' job boards as a free, unauthenticated JSON API, so you can see which
ATS a company runs and watch their hiring change day by day.

| Tool | Command |
|---|---|
| Displacement radar: who runs a competitor ATS, and what changed | `npm run collect` `report` `diff` |
| Territory ingest: any CRM export to a resolved target list | `npm run ingest` |
| Show-rate pack: the three touches that get a prospect to actually attend | `npm run brief` |
| AE handoff brief: the page that gets a meeting moved to Develop | `npm run handoff` |
| Attribution ledger: your own record, with the comp plan's math in it | `npm run ledger` |
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
| Workable | 404 | yes |
| Recruitee | 404 (subdomain does not resolve) | yes |
| Lever | 200 with `[]` | **no**, require count > 0 |
| SmartRecruiters | 200 with `totalFound: 0` | **no**, require count > 0 |

Verified against `zzznotacompany9` on 2026-09-03. Treating a bare 200 as confirmation
would file a large share of the target list under whichever of those two got probed
first. On the first real run this caught `retool.com`, which SmartRecruiters answered
200-with-zero-results for; it is recorded unresolved, not as a customer.

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

### Two data traps this handles

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
npm run brief -- --account ramp.com --contact "Jane Doe" --role "Head of Talent" \
                 --when "Tue Oct 14, 2:00pm ET" --ae "Sam Rivera"
```

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

## Data layout

```
config/targets.csv          domain,name — your territory
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
