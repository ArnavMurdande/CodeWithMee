import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { AccessibleDialog } from './AccessibleDialog';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open details</button>
      {open ? (
        <AccessibleDialog label="Details" onClose={() => setOpen(false)}>
          <button>First action</button>
          <button>Last action</button>
        </AccessibleDialog>
      ) : null}
    </>
  );
}

describe('AccessibleDialog', () => {
  it('closes with Escape and restores focus to the opener', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const opener = screen.getByRole('button', { name: 'Open details' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
