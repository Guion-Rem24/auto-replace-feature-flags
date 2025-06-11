import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { useValue } from '@some-library';

declare const isAdmin: () => boolean;
declare const doX: () => void;
declare const doY: () => void;

function AppFunc(): React.ReactElement {
  const enabled = useValue('feature-1');
  const disabled = useValue('feature-2');
  if (enabled === 'feature1') {
    console.log('Feature 1 is enabled');
  } else if (!!disabled) {
    console.log('Feature 1 is disabled');
  } else if (enabled && disabled) {
    console.log('Feature 1 is not available');
  }
  if (isAdmin() || disabled == false) doX();
  else doY();
  const happy = disabled === 'feature2' ? 'hoge' : 'fuga';
  const sad = disabled === 'feature2' && enabled;
  return <div>Hello, World!</div>;
}

const App: React.FC = () => {
  const enabled = useValue('feature-1');
  const disabled = useValue('feature-2');
  if (enabled === 'feature1') {
    console.log('Feature 1 is enabled');
  } else if (!!disabled) {
    console.log('Feature 1 is disabled');
  } else if (enabled && disabled) {
    console.log('Feature 1 is not available');
  }
  if (isAdmin() || false) doX();
  else doY();
  const happy = disabled === 'feature2' ? 'hoge' : 'fuga';
  const sad = disabled === 'feature2' && enabled;
  return <div>Hello, World!</div>;
};

const root = ReactDOM.createRoot(document.querySelector('#root')!);
root.render(<App />);
