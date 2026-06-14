# Releasing

1. Confirm that CHANGELOG.md is updated (any new changes should go under "Unreleased" at the top).
2. On the master branch, run `bun run release` and follow the prompts.
3. After a new tag is pushed from the above step, the [publish workflow](./.github/workflows/publish.yml) will automatically build & push the Docker image to `ghcr.io/bunkerlab-net/mochi` and create a GitHub release for the tag.
