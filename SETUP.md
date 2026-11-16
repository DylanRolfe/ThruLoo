# Setup task (do this only, do not start building the app)

This folder will hold a 3D web app of the University of Waterloo campus. A separate brief (`BRIEF.md`) describes the app, and a different model will build it in a later session. Your job is only to prepare the folder and tooling so that session can start cleanly. Do not scaffold the app, install npm packages, or write any app code.

Run these steps from the shell, in order. If a step fails, diagnose it and try a reasonable fix once, then move on and report it at the end.

1. **Git.** If this folder is not already a git repo, run `git init`. Create a `.gitignore` with `node_modules/`, `dist/`, `.env`, `.env.*`, `*.log`, `.DS_Store`, and `test-results/`.

2. **Plugins.** Install these at user scope using the `claude` CLI (not slash commands):
   ```
   claude plugin marketplace add anthropics/claude-plugins-official
   claude plugin install playwright@claude-plugins-official
   claude plugin install context7@claude-plugins-official
   claude plugin install frontend-design@claude-plugins-official
   ```
   If the CLI asks for a scope, choose user. If a plugin is already installed, leave it. Afterwards run `claude plugin list` (or the closest equivalent) and confirm all three are listed.

3. **Project settings.** Create `.claude/settings.json` so subagents run on Sonnet:
   ```json
   {
     "env": {
       "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet"
     }
   }
   ```
   If the file already exists, merge this in without removing anything.

4. **Brief check.** Confirm `BRIEF.md` exists in this folder. Do not edit it. If it's missing, say so clearly in your report.

5. **Environment check.** Report the versions of `node`, `npm`, and `git`. The app needs Node 20 or newer. If Node is missing or older, tell me how to install or upgrade it on my OS, but don't install it yourself.

6. **Commit.** Stage `.gitignore`, `.claude/settings.json`, and `BRIEF.md` (if present) and commit with the message `Project setup: plugins, subagent model, brief`.

## Report

Finish with a short checklist: each step, done or not, and anything I need to fix myself. Then tell me the exact next steps: quit Claude Code with `/exit`, start it again with `claude` so the plugins load, run `/model fable`, and send "Read BRIEF.md and start."
