import React from 'react';
import { FAQ_ENTRIES } from '../../../utils/faq';

/**
 * The questions section, rendered from the same array that produces the
 * `FAQPage` structured data.
 *
 * Native `<details>` rather than a scripted accordion: it opens without
 * JavaScript, it is keyboard operable and announced correctly with no ARIA of
 * our own, and — the part that matters here — the answers are present in the
 * server-rendered HTML whether or not anything is expanded, so a crawler that
 * never clicks still reads them.
 */
export function Faq(): React.ReactElement {
  return (
    <section id="faq" className="faq-section" aria-labelledby="faq-heading">
      <div className="faq-header">
        <h2 id="faq-heading">Questions people ask before shipping</h2>
        <p className="faq-subheading">
          Straight answers about what Assurly checks, what leaves your machine, and what it costs.
        </p>
      </div>

      <div className="faq-list">
        {FAQ_ENTRIES.map((entry) => (
          <details key={entry.id} className="faq-item" data-testid={`faq-${entry.id}`}>
            <summary className="faq-question">
              <span>{entry.question}</span>
            </summary>
            <p className="faq-answer">{entry.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
