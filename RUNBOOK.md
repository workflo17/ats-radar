# Runbook

How to actually use the tools, one step at a time.

[README.md](README.md) explains how they work and why. [ROADMAP.md](ROADMAP.md) is what
is built and what is not. [docs/gameplan.html](docs/gameplan.html) is the strategy. This
file is the one you keep open in your first month.

Everything runs from one file. Double-click **START-HERE.cmd** in this folder and pick a
number. Nothing here needs the command line, and nothing here sends a message to anybody.
Every tool writes text to a file and stops. You read it, you decide, you send it yourself.

---

## Before your first day

Three things, maybe twenty minutes total.

**1. Open the menu once so you know what it looks like.**
Double-click `START-HERE.cmd`. Pick 1. A health check and your call-on queue print in the
window, then the dashboard opens in your browser. Press Enter to get back to the menu,
then Enter again to quit. That is the whole interface.

**2. Put your real quota in.**
Open `config/comp.json` in Notepad. The line `"quota": 10` is a placeholder, because the
number is not in your commission agreement. Amanda sets it. Ask her in week one, then put
it here along with your ramped months in `quotaByMonth`. Until that number is right, the
payout math in option 4 is guesswork.

**3. Replace the target list.**
`config/targets.csv` currently holds 65 recognizable tech companies. It exists to prove
the pipeline works, not because those are your accounts. The day Amanda hands you a
territory, export it from Salesforce and use menu option 5. It reads whatever shape the
CSV is in, works out which columns matter, and resolves each company to its ATS.
Anything it cannot resolve lands in `data/unresolved.csv` with the original row intact,
so you can fix those few by hand.

---

## Every morning, before you dial

**Menu option 1.** The health check and the call-on queue print in the console, then the
dashboard opens in your browser.

**The health check** answers whether the data is real. It says nothing when there is
nothing to say. When it does speak, read it before you dial: a call made on a snapshot
that stopped updating eight days ago is a call made on stale facts.

**The dashboard** is the morning read, in four sections you can jump between from the
bar at the top.

**1 Now.** Any health problem first, because everything below depends on the data being
current. Then one line telling you how many calls are worth making, then those calls as
cards. Each card has a **How we know** link. Open it and you get the actual trail: the
req that closed, the date it was last seen, the rule its title matched, why the call-on
date is 35 days out, and the two snapshot files it was read from. Nothing on this page
asserts anything you cannot trace back to a row.

**2 Soon.** The call-on queue. What is overdue, due today, and coming up.

**3 Where to dig.** The territory split, then every account on a rival ATS, graded A to
D. Filter by grade, by "hiring a talent lead", "mostly stuck" or "over 100 reqs". Sort by
grade, open reqs or stuck count.

Click a company and you get the recommendation: the grade with its two axes, why them,
why now, what to lead with and the reason that angle fits their board, a paste-ready
opener built from their own numbers, the question that opens the conversation, a
comparable company in your territory already on Greenhouse worth naming, and the thing
not to say about their current ATS. Under that sits the 30-point pain scorecard and their
three longest-open roles, which is what you actually quote.

**Check the badge before you dial.** Every account says whether it is new business or an
existing Greenhouse customer. The day this was built, three of the four top signals were
at customers. Calling one of those to pitch Greenhouse is the mistake this badge exists
to stop.

The chart in each row is every open role at that company as one tick, placed by how many
days it has been open, with the 60-day line marked. Hover any tick for the role and its
age. A wall of ticks to the right of the line is a company that cannot fill what it
posts.

**4 How this works.** Six steps, collapsed: collect, detect, snapshot, compare, rank, and
what this cannot tell you. Each one explains itself using this morning's real numbers, so
it is a description of what just happened rather than documentation that drifts. Read it
once in week one and you will be able to defend any number on the page.

Work priority 10 and 9 first. They expire.

