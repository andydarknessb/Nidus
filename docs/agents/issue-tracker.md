# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `andydarknessb/Nidus`. Use the `gh` CLI for all operations; it infers the repo from `git remote -v`.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file -` with a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --label ready-for-agent --json number,title,body,labels`.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

## Structure

- A spec from `/to-spec` is one issue labelled `spec`. It is outside the triage state machine and closes when its child tickets close.
- Tickets from `/to-tickets` are GitHub sub-issues of their spec and declare their ordering with GitHub's native "blocked by" relationship. The fleet's frontier reads both; a ticket is eligible only when every blocker is closed.
- Each ticket body has `## What to build`, `## Acceptance criteria` (checkboxes) and `## Blocked by`.

## Closing issues from pull requests

Pull requests merge into `master`, the default branch, so `Closes #N` in a PR body closes the ticket natively on merge. Reference the ticket, never the spec.
