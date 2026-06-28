# 0002 - Use ts-morph for AST Parsing and Analysis

- Status: Accepted
- Deciders: Senior Architect, Development Team
- Date: 2026-06-13

## Context and Problem Statement

The ShipReady CLI scanner must analyze TypeScript and JavaScript files to verify production readiness. Simple regular expression matching is brittle and prone to false positives/negatives (e.g., matching strings inside comments, failing on complex code layout, or multiline declarations). We need a parsing solution to parse code files into an Abstract Syntax Tree (AST) to run robust rules and perform auto-fixes.

## Decision Drivers

- **Accuracy:** Minimizing false alarms is critical for developer trust.
- **TypeScript Support:** Must support TypeScript 5+ syntax including decorators, type assertions, and module configurations.
- **Auto-fixing:** The tool must not only report issues but also programmatically fix them (e.g., modifying configurations or adding imports).
- **Ease of Use:** Raw compiler APIs are notoriously complex and verbose. We need a developer-friendly API.

## Considered Options

1. **Regular Expressions (Regex):** Match substrings directly.
2. **Raw TypeScript Compiler API (`typescript`):** Use built-in parser and scanner from Microsoft.
3. **Babel / Acorn parser:** Parse files using JavaScript-native AST parsers.
4. **`ts-morph`:** A wrapper around the TypeScript Compiler API that provides a high-level API for code inspection and manipulation.

## Decision Outcome

Chosen option: **Option 4 (`ts-morph`)**.

`ts-morph` was selected because:

- It parses TypeScript natively using the official Microsoft TypeScript compiler, ensuring 100% syntactic parity.
- It offers a very intuitive high-level API (e.g., `sourceFile.getImportDeclarations()`, `node.getDescendantsOfKind()`) that dramatically speeds up scanner rules development.
- It provides powerful, safe, and clean AST manipulation functions that make implementing interactive auto-fixes straightforward.

### Consequences

- **Good:** Rules are highly accurate and simple to write, verify, and maintain.
- **Good:** Interactive auto-fixing is extremely reliable compared to text-replace/regex approaches.
- **Bad:** `ts-morph` and the underlying `typescript` package are relatively large dependencies, increasing CLI bundle size and startup time slightly. We mitigate this by keeping it as a development-time CLI utility rather than a lightweight runtime library.