| Priority | What it means | What you do |
|--:|---|---|
| 10 | A senior talent req closed. They hired someone to run recruiting. | The report gives you a call-on date 35 days out. That lands in week two of the new person's job, while they are still writing down what is broken. Put it in your calendar. |
| 9 | They changed ATS. | Either they just left a competitor, or they are mid-evaluation. Call this week. |
| 8 | A talent leader req is open. | The buyer is being hired right now. Worth a note to whoever owns it today. |
| 7 | A req closed and came back. | They cannot fill it. That is a sourcing problem, which is a product conversation. |
| 6 | Hiring is accelerating. | Their process is about to stop scaling. |
| 5 | Two or more new recruiter reqs. | The TA team is growing, so budget exists. |
| 4 | A board appeared where there was none. | They started hiring properly. |
| 3 | The board emptied. | Freeze or cleanup. Know this before you call so you do not open with the wrong premise. |

The collection itself runs on its own at 06:30, so option 1 is just reading. Option 7
forces a fresh collection if you want one mid-day, and takes about a minute.

---

## The call-on queue

The highest-priority signal in the system is a talent leader req closing, and its whole
value is a date 35 days out. That is when the new person is two weeks into the job and
still writing down what is broken. Before, the date got written into a markdown file
that nobody opens 35 days later, so the best signal the radar produces quietly expired.

Now every dated signal lands in a queue, and option 1 shows you what is due:

```
OVERDUE (2). The window is closing, not closed.

  aa1111  Notion             14d late  "Head of Talent" closed
  bb2222  Plaid              2d late   "Director, Recruiting" closed

CALL TODAY (1)

  cc3333  Vanta              today     "VP People" closed
```

After you call someone, clear them. The morning flow asks once, right under the list, or
you can run `npm run queue -- done aa1111`. Use `skip` instead of `done` for the ones
that turn out not to be worth it. Nothing is deleted, both are logged as events, so
`learn` can eventually tell you whether 35 days is the right delay.

---

## The five minutes after you book a meeting

**Menu option 2.** It asks eight questions once and then does three things.

Company (a name like `Ramp` works as well as `ramp.com`), contact, their title, the
meeting time, which AE is joining, why you called, what they said, and the meeting date.

Then:

**The show-rate pack.** Three messages, one to send within ten minutes of booking, one
the day before, one two hours out, plus a one-page summary of their hiring built from
their own public job board. The first message lands on your clipboard automatically, so
paste it into Gmail and send it before you do anything else. A personal confirmation
instead of a bare calendar invite is the single biggest thing you can do about no-shows.

**The AE handoff brief.** One page: who they are, why now, what they told you, what their
board looks like from outside, and four questions worth asking. Paste it to the AE the
same day, for every meeting, including the ones you think are obvious. AEs talk about
which SDR makes their life easier, and that conversation is how territory gets assigned.

**The ledger entry.** You get a short id back. That is how you update the meeting later.

---

## After the meeting happens, or does not

**Menu option 3.** It shows your open meetings, you give it the short id and one of four
words.

- `held` means they showed up
- `noshow` means they did not
- `advanced` means the AE moved it to Develop, which is the event your pay is based on
- `closed` means it became revenue

Do this the same day. The ledger is a record, and a record you fill in on Friday for the
whole week is not much of a record. Nothing is ever overwritten: corrections are logged
as their own events, so the history stays intact and the timestamps mean something.

---

## Before every payroll date

**Menu option 4.** It prints your attainment, your show rate, how many meetings the AEs
accepted, and what the commission agreement says you earned. The arithmetic follows
Sections II, III and IV of the 2026 Individual Commission Agreement, including the
70% floor, the 150/175/200% accelerator bands, and the contract bonus with its caps.

Compare it against Salesforce. You will probably never need this. The month the numbers
disagree, you want a dated record that you did not write after the fact.

---

## Once a month, from December

**Menu option 6.** It replays your snapshot history against your ledger and tells you
which signals actually converted, whether 35 days is the right delay to call a new talent
leader, and where your funnel leaks.

It refuses to print a percentage computed on fewer than five opportunities, so it will
have nothing useful to say until late November. That is correct behavior, not a bug.

---

## What each tool is for

Your pay runs through a chain, and a meeting only counts at the end of it. You book it,
they attend, the AE advances it. Most SDR tooling attacks the first link. Two of these
attack the other two, which is where meetings actually die.

