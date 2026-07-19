# Node Status Monitor

Watches `api.mcserverhost.com/status` on a schedule and emails you (via
Formspree) whenever a node flips online <-> offline. Every flip is also
logged to `history.log`.

## How it works

- `.github/workflows/monitor.yml` runs `check-status.js` every 5 minutes
  via GitHub Actions cron.
- `check-status.js` fetches current node status, compares it against
  `state/last-status.json` (last known status per node), and for any node
  whose status changed:
  - appends a line to `history.log`
  - POSTs an alert to your Formspree endpoint
- The workflow commits the updated `state/last-status.json` and
  `history.log` back to the repo after each run, so the next run knows
  what changed.

First run for any node just records its state — it won't send a false
"back online" alert the very first time it sees a node.

## Setup

1. Push this repo to GitHub (public or private, either works — GitHub
   Actions runs on both, though private repos on free plans have a
   monthly Actions minutes cap; this job is cheap, a few seconds per run,
   ~5 min interval is well within free minutes).
2. In the repo: **Settings -> Actions -> General -> Workflow permissions**
   -> set to **"Read and write permissions"**. Required so the workflow
   can commit `state/last-status.json` and `history.log` back.
3. That's it — no secrets needed. The Formspree endpoint
   (`https://formspree.io/f/mkolaaal`) is public-safe; it's not a
   credential, it just accepts submissions. On Formspree's side, make
   sure both `huankimgregoreyonlay@gmail.com` and
   `redgrockyofficial@gmail.com` are added as **linked notification
   emails** on that form (free plan allows up to 2) — Formspree decides
   recipients from the form's own settings, not from anything in this
   script.

## Notes / limits

- Formspree free plan: 50 submissions/month. Each online<->offline flip
  = 1 submission = 1 email round. If a node flaps a lot, you'll burn
  through this fast — worth checking Formspree's dashboard occasionally.
- GitHub Actions `schedule` cron isn't exact-second reliable — under
  GitHub's load, a "*/5" job can lag by a few extra minutes. Treat
  detection as "within several minutes," not real-time.
- To test without waiting: go to the repo's **Actions** tab -> "Node
  Status Monitor" -> **Run workflow** (this works because of the
  `workflow_dispatch` trigger in the yml).
- To force a test alert, you can temporarily edit
  `state/last-status.json` to say a node is `"online"` when it's
  actually `"offline"` (or vice versa) and let the next run "discover"
  the flip. Remember to let it self-correct or revert after testing.
