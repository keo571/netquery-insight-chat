import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ tables: [], suggested_queries: [] })
  });
});

afterEach(() => {
  jest.resetAllMocks();
});

test('renders Send button', async () => {
  render(<App />);
  const sendButton = await screen.findByRole('button', { name: /send/i });
  expect(sendButton).toBeInTheDocument();
});
