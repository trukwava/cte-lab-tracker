# Publishing Riverton CTE Lab Tracker on GitHub

**Proposed public repository:** `https://github.com/trukwava/cte-lab-tracker`

This repo has **not yet been created**. The connected GitHub integration was able to inspect accessible repositories but did not offer repository creation. The archive is therefore ready for the owner to publish, with no claim that it is already on GitHub.

## Publish with GitHub CLI (recommended)

1. Install [GitHub CLI](https://cli.github.com/) and authenticate (`gh auth login`).
2. From this extracted project directory, run:

   ```bash
   git init -b main
   git add .
   git commit -m "Initial working CTE lab tracker demo"
   gh repo create trukwava/cte-lab-tracker --public --source=. --remote=origin --push
   ```

Git must have your normal author identity configured for the initial commit. The repository name may be adjusted if already taken. If the command reports that the repository exists, inspect it before adding a remote; do not overwrite any prior work.

## Publish using GitHub's website

1. Visit https://github.com/new, set owner to **trukwava**, name to **cte-lab-tracker**, visibility to **Public**, and create an **empty** repository (do not add a generated README).
2. Follow the GitHub setup instructions for **push an existing repository** after running `git init`, `git add .`, and `git commit -m "Initial working CTE lab tracker demo"` locally.

## Pre-publication boundaries

- All fixture records are fictional; **do not commit** `data/*.sqlite`, API keys, real school rosters, student data, or generated database WAL files.
- `.gitignore` excludes generated SQLite records and dependency directories. The published archive deliberately contains `data/.gitkeep` but no SQLite database.
- The role-selector sign-in is demonstrative and **not secure production authentication**. Do not deploy this version publicly to accept real user data.
- A public GitHub repository is **not** an authorization to deploy or claim that purchasing or safety approvals are automated.
- No software license is included; decide licensing terms separately if you want third-party reuse.

On GitHub, the included Actions workflow will run the domain acceptance suite and TypeScript check on pushes and pull requests. This workflow file is included but has not been tested in GitHub Actions yet.
