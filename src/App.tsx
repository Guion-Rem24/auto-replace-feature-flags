import React from 'react';
import * as ReactDOM from 'react-dom/client';

const App: React.FC =() => {
  return <div>
    Hello, World!
  </div>
}

const root = ReactDOM.createRoot(document.querySelector('#root')!)
root.render(<App/>)