# Reproduce the two-session Realtime check

This check exercises the actual browser subscription and UI, not just two server
reads. `npm run test:race` proves database contention and authorized snapshot
convergence; it does **not** prove that WebSocket events reached either browser.
Previous live-browser QA observed all three demo sessions connected and claim,
release, completion, and handoff updates arriving without reloading. Screenshots
are local evidence, not a substitute for repeating this check.

## Setup

1. Run the current app (`npm run dev`) against a provisioned Appwrite project.
   For the existing fictional demo, enable its explicitly scoped demo login and
   set `ONEDOSE_DEMO_ORIGIN` to the exact local origin. Never run reset or seed to
   perform this check. A judge may also use the deployed app when available.
   Start a fresh server for the current build and confirm its JavaScript/CSS load
   successfully. Restart an old `next start` instance after rebuilding; missing
   static assets can invalidate UI checks even if the HTML renders.
2. Use **two separate browser profiles or different browsers**. Two ordinary tabs
   share cookies and are not two independent caregiver sessions.
3. Sign in as Sarah in A and James in B using the named demo buttons. Confirm the
   visible caregiver names differ. Both pages must display **Live updates**.
4. In A, create a new temporary action for Margaret, with a recognizable title
   such as `Judge Realtime check HH:MM`, active today and scheduled a few minutes
   before the current Asia/Dubai time (use the current minute just after midnight).
   Do not edit an original seeded action.
5. Confirm the new action appears in B without reloading or pressing Retry.

For release QA that must not alter public demo data, use the same observations in
an isolated synthetic circle with two temporary Auth users and confirmed Team
memberships. Replace Sarah/James with those users' names. Remove only that test
circle's resources afterward; never reuse or reset the public demo as a fixture.

## Observe

Keep both pages open, side by side. Do not reload either page during these steps.

| Action | Required observation in the other browser |
| --- | --- |
| A claims the temporary action | B displays Sarah's name and claim time. |
| A releases it | B becomes able to claim it. |
| B claims it | A displays James's name and claim time. |
| B records an outcome with a unique note | A shows the recorded outcome and a matching handoff event. |
| B adds a legitimate correction | A shows the correction while the earlier event remains in history. |

For clearer evidence, observe changes within **10 seconds**. The dashboard's
fallback timer can refresh after up to 60 seconds, so an update seen only after
that interval is not sufficient evidence of Realtime delivery. In browser developer
tools, optionally inspect the Appwrite WebSocket: a message for the matching row
must precede the authorized `/api/circle/snapshot` request and visible update.
Do not copy JWTs, session cookies, or credential-bearing WebSocket URLs into reports.

A losing-click conflict requires both caregivers to act before the winner's
update disables the other claim button. It is normal for fast Realtime delivery
to prevent the second click. Do not disable Realtime to claim that Realtime was
verified. The separate race test provides deterministic concurrency evidence.

## Record evidence and finish

Record the tested commit, origin, timestamp/timezone, browser profiles, visible
caregiver names, temporary action title, connection indicators, approximate update
latencies, and pass/fail for each observation. Screenshots or a short recording
should show both profiles and their different identities. Report failures rather
than treating manual refresh as success.

Archive the temporary schedule through the app when finished. This preserves its
outcome/correction history by design. Sign out of both profiles; do not delete
original records or reset the demo. This manual check intentionally creates its
own visible demo activity; it is not part of the automated fixture-only suites.

## Release verification — 31 October 2026

The procedure was exercised locally on a fresh production-build instance using
two independent browser contexts and an isolated synthetic circle. No public demo
accounts or records were used or changed. Creation used an authenticated API request;
claim, release, completion, and correction actions used the actual browser UI.

| Observed update in the other browser | Time to visible update |
| --- | ---: |
| Owner claim and attribution | 4.561 s |
| Release made task claimable | 5.522 s |
| Caregiver claim and attribution | 6.402 s |
| Completion | 7.778 s |
| Correction and appended handoff | 6.054 s |

For every measured update, a matching row WebSocket frame preceded the snapshot
request and UI observation. Neither page was reloaded; this was not inferred from
the race test or the fallback polling interval. The two audit events remained
present after correction. The isolated fixture was removed afterward, and the
public demo matched its pre-check baseline.

An earlier attempt against an old local server verified the first four updates
but could not finish correction because its CSS request returned HTTP 500 and the
modal could not close. That incomplete attempt is not counted as a full pass.
The complete five-step pass above used the freshly started current build.
