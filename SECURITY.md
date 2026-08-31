# Security policy

KataGomo Renju Practice is a single-user local application. The supported
launcher binds Uvicorn to `127.0.0.1`; do not expose the server directly to a
LAN or the public internet.

The application has no login or authentication layer. Loopback binding is its
primary access-control boundary. HTTP requests additionally require an exact
`localhost`, `127.0.0.1`, or `[::1]` Host, and browser WebSockets require a
matching loopback Origin. Originless local CLI clients remain supported, so
software running under the same local account is inside the trust boundary.

Binding Uvicorn to a LAN/public address, placing this application behind a
public reverse proxy, or disabling the Host/Origin checks is unsupported.

## Supported version

Security fixes are applied to the latest commit on the default branch. This
project does not maintain older release branches yet.

## Reporting a vulnerability

Use the repository's private **Security → Report a vulnerability** flow when
it is enabled by the maintainer. If private reporting is unavailable, open an
issue that asks the maintainer for a private contact channel without including
exploit details, personal data, local paths, or logs.

Include the affected commit, macOS/Python versions, reproduction preconditions,
and the smallest safe description of the impact. Do not attach the downloaded
neural-network model or generated engine logs unless the maintainer explicitly
requests a redacted excerpt.

Issues in the unmodified KataGomo engine should also be checked against the
official upstream repository. Please state clearly whether a report affects
this local wrapper/UI, upstream KataGomo, or both.

Repository maintainers should enable GitHub private vulnerability reporting
before announcing a public release.
