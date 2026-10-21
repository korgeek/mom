import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { useMeetingController } from './controller';

export function MeetingApp() {
  const controller = useMeetingController();
  return <App controller={controller} />;
}

// Re-evaluating this entry during HMR must not leave a second vault owner alive.
const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<StrictMode><MeetingApp /></StrictMode>);
