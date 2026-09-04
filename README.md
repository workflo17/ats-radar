# ats-radar

Polls the public job-board APIs that every major ATS publishes, works out which ATS
each target company runs, and tracks how their hiring changes day over day.

Built for selling Greenhouse. A company on Lever or Ashby is a displacement target,
and the reqs they have open tell you when to call and what to say.

## Why this exists

ZoomInfo, HG Insights and 6sense all sell ATS technographics, so the raw fact of
"who runs what" is already purchasable. Two things make polling it yourself worth
the effort:

1. **Freshness.** Practitioner benchmarks put ZoomInfo's technographic lag at 90 to
   180 days for mid-market records. These APIs are same-day.
2. **Change, not state.** Vendors sell a snapshot. "You're on Lever" is a
   technographic. "You've opened 14 reqs in three weeks and reposted two of them"
   is a reason to talk. Change signals only exist if you have been collecting,
   which is why the daily job matters more than any single run.

## Quickstart

```bash
npm run collect        # poll every target, write today's snapshot
npm run report         # rank the latest snapshot into a call list
```

`npm run collect:smoke` does the first 8 targets, for when you are changing adapters.
`npm run collect:force` ignores the registry and re-detects every company from scratch.

Replace `config/targets.csv` with your real territory on day one. The seed list is
65 recognizable tech companies, there only to prove the pipeline.

## How detection works

Given `figma.com`, `src/detect.mjs` generates candidate board tokens (`figma`, plus
name-derived and vanity-suffix-stripped variants) and probes each ATS in turn.
Candidates are the outer loop because the domain label is the right token most of the
time, so a hit usually costs one round of probes rather than a full cross product.

**The gotcha that matters.** Probed with a nonsense token:

| ATS | Bad token returns | Safe to detect on status alone? |
|---|---|---|
| Greenhouse | 404 | yes |
| Ashby | 404 | yes |
| Lever | 200 with `[]` | **no**, require count > 0 |
| SmartRecruiters | 200 with `totalFound: 0` | **no**, require count > 0 |

Verified against `zzznotacompany9` on 2026-09-03. Treating a bare 200 as
confirmation would file a large share of the target list under whichever of those
two got probed first. On the very first real run this caught `retool.com`, which
SmartRecruiters answered 200-with-zero-results for. It is recorded as unresolved
with the ambiguity noted, not as a SmartRecruiters customer.

Resolutions cache in `data/registry.json` and re-verify every 7 days, because an
ATS change is itself one of the strongest signals available. A company that shows
up on a different ATS than last week is mid-migration and worth a call that day.

## Signals

Working today, from a single snapshot (`src/report.mjs`):

- **On a competitor ATS.** The displacement universe, and you know the incumbent
  before the first call.
- **Hiring a talent leader.** A "Head of Talent" or "Director of Recruiting" req
  means the buyer is arriving. New HR leaders audit the tech stack inside their
  first 90 days, so this is a dated invitation.
- **Growing TA team.** Several recruiter reqs means the function is scaling and
  will outgrow whatever it is on.
- **Stale reqs.** Anything open past 60 days, measured from true publish date.
  A high stale ratio is the structured-hiring pitch in their own numbers.

Needs two or more snapshots, so it lands once there is history (`src/diff.mjs`, not
yet written):

- **Vanished talent-leader req.** The single best trigger in the set. The req
  disappears, they hired someone, that person starts in 4 to 8 weeks. Wait about
  five weeks and reach them in week two of the job, while they are still writing
  the list of things that are broken.
- **Req velocity spike.** Open count jumping sharply in 30 days.
- **Reposts.** Same role posted again after closing. Greenhouse exposes
  `requisition_id`, which makes this exact rather than fuzzy title matching.
- **ATS migration.** Already detected and logged by the collector, needs the
  report surface.

### A note on posting age

Greenhouse returns both `updated_at` and `first_published`. The adapter uses
`first_published`, because `updated_at` resets on any edit and would make every
stale req look freshly opened. Ashby uses `publishedAt`, Lever `createdAt`.

Some companies run evergreen reqs that never close (Gopuff shows 735 of 765 open
past 60 days, which is warehouse and driver hiring, not dysfunction). Read the
stale ratio alongside the job titles rather than on its own.

## Data layout

```
config/targets.csv          domain,name — your territory
data/registry.json          domain -> {ats, token, detectedAt, lastVerified, history}
data/snapshots/YYYY-MM-DD.json   full job list per account, one file per day
data/reports/YYYY-MM-DD.md       ranked call list
logs/daily.log              scheduled run output
```

Snapshots are the asset. Never delete them, the whole point is the time series.

## Scheduling

`run-daily.cmd` runs the collector then the report, appending to `logs/daily.log`.
Registered as Windows scheduled task `ats-radar-daily` at 06:30.

```bash
schtasks /query /tn ats-radar-daily        # check it
schtasks /run   /tn ats-radar-daily        # run it now
schtasks /delete /tn ats-radar-daily /f    # remove it
```

Deliberately a `.cmd` and not a `.ps1`, because AVG deletes scheduled PowerShell
scripts on this machine.

## Boundaries

Two rules this tool must keep, both of them CIIA consequences:

**Data flows one way.** Public web in, ranked list out. Nothing from Greenhouse's
Salesforce, customer records or internal data ever enters this repo. CIIA 1.1 says
company information "cannot be downloaded or retained for my personal use," and
CIIA 9 lets them inspect a personal machine used for company data. Keep this
reading public APIs only and that exposure never exists.

**Built before the start date.** Greenhouse employment begins 2026-09-28. CIIA 2.2
assigns anything "connected with work performed for Company," so a tool built after
that date to do the job belongs to them. This one was built 2026-09-03, and the git
history is the contemporaneous record of that. List it on the CIIA Prior Inventions
page before signing. Using it at work still grants Greenhouse a perpetual free
license under CIIA 2.3(b), and triggers a written-notice obligation, but ownership
stays here.

## Not done

- Workable and Recruitee adapters. Every documented public endpoint for both
  returned 404 when probed on 2026-09-03, so their real shape is unconfirmed.
  Guessing would silently misclassify accounts. Both skew SMB and Europe, so the
  gap mostly costs coverage below the mid-market line.
- `src/diff.mjs`, blocked on having two snapshots.
- Department data for Greenhouse accounts. The basic feed omits it and the
  `/departments` endpoint would double the request count, so the talent-role
  signal reads job titles instead.
- Contact discovery. Out of scope on purpose. Greenhouse will supply ZoomInfo or
  similar, and this tool should stay a public-data-only asset.
