One file: infra/clamav/Dockerfile. Delete this COMMIT.md before committing.

Summary line (exactly; release-please reads it):
fix(infra): upgrade Alpine packages in the ClamAV image (scan found fixed high CVEs)

Description:
The newest clamav/clamav:stable still carries Alpine packages with fixed high CVEs; apk upgrade at build time installs the patched ones.

AI-Agent: claude.ai/claude-fable-5.1
Refs: WP-25
