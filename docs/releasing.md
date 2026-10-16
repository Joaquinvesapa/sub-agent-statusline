# Releasing

Stable publication is explicit and tag-gated. Merging ordinary changes to `main` or `v1` runs CI but never publishes to npm.

## Release Lines

The package has two release lines. The line is derived from the tag's major version; it is never chosen by hand.

| Tag | Source branch | npm dist-tag | GitHub Release | Supports | Policy |
| --- | --- | --- | --- | --- | --- |
| `v2.x.y` and later | `main` | `latest` | Marked as Latest | OpenCode 2 | Features and fixes |
| `v1.x.y` | `v1` | `legacy` | Not marked as Latest | OpenCode 1 | Critical fixes only (security, load failures) |
| `v0.x.y` | — | — | — | — | Refused |

Both lines are published by the same workflow, `.github/workflows/release.yml`. A 1.x tag can never publish under `latest`, and a 2.x tag can never publish under `legacy`, because the npm dist-tag and the required source branch come from the same major-version mapping.

> **Keep the workflows identical on `main` and `v1`.** A tag push runs the workflow file from the tagged commit, not from `main`. Any change to `.github/workflows/release.yml` or `.github/workflows/ci.yml` must land on both branches through twin PRs. Verify with `git diff origin/main origin/v1 -- .github` (expect no output).

## Quick Path: 2.x (`main`)

1. Invoke the project release skill with execution intent, such as `prepare a release`.
2. Confirm the recommended major, minor, or patch category. The skill calculates the exact version and prepares a release PR on a branch.
3. Merge the reviewed release PR into `main` through the repository's normal PR protections.
4. After push CI succeeds for the merged SHA, give one immediate approval whose effect is explicit: creating and pushing annotated `vX.Y.Z` for that exact SHA will trigger automated npm publication under `latest` and GitHub Release creation.
5. Do not give a second post-tag publication approval. Confirm the workflow reports the exact npm package and GitHub Release evidence.

## Quick Path: 1.x legacy (`v1`)

1. Create the fix branch from `v1`, not from `main`, and open the PR **against `v1`**:

   ```sh
   git fetch origin
   git switch -c fix/v1-<topic> origin/v1
   ```

2. In the same PR, bump `package.json` to the next 1.x patch (for example `1.3.1` → `1.3.2`) and update the pinned version in the `v1` README.
3. Merge the PR into `v1` and wait for push CI on `v1` to succeed for the merged SHA.
4. Tag that exact SHA and push the tag:

   ```sh
   git fetch origin
   git tag -a v1.3.2 origin/v1 -m "v1.3.2 (OpenCode 1 legacy)"
   git push origin v1.3.2
   ```

5. The workflow publishes under `legacy` and creates a GitHub Release that is not marked as Latest. Confirm the result:

   ```sh
   npm view opencode-subagent-statusline dist-tags
   # latest must still be 2.x; legacy must be the new 1.x version
   ```

6. On `main`, update the pinned 1.x version in the README install table.

Do not publish 1.x manually with `npm publish`. Without `--tag legacy`, npm moves `latest` to the 1.x build and every unpinned OpenCode 2 user receives a plugin that does not load.

## Release Gates

| Gate | Required evidence |
| --- | --- |
| Version | Stable tag format, a supported major version, and exact equality with committed `package.json` version |
| Candidate | Annotated tag targets the current SHA of the line's source branch (`origin/main` or `origin/v1`); a stale tag fails closed |
| CI | A completed successful push run of `.github/workflows/ci.yml` on the line's source branch for that exact SHA |
| GitHub Release state | Before npm publication, the API must prove the release is absent or is an existing non-draft, non-prerelease release whose tag and target SHA exactly match the candidate; unknown or conflicting state fails closed |
| Package | After preflight, the workflow publishes the exact `pnpm pack` tarball with the existing `NPM_TOKEN`, provenance enabled, and the line's npm dist-tag |
| Recovery | An existing npm version is accepted only when its registry integrity matches the exact local tarball; existing tags and incompatible GitHub Releases are never moved or mutated |
| Release notes | After npm publication or identity-matching npm recovery, notes are created only when preflight proved the GitHub Release absent; compatible existing releases are skipped and then verified |

The stale-tag policy is intentionally strict: the tag target must equal the source branch HEAD when the release workflow starts. If the branch advances, create a new tag only after CI succeeds for the new candidate; never retarget a tag that has published to npm.

## Testing the Preflight Without Publishing

The preflight step only reads GitHub and npm; publication is a separate step. To check routing and gates locally, extract the `preflight` step's `run` script from `release.yml`, check out the tag in a scratch clone, and run it with the workflow environment:

```sh
export GITHUB_REF_NAME=v2.0.0 GITHUB_REPOSITORY=Joaquinvesapa/sub-agent-statusline
export RUNNER_TEMP=/tmp/release-dry GITHUB_OUTPUT=/tmp/release-dry/out GH_TOKEN="$(gh auth token)"
pnpm install --frozen-lockfile --ignore-scripts
bash /path/to/extracted-preflight.sh
```

Inspect `release_branch`, `dist_tag`, and `npm_state` in `$GITHUB_OUTPUT`. Never run the publish step locally.

## Recovery

Rerunning an unchanged tag is safe only when all identity checks pass before npm publication. A matching npm integrity with an absent GitHub Release can continue to release-note creation. An existing compatible stable GitHub Release is skipped and verified. Any mismatched integrity, draft or prerelease release, target-SHA mismatch, moved tag, stale candidate, or unknown registry/API error stops before npm publication.

If a build is ever published under the wrong dist-tag, restore the tags explicitly:

```sh
npm dist-tag add opencode-subagent-statusline@<2.x version> latest
npm dist-tag add opencode-subagent-statusline@<1.x version> legacy
```

## History

- `1.3.1` was published manually under `legacy` while the workflow could only publish from `main`; its npm tarball was built locally, so a workflow rerun of `v1.3.1` stops at the integrity check by design.
- `2.0.0` was the first release published by this workflow.
