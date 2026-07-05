import type { ReactElement } from 'react';
import {
  COOKIE_INVENTORY,
  COOKIE_POLICY_VERSION,
  getCookieCategoryLabel,
  NON_COOKIE_STORAGE,
} from '../../utils/cookieInventory';

export function CookieInventoryTable(): ReactElement {
  const rows = [...COOKIE_INVENTORY, ...NON_COOKIE_STORAGE];

  return (
    <div
      className="legal-cookie-table-wrap"
      role="region"
      aria-label="Cookie and essential storage inventory"
      tabIndex={0}
    >
      <p className="legal-cookie-policy-version">
        Cookie policy version: <strong>{COOKIE_POLICY_VERSION}</strong>
      </p>
      <table className="legal-cookie-table">
        <caption className="visually-hidden">
          ShipReady cookie and essential storage inventory
        </caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Category</th>
            <th scope="col">Purpose</th>
            <th scope="col">Duration</th>
            <th scope="col">Party</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.name}>
              <td>
                <code>{entry.name}</code>
              </td>
              <td>{getCookieCategoryLabel(entry.category)}</td>
              <td>{entry.purpose}</td>
              <td>{entry.duration}</td>
              <td>{entry.party}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
