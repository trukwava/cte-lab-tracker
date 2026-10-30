# GitHub repository and local setup

The source repository is **public** at <https://github.com/trukwava/cte-lab-tracker>.
This is a public **source-code repository**, not a publicly deployed application.

To work with it locally:

```bash
git clone https://github.com/trukwava/cte-lab-tracker.git
cd cte-lab-tracker
npm test
npm start
```

Open <http://127.0.0.1:4173> on the same computer. Node.js 22.13+ is required.
The demo uses fictional borrower identifiers, locally stored SQLite records, and
selectable roles. The server refuses non-loopback binds; do not expose it via
a tunnel or reverse proxy.

Keep `data/*.sqlite*`, production data, credentials and real rosters out of Git.
GitHub Actions is configured to run `npm test` and a TypeScript check on pushes
and pull requests. Review Actions results for each new commit. See
`docs/DEPLOYMENT_GATES.md` for requirements before any hosted pilot.

No third-party software license has been assigned yet. Public source visibility
by itself does not grant a license to redistribute or relicense the code.
