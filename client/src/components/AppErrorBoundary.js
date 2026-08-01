import { Component } from 'react';

import { AsyncState } from './ui/AsyncState';

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    window.dispatchEvent(new CustomEvent('codewithmee:ui-error'));
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <AsyncState
        action={
          <button
            className="cwm-button cwm-button--primary"
            onClick={() => window.location.reload()}
          >
            Reload CodeWithMee
          </button>
        }
        description="Your account data was not changed. Reload the page to restore the interface."
        label="Application error"
        title="The interface could not continue"
        type="error"
      />
    );
  }
}

export default AppErrorBoundary;
