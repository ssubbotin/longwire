# CI

Canonical GitHub Actions workflow: [`ci/github-actions.yml`](../ci/github-actions.yml).

It runs on Node 20 and 22:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

## Enable on GitHub

The initial push could not create `.github/workflows/ci.yml` because the `gh` OAuth token lacked the `workflow` scope.

To enable Actions, either:

```bash
# Option A — re-auth with workflow scope, then push the real path
gh auth refresh -h github.com -s repo,workflow,read:org
mkdir -p .github/workflows
cp ci/github-actions.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "Add GitHub Actions CI"
git push
```

Or in the GitHub UI: **Actions → set up a workflow** and paste the contents of `ci/github-actions.yml`.
