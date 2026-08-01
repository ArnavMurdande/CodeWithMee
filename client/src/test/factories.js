export function createMatchMediaFactory(matchesByQuery = {}) {
  return (query) => ({
    addEventListener() {},
    addListener() {},
    dispatchEvent: () => false,
    matches: matchesByQuery[query] === true,
    media: query,
    onchange: null,
    removeEventListener() {},
    removeListener() {},
  });
}

export function createAuthContextValue(overrides = {}) {
  return {
    clearError() {},
    error: null,
    isAuthenticated: false,
    loading: false,
    signIn: async () => null,
    signOut: async () => undefined,
    user: null,
    ...overrides,
  };
}

export function createDropdownOptions() {
  return [
    { label: 'JavaScript', value: 'javascript' },
    { label: 'Python', value: 'python' },
    { label: 'SQL', value: 'sql' },
  ];
}
