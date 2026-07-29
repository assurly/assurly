import React from 'react';

interface StructuredDataProps {
  /** A schema.org node, normally a `@graph` built in utils/structuredData.ts. */
  graph: Record<string, unknown>;
}

/**
 * Emits a JSON-LD block.
 *
 * Next's guidance is a native `<script type="application/ld+json">` rather than
 * `next/script`: this is data for a parser, not code to execute, so there is
 * nothing to defer or prioritise.
 *
 * `<` is escaped to its unicode form. `JSON.stringify` will happily emit the
 * characters that close a script element, so a string reaching this component
 * with `</script>` inside it would otherwise break out of the block and run as
 * markup. Everything here is currently authored in the repository, but the
 * escape is what makes that a property of the component rather than of today's
 * inputs.
 */
export function StructuredData({ graph }: StructuredDataProps): React.ReactElement {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, '\\u003c') }}
    />
  );
}
