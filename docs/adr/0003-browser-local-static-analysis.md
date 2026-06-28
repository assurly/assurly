# 0003 - Client-Side (Local) Static Analysis in Web App

- Status: Accepted
- Deciders: Senior Architect, Development Team
- Date: 2026-06-13

## Context and Problem Statement

The ShipReady web application includes a "drag & drop" scanner allowing users to instantly check their project's configuration and security readiness. If the code is uploaded to our servers, it introduces significant security, regulatory (e.g., GDPR, SOC 2), and data-privacy concerns for the user. We must decide how to architecture this scanning capability.

## Decision Drivers

- **Privacy & Security:** Intellectual property (IP) must never leave the user's machine.
- **Cost:** Running remote container scans for hundreds of projects would incur heavy server-side costs.
- **Latency:** The scanning process must be instant to maximize user engagement.

## Considered Options

1. **Server-Side Sandbox:** Upload project zip/files to a secure backend container, execute the CLI, and return JSON findings.
2. **Client-Side Sandbox (100% Local):** Parse and analyze files directly in the browser via JavaScript File Reader API without any server upload.

## Decision Outcome

Chosen option: **Option 2 (Client-Side Sandbox / 100% Local)**.

All files dropped into the web UI are read locally using browser APIs:

- **Zero Trust Security:** Code, secrets, and private repository structures never touch a server, meaning zero chance of data leaks.
- **Cost Efficiency:** Offloading scanning computations to the user's client means the web app costs $0 in compute/scanning resources.
- **Instantaneous Feedback:** Eliminating the network round-trip (especially for multiple files) provides an optimal UX.

### Consequences

- **Good:** Excellent selling point for security-conscious developers and corporate environments.
- **Good:** Scalable to millions of scans without server cost increases.
- **Bad:** Cannot run tools that require Node.js child processes or file-system-bound utilities directly in the browser. We mitigate this by implementing a custom lightweight version of the AST scanner rules tailored for in-browser execution.
