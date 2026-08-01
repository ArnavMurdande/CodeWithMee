import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AsyncState, InlineStatus } from './AsyncState';

describe('AsyncState', () => {
  it('renders a named loading state without an assertive error announcement', () => {
    render(
      <AsyncState
        description="Loading the challenge catalog."
        label="Loading challenges"
        title="Opening challenges…"
        type="loading"
      />,
    );

    const status = screen.getByRole('status', { name: 'Loading challenges' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('heading', { name: 'Opening challenges…' })).toBeVisible();
  });

  it('exposes an error action as a real user interaction', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <AsyncState
        action={<button onClick={retry}>Try again</button>}
        description="The request failed safely."
        label="Challenge load failed"
        title="Could not open challenges"
        type="error"
      />,
    );

    expect(screen.getByRole('alert', { name: 'Challenge load failed' })).toHaveAttribute(
      'aria-live',
      'assertive',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('normalizes an unsupported inline tone to neutral', () => {
    render(<InlineStatus tone="invented">Saved locally</InlineStatus>);
    expect(screen.getByRole('status')).toHaveClass('cwm-inline-status--neutral');
  });
});
