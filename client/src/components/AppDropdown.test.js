import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDropdownOptions } from '../test/factories';
import AppDropdown from './AppDropdown';

describe('AppDropdown', () => {
  it('selects a portal option and returns focus to the named trigger', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <AppDropdown
        label="Language"
        onChange={onChange}
        options={createDropdownOptions()}
        value="javascript"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Language: JavaScript' });
    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Language' })).toBeVisible();
    await user.click(screen.getByRole('menuitemradio', { name: 'Python' }));

    expect(onChange).toHaveBeenCalledWith('python');
    expect(screen.queryByRole('menu', { name: 'Language' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
