<p align="center">
  <img src="https://cdn.hashnode.com/uploads/covers/61c1cdd863117d1a228901dd/70f59623-6e9d-441f-9074-5bd56b409302.png" alt="One Row. Two Winners." />
</p>

# One Row. Two Winners. The Concurrency Bug That Fooled My Tests

*25 requests. One database row. Two successful claims. Wait, what?*

Ever built something, tested it, watched every test pass, and thought, *yep, this is solid*?

Yeah. Same here.

Until I discovered that my database could contain **one claim**, while **two different users were both told they'd successfully claimed it**.

And somehow, that wasn't even the worst part. 😭

Let me explain how I got here.

## It started with OneDose 💊

Recently, I've been building [OneDose](https://github.com/Omar8345/onedose), a care coordination app for families and caregivers.

The idea is pretty simple.

Imagine three people helping someone with their medication routine.

Sarah thinks James already handled the morning medication. James thinks Sarah is doing it. Emily has absolutely no idea what's happening.

Everyone wants to help, but nobody knows who's responsible.

That's exactly the kind of confusion I wanted OneDose to solve.

Caregivers can see what's due, claim responsibility for an action, record what happened, and check a shared history.

But there was one feature I really cared about.

**If two caregivers try to claim the same action, only one should win.**

Sounds reasonable, right?

<p align="center">
  <img src="https://raw.githubusercontent.com/Omar8345/onedose/main/public/onedose-hero.png" alt="OneDose — Shared care. One clear record." />
</p>

*OneDose — Shared care. One clear record.*

## 25 requests. One winner. Easy win? 😎

To make sure the claim system actually worked, I started testing it against Appwrite TablesDB.

Not mocked responses. Not fake database calls.

Real requests, real transactions, real contention.

I fired **25 competing claim requests** at the same occurrence.

The result?

**1 accepted. 24 rejected.**

Nice.

I tried concurrent completions too.

Again, one winner. One completion event. One receipt.

No duplicated history.

At this point, everything looked pretty good. I was using deterministic record IDs, transactions, and idempotency receipts to protect the important operations.

I thought I'd covered the tricky part.

*Spoiler: I hadn't.*

<p align="center">
  <img src="https://media.giphy.com/media/Hk2o5d4JBqzUAe4BG2/giphy.gif" alt="Everything is fine... right?" />
</p>

## Then someone asked the annoying question

Here's something I hadn't properly stress-tested:

**What happens when a claim expires, and 25 people try to take it over?**

OneDose supports temporary responsibility claims. If someone claims an action but doesn't finish it, the claim can eventually expire, allowing another caregiver to take over.

The normal claim race was already tested.

But an *expired-claim takeover* follows a different path.

So I ran another test with 25 distinct synthetic caregivers.

Then I made it nastier.

Instead of simply sending requests simultaneously, I deliberately paused operations after they read the existing claim and resumed them with small delays.

And that's when I got this:

| Result | Requests |
| --- | --: |
| Successfully claimed | **2** |
| Conflicts | 23 |

Hold on.

**TWO winners?**

I checked the database.

There was only **one claim row**.

Both transactions had committed. Both callers were told they had claimed the occurrence.

Yet the final database state showed just one holder.

That was the moment I realized something important.

**Having one final row is not the same as having one successful operation.**

## How did two transactions both win?

The issue was an old-fashioned concurrency problem hiding behind a perfectly normal-looking database state.

Two requests could read the same earlier occurrence version.

Both would then make decisions based on that version.

When taking over an expired claim, the implementation deleted and recreated the deterministic claim row. It also wrote a new occurrence version calculated from the value it had already read.

So, in the failing test, both transactions started from version `1`.

Both attempted to move it to `2`.

And both committed.

The final version was `2`, not `3`.

The database's unique row identity ensured that only one claim row remained, but it didn't establish that only one takeover transaction could succeed over time.

That distinction mattered.

Because OneDose wasn't just supposed to have a tidy database.

It was supposed to give caregivers a trustworthy answer to:

*Who's responsible right now?*

## And then I found something worse 😭

I wanted to know whether a caregiver could complete an action after losing their claim.

Here's the scenario.

Sarah holds a valid claim and starts recording a completion.

Her operation reads the claim.

Then I pause it.

Meanwhile, James successfully takes over the expired claim.

Now Sarah's operation resumes.

Surely it should fail, right?

Well...

**It committed.**

The completion event and receipt were written under Sarah, even though James had taken responsibility before that completion committed.

This wasn't a duplicate-completion bug. The uniqueness protection against duplicate completion history was still doing its job.

It was a different problem.

**A former holder could act on an outdated decision.**

For a collaborative care app, that's a much more important distinction than it might seem at first.

## The first fix looked promising 🔧

I needed a way to stop a transaction from committing if the occurrence had changed since it made its decision.

So I experimented with Appwrite's atomic numeric operations.

An ordinary version increment wasn't enough. In testing, two stale transactions could still increment successfully.

The useful difference came from a **bounded atomic increment**.

The transaction would attempt to increment the observed version, but with a maximum tied to that observation.

If another transaction had already advanced the value, the stale operation would exceed its allowed bound and fail.

I tested it under the same delayed takeover scenarios.

This time, the reproduced races returned one winner.

The stale-holder completion was rejected too.

*Finally. Fixed.*

Or so I thought.

<p align="center">
  <img src="https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExeGs0eXY1dHI5NWtuYzJwNTFocmZtemFybjNrMTAxeXQ1amVkZmdhYSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/qgkrtsDy4MhLq/giphy.gif" alt="Wait, there's another bug?" />