| Tool | The link it moves |
|---|---|
| Radar (1, 7) | Gives you a reason to call that is true today, instead of a list sorted by company size |
| Show-rate pack (2) | They attend |
| AE handoff (2) | The AE advances it |
| Ledger (2, 3, 4) | You can prove all of the above |
| Ingest (5) | Turns a Salesforce export into a target list in one step |
| Loop closing (6) | Tells you which signals were worth the time |

The radar is worth running yourself for one reason: vendors sell you a snapshot of who
runs what, and that is already stale by 90 days for mid-market records. "You are on
Lever" is a technographic. "You closed your Head of Talent req three weeks ago and
reposted two engineering roles" is a reason to call. Change only exists if something was
collecting yesterday, which is why the 06:30 job matters more than any single run.

---

## When something looks wrong

**A company you know is a customer shows up as unresolved.**
The six adapters cover Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee.
Workday, iCIMS and custom career pages are invisible to this. So is any company whose
board token cannot be guessed from their name or domain, which is more common than it
sounds: Front serves its Ashby board as `frontcareers`.

You can fix that case by hand, once, permanently. Open their careers page, click through
to any job, and look at the URL you land on. If it contains `jobs.ashbyhq.com/something`
or `boards.greenhouse.io/something`, that last part is the token. Add it to
`config/targets.csv` as two extra columns:

```
front.com,Front,ashby,frontcareers
```

A pinned account skips detection entirely and never expires, so it cannot drift back to
unresolved. It also stays quiet in the diff the morning you add it: taking manual control
changes what you know, not what they run, and a call opening with "I see you just moved
off Workable" when they did not is a call that ends early.

Ten of the 65 seed companies are still unresolved. For most of them the careers page
proxies everything server side and there is no token to find. Unresolved is an honest
answer, not a failure.

**The report shows fewer accounts than yesterday.**
A network hiccup during collection drops that account from the day's snapshot. The
snapshot records it under `errors`. Run option 7 again and it will almost always come
back. Do this the same day if you can: an account missing from one day's snapshot will
look like a brand new board when it returns, which is a false priority 4.

**The overnight job did not run.**
Check it with this, in a terminal:

```bash
schtasks /query /tn ats-radar-daily /v /fo LIST
```

`Last Result: 0` is a clean run. Anything else is worth a look, and `2147946720` in
particular means Windows refused to start it. Run it by hand with:

```bash
schtasks /run /tn ats-radar-daily
```

**Never delete anything in `data/snapshots/`.** The change signals only exist because
yesterday's file is still there. Those files are the asset. The daily job pushes them to
the private GitHub repo every morning, which is both your backup and the dated record
that makes the build date on the Prior Inventions page verifiable by someone other than
you.

---

## Two rules that do not bend

**Nothing from Greenhouse comes into this folder.** Public job boards in, ranked list
out. No Salesforce exports of customer records, no internal data, ever. CIIA 1.1 says
company information cannot be retained for personal use, and CIIA 9 lets them inspect a
personal machine that holds company data. Keep this reading public APIs and that exposure
never exists. A territory list of company names and domains is fine. A customer list is
not.

**Nothing here sends.** Every tool writes text and stops. Sending from the company domain
through anything unapproved is an IT and deliverability problem you do not want to own in
month one, and Outreach or Salesloft will exist anyway.

---

## The honest warning

These tools are maybe a fifth of what makes an SDR good. The rest is call volume, talk
tracks, and hearing the same six objections until answering them is reflex. The failure
mode for someone who builds things is that building feels productive right up until the
month closes short.

Ten minutes in the morning and five minutes after each booking. If you are in here longer
than that on a weekday, you are avoiding the phone.

---

## A note on the repost signal

A repost is supposed to mean they closed a req and posted it again, which means they
cannot fill it, which is the structured-hiring conversation. Matching those used to trust
the requisition id the ATS hands out, and that id is not reliably unique. Greenhouse gives
Stripe the literal string `See Opening ID` for all 651 of their reqs, and Brex reuses one
id across every location a role is open in. On the 8 September to 16 September diff that
produced 114 Stripe "reposts" out of 193 events.

An id now only counts when it identifies exactly one req on each side of the comparison,
falling back to an exact title match under the same rule. The same diff now reports 58
events, 6 of them at Stripe. If a repost shows up in your morning list, it is real enough
to open a call with.
