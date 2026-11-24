---
name: handover
description: End a Subby work session so the next one can pick up cleanly - put new state, decisions and gotchas where they belong (LAUNCH.md, rules, skills, memory) and replace the single handover memory. Use when the user wraps up ("handover", "let's stop here", "end of day", "write it down for next time") or before a /clear with work unfinished; also when a session starts with "pick up", "continue where we left off" or "check the handover".
---

# Handover

One rolling `handover.md` in memory says where the last session stopped. Everything else that's worth keeping goes where it belongs, so the handover stays short and nothing lives only there.

## Ending a session
1. **Repo state.** `git status`, unpushed commits, and whether production runs HEAD (the last `deploy.sh`). Don't commit or push unasked: tell the user what's uncommitted and ask.
2. **Work and decisions → `LAUNCH.md`.** Tick finished tickets, add "Left:" lines and newly found work to the ticket they belong to, and record decisions there with their reason. New work with no ticket gets one in the right section. This is the source of truth for "what's next".
3. **Lasting knowledge → the repo.** A code rule or gotcha goes in `.claude/rules/<area>.md`, a procedure in a skill (`native-build`, `server-ops`, `release`), a project-wide rule in `CLAUDE.md`. Fix any of them that turned out wrong in this session.
4. **Facts outside the repo → memory.** Devices (ids, what's on them, how to treat them): `devices.md`. Server access, accounts, family ids: `production.md`. A preference or correction from the user: its own feedback memory. Update the existing file; don't add a dated copy.
5. **Replace `handover.md`.** Overwrite it; never add `handover-<date>.md`. At most ~25 lines, each something the next session acts on:
   - **Where things stand:** HEAD and whether it's pushed, CI, what production runs, what each device runs, how `android/` is prebuilt (upload key or not).
   - **In flight:** unfinished work, with the exact next step and the files involved.
   - **Unverified:** built but not yet seen on a device or in production.
   - **Waiting on the user:** console steps, decisions, purchases.
   - **Next:** the LAUNCH.md ticket ids.
   No "done today" lists: git log and LAUNCH.md hold those.
6. **Update its line in `MEMORY.md`** (date + the next step), keeping one line per memory.
7. **Tell the user** in a few lines what went where, and list anything uncommitted.

## Picking up
1. Read `handover.md`, then what changed since: `git log --oneline <its HEAD>..HEAD` (another session or the user may have moved on).
2. Check the handover against reality before relying on it: devices with `adb devices` and `xcrun devicectl list devices`, CI for HEAD (see the `release` skill's preflight), and whether production runs what it says.
3. Summarise in a few lines where things stand and the proposed next step from `LAUNCH.md`, then wait for the user.
