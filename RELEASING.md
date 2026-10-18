# Releasing FetchXML Studio

The npm package `@mohsinonxrm/pptb-fetchxml-studio` is published by CI
(`.github/workflows/release.yml`) when a `v*` tag is pushed. Nobody runs `npm publish`
locally. The same process is used by Command Bar Studio and Dataverse Request Studio.

## Branches

| Branch | Holds | npm |
|---|---|---|
| `main` | The current **stable** release, plus hotfixes | `latest` |
| `dev` | Integration of everything merged; **betas** are tagged here | `beta` |

- Work happens on branches cut from `dev`, merged into `dev` by PR (squash is fine).
- `dev → main` and `main → dev` merges always use a **merge commit**, so the branches
  keep the same history.
- CI (`ci.yml`) runs on every PR and on pushes to `dev` and `main`; the `check` status is
  required on both.

## Every PR

- Add your user-facing changes under `## [Unreleased]` in `CHANGELOG.md`, and update the
  README's feature docs if behaviour changes.
- Don't change the version: it's set when a release is cut. That keeps PRs independent,
  so they can merge in any order.

## Cutting a beta (from `dev`)

1. On a branch from `dev`: `npm version 1.5.0-beta.1 --no-git-tag-version`, rename
   `## [Unreleased]` to `## [1.5.0-beta.1] - YYYY-MM-DD` (add a new empty
   `## [Unreleased]` above it), and update the README version badge. Merge the PR into
   `dev`.
2. Tag that commit on `dev`: `git switch dev && git pull && git tag v1.5.0-beta.1 && git push origin v1.5.0-beta.1`.

The tag's pre-release part sends it to the npm `beta` tag as a GitHub pre-release;
`latest` doesn't change. The build bundles the gold Insider icon for pre-releases.

## Milestones and tracking

- Each stable release has a milestone (`v1.5.0`). Its closed issues are the list of what
  the release contains, so close issues as they're done; that doesn't lose track of them.
- What each beta contains is its `[X.Y.Z-beta.N]` CHANGELOG section and its GitHub
  pre-release notes.
- A **"Release X.Y.Z" tracking issue** in the milestone holds the promotion checklist
  below. The milestone closes when the stable release ships.

## Stabilizing (beta → stable)

Once the release's scope is in `dev`, stabilize before promoting a beta to `latest`:

1. **Feature freeze on `dev`:** only fixes merge until the stable release ships. Work for
   the next release waits as **draft PRs**, because anything merged into `dev` ships with
   this release.
2. **Milestone clear:** every issue in the milestone is closed or moved.
3. **Smoke test** the latest beta, installed from npm, in the PPTB version the tool
   targets (`minAPI`). Run the manual checks the tracking issue lists.
4. **Soak:** 7 days with no new P0/P1 bug against the latest beta. Each fix ships as a
   new `beta.N`, and the clock restarts.
5. **Health:** CI green on `dev`; `npm audit --omit=dev --audit-level=high` reports 0.

Then cut the stable release below, and mark the next release's draft PRs as ready.

## Cutting a stable release (from `main`)

1. Same as a beta, with the stable version (`npm version 1.5.0 --no-git-tag-version`). For
   the stable section, summarise the betas above their history (see `[1.4.2]`).
2. Open the release PR `dev → main` and merge it with a merge commit.
3. Tag the merge commit on `main`: `git switch main && git pull && git tag v1.5.0 && git push origin v1.5.0`.

`release.yml` refuses a stable tag whose commit isn't on `main`.

## Hotfixes (to the current stable release)

1. Branch `hotfix/1.4.3` from `main`; fix, set the version (`1.4.3`), date its CHANGELOG
   section, update the badge; PR into `main` (merge commit).
2. Tag `v1.4.3` on `main` → npm `latest`.
3. Merge `main` back into `dev` (merge commit) so the fix isn't lost; keep `dev`'s
   version and `[Unreleased]` entries when resolving.

## What `release.yml` does

Checks the tag matches `package.json` (and that stable tags are on `main`), runs the
tests, validation and build, publishes to npm with provenance (`-beta.N` → `beta`,
otherwise `latest`), and creates the GitHub Release (pre-release for betas). Afterwards,
replace the generated release notes with the CHANGELOG section.

## One-time setup

- **npm trusted publisher**: npmjs.com → package → *Settings* → *Trusted publishing* →
  *GitHub Actions*: user `mohsinonxrm`, repository `pptb-mxrm-fetchxml-studio`, workflow
  `release.yml`, no environment, *Allow npm publish*. No npm token is needed.
- `repository.url` in `package.json` must point at this GitHub repository, or provenance
  and trusted publishing fail.
- A ruleset on `dev` and `main` requiring PRs and the `check` status.
