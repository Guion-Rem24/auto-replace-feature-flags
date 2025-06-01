import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { useValue } from '@some-library'

const App: React.FC = () => {
  const enabled = useValue('feature-1');
  return <div>
    Hello, World!
  </div>
}

const root = ReactDOM.createRoot(document.querySelector('#root')!)
root.render(<App/>)