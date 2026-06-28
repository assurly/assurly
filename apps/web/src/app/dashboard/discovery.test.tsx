import { describe, expect, it } from 'vitest';

describe('GitHub repository URL construction', () => {
  it('encodes owner and repository segments independently', () => {
    const owner = encodeURIComponent('acme space');
    const repository = encodeURIComponent('web/app');
    expect(`https://api.github.com/repos/${owner}/${repository}`).toBe(
      'https://api.github.com/repos/acme%20space/web%2Fapp',
    );
  });
});
