One file: infra/clamav/Dockerfile. Delete this COMMIT.md before committing.

Summary line (exactly; release-please reads it):
fix(infra): bump the ClamAV base image digest (scan found fixed high CVEs)

Description:
clamav/clamav:stable moved to a build with the fixes Grype flagged on the 1.1.0 release.

AI-Agent: claude.ai/claude-fable-5.1
Refs: WP-25
