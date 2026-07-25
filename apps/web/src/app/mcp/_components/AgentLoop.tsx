import type { ReactElement } from 'react';

/**
 * The typical Assurly agent loop as semantic ordered list markup, styled into a
 * visual flow. Degrades to a readable sequence when CSS fails; stays copyable
 * and screen-reader friendly (not an image).
 */
export function AgentLoop(): ReactElement {
  return (
    <ol className="mcp-agent-loop">
      <li className="mcp-agent-loop-step">
        <span className="mcp-agent-loop-marker" aria-hidden="true">
          1
        </span>
        <span className="mcp-agent-loop-body">Agent writes or edits code.</span>
      </li>
      <li className="mcp-agent-loop-step">
        <span className="mcp-agent-loop-marker" aria-hidden="true">
          2
        </span>
        <span className="mcp-agent-loop-body">
          Call <code>assurly_scan_path</code> or <code>assurly_scan_files</code>.
        </span>
      </li>
      <li className="mcp-agent-loop-step">
        <span className="mcp-agent-loop-marker" aria-hidden="true">
          3
        </span>
        <span className="mcp-agent-loop-body">Read blockers from the Ship Gate summary.</span>
      </li>
      <li className="mcp-agent-loop-step">
        <span className="mcp-agent-loop-marker" aria-hidden="true">
          4
        </span>
        <span className="mcp-agent-loop-body">
          Call <code>assurly_explain_rule</code> for remediation hints.
        </span>
      </li>
      <li className="mcp-agent-loop-step">
        <span className="mcp-agent-loop-marker" aria-hidden="true">
          5
        </span>
        <span className="mcp-agent-loop-body">
          Fix issues and re-scan until the verdict is <strong>READY TO SHIP</strong>.
        </span>
      </li>
    </ol>
  );
}
