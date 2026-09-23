# Security Policy

Buildr is a monorepo foundation for full-stack TypeScript applications: an API server (`apps/api`), a web app (`apps/web`), and shared/database packages that downstream projects build on. A vulnerability here can propagate into every project built from it, so we treat reports as high priority and ask that you report them privately rather than through a public issue.

## Supported Versions

Buildr does not yet publish tagged releases. Security fixes are made against the latest commit on `main`, and there is no long-term support branch to backport to. If you're running a fork or an older commit, update to the current `main` before relying on any advisory being applicable to your deployment.

## Reporting a Vulnerability

**Do not open a public issue for a security vulnerability.** Report it privately through [GitHub Security Advisories](https://github.com/xcvzmoon/buildr/security/advisories/new). This opens a private channel between you and the maintainers where the report, discussion, and eventual fix stay hidden from the public until a coordinated disclosure is ready.

A useful report includes:

- The component involved (`apps/api`, `apps/web`, `packages/database`, `packages/shared`, build/CI tooling, and so on)
- Steps to reproduce, or a proof of concept
- The impact you believe the issue has, and any conditions required to trigger it
- Any suggested remediation, if you have one

### What to expect

- **Acknowledgment**: within 3 business days of your report.
- **Initial assessment**: within 5 business days, including a severity estimate and whether we can reproduce it.
- **Resolution timeline**: communicated once the issue is triaged, and scaled to severity. We'll keep you updated as the fix progresses.
- **Credit**: with your permission, we'll credit you in the published advisory once a fix ships.

We ask that you give us a reasonable window to investigate and patch an issue before any public disclosure, and that you avoid accessing, modifying, or exfiltrating data beyond what's necessary to demonstrate the vulnerability.

## Scope

In scope:

- Authentication, authorization, or session handling in `apps/api` or `apps/web`, once those exist
- Anything that could expose environment configuration, database credentials, or other secrets to a client
- Request validation, injection, or deserialization issues in server code (`apps/api/server`, Nitro/H3 handlers)
- SQL/query construction issues in `packages/database`
- Dependency vulnerabilities with a realistic exploitation path in this codebase

Out of scope:

- Vulnerabilities in an upstream dependency's own code with no realistic exploitation path through Buildr (report those to the upstream project directly)
- Denial of service through sheer traffic volume against a deployer's own infrastructure
- Issues that require an already-compromised database or `.env` file
- Misconfiguration in a downstream project built from Buildr, rather than in Buildr itself
- Social engineering against maintainers or contributors

## Disclosure Policy

We follow coordinated disclosure: once a fix is available, we publish a GitHub Security Advisory describing the issue, its impact, and the affected commit range. Buildr does not currently run a paid bug bounty program.