</p>

## The bug came back through a completely different door

There was another piece of OneDose I hadn't considered.

**Schedule editing.**

When a schedule changes, some pending occurrences can be deleted and regenerated.

The new occurrence can end up with the same deterministic ID as the old one.

But its version starts again at `0`.

And that's a problem if you're using that version as your concurrency fence.

Imagine an operation reads version `1` and pauses.

Then a schedule edit deletes the occurrence.

Later, the occurrence is recreated with the same ID, but version `0`.

The paused operation resumes.

Its version bound was calculated against the old version.

And because the new version is lower, the bound may no longer detect that the record belongs to a completely different lifecycle.

I tested this using OneDose's actual schedule functions.

Before the fix, a completion could commit across deletion and recreation.

After identifying that problem, I realized the occurrence itself couldn't be the only place holding the fencing state.

**If a record can disappear, its protection needs to survive its disappearance.**

## Giving the fence its own memory

The next change was a separate, durable `occurrence_fences` table in Appwrite.

Instead of depending entirely on the occurrence's version, the app keeps a counter that survives occurrence deletion and recreation.

Transactions advance this counter together with their other writes.

Schedule lifecycle changes also advance it when they invalidate an occurrence.

The occurrence can be removed.

It can be recreated.

But an old transaction shouldn't be able to pretend nothing changed in between.

I repeated the previously failing lifecycle scenarios.

This time:

- A paused completion across same-ID recreation was rejected.
- A paused claim couldn't commit against the recreated occurrence.
- A completion racing concurrent schedule edits was rejected when its earlier decision became stale.
- Fresh-generation completions still worked.
- Previously completed history remained intact.

And the most satisfying result?

**Zero stale completion events or receipts in those corrected lifecycle rounds.**

Now *that* was the result I wanted to see.

## Did everything pass afterward? 🎉

After finding two concurrency bugs, breaking my own fixes, and questioning whether I understood transactions anymore, I finally had some good news.

**All 13 release verification checks passed.**

And I wasn't just running a couple of happy-path tests.

The final verification included:

- **25-way expired-claim races:** one winner, every time.
- **Stale-holder completions:** rejected.
- **Occurrence deletion and recreation:** old transactions couldn't sneak through.
- **Lost HTTP responses:** identical retries recovered the original result without duplicate events.
- **All nine original integration suites:** passed.

The fresh infrastructure diagnostic also completed **671 HTTP requests and 86 transactions**, without a single 5xx or network error.

Remember those annoying Appwrite `503 general_cache_unavailable` errors that kept interrupting my tests?

They didn't reappear in the final verification run. Their underlying cause remains unknown, but the important thing is that I finally got an uninterrupted run against the real Appwrite backend.

And yes, the fictional caregivers in my demo survived all this testing untouched. 😭

*I think I've earned the right to close a few terminal windows now.*

### Update: the worker needed a fence too

A later review found another race: a reminder worker could read a daily schedule, pause while someone changed it to a future-only schedule, then resume and create an occurrence that was no longer supposed to exist.

The occurrence fence protected transitions on an occurrence. It didn’t, by itself, protect the decision to create one.

Both the app and reminder worker now coordinate creation through a permanent schedule counter in the same private fence table. Schedule changes advance that counter too, so a stale materializer cannot commit across an invalidating edit.

I also reproduced an editor changing an occurrence’s timing after a completion won the race. Schedule edits now commit the parent and pending-occurrence changes atomically, with occurrence fencing protecting completed history.

The subsequent serial verification passed 20/20 checks. In the new tests, 25 simultaneous app/worker creators produced one occurrence, and paused stale materializers committed no invalid creations.

A supplemental recheck did encounter a network timeout during cleanup. Authoritative read-back found no remaining synthetic resources; after health checks, fresh schedule, reminder, and recipient runs passed. That infrastructure failure remains recorded separately.

## What this taught me

I started this thinking I'd already solved OneDose's concurrency problem.

My tests showed one winner under 25 simultaneous requests.

And that was true — **for the scenario I had tested**.

What I hadn't tested was what happened when old operations resumed after ownership changes, or when the underlying occurrence disappeared and came back.

A few things stuck with me.

**A correct final database state doesn't prove every response was correct.**

**Sending a lot of requests at once isn't the same as testing the worst possible order of operations.**

And perhaps the biggest one:

**A version number isn't automatically a reliable concurrency fence. Especially when the thing you're versioning can be deleted and recreated.**

The funny part is that none of these issues showed up in the original happy-path tests.

They appeared when I stopped asking *“does this work?”* and started asking:

*“What happens if this operation pauses at exactly the wrong moment?”*

## One last thing 👀

If you're building anything that depends on one user, worker, or process being the authoritative owner of something, try testing what happens when ownership changes **between the read and the commit**.

Then test what happens when the record is deleted and recreated.

You might be surprised by what you find.

I'm still building [OneDose](https://github.com/Omar8345/onedose) with Next.js and Appwrite, and this little debugging adventure has definitely changed how I think about concurrency tests.

Sometimes the interesting bugs aren't the ones that crash your application.

Sometimes the database looks perfect. The tests are green. Everyone thinks they're responsible.

And somehow, you're still wrong. 💀

> [!IMPORTANT]
> **Takeaway**
>
> Don't just test whether your system reaches the correct final state. Test whether every operation that claims success actually deserved to succeed.

*If you've ever encountered a concurrency bug that passed your initial tests, I'd genuinely love to hear how you found it.*

[OneDose on GitHub](https://github.com/Omar8345/onedose) · [Try OneDose](https://onedose.appwrite.network)
