import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { contexts, messages, sources } from '../../src/fixtures';

afterEach(cleanup);

const roles = ['You', 'Responsible lead', 'Human contributor'];
const permittedCompoundLabels = [
  'Intake Agent',
  'Product Evidence Researcher',
  'Company Knowledge',
];
const personalNames = (text: string) =>
  [...permittedCompoundLabels, '100 Example Way', '200 Sample Avenue']
    .reduce((rest, label) => rest.replaceAll(label, ''), text)
    .match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? [];

describe('UI-FIXTURES-01 public synthetic fixture boundary', () => {
  it('uses role-only people, neutral addresses, and no verified external outcomes', () => {
    for (const context of Object.values(contexts)) {
      expect(roles).toContain(context.lead);
      expect(context.verified).toBe(false);
    }
    for (const message of messages) {
      expect([...roles, ...permittedCompoundLabels]).toContain(message.name);
    }
    expect(sources.map((source) => source.address)).toEqual([
      '100 Example Way',
      '200 Sample Avenue',
    ]);
    expect(sources[0].provenance).toBe('Uploaded by Responsible lead');
    expect(personalNames(JSON.stringify({ contexts, messages, sources }))).toEqual([]);
  });

  it('keeps every seeded composition role-based and visibly simulated without authority or verification claims', () => {
    render(<App />);
    expect(
      within(screen.getByRole('tabpanel', { name: 'Home' })).getByText(
        'Simulated workspace | Synthetic fixtures | Session only',
      ),
    ).toBeVisible();
    for (const context of Object.values(contexts).filter((entry) => entry.kind !== 'Home')) {
      fireEvent.click(screen.getByRole('button', { name: 'Working contexts' }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: `Open ${context.title}` }),
      );
      const panel = screen.getByRole('tabpanel', { name: context.title });
      expect(within(panel).getByText(`${context.statusLabel} (simulated)`)).toBeVisible();
      expect(within(panel).getByText('Verification: Not performed')).toBeVisible();
      expect(within(panel).getByText('Authority: No grant to act')).toBeVisible();
      expect(personalNames(panel.textContent ?? '')).toEqual([]);
    }
    expect(personalNames(document.body.textContent ?? '')).toEqual([]);
  });
});
