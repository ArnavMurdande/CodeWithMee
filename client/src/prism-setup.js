// client/src/prism-setup.js

// This file centralizes all PrismJS imports to ensure they are loaded in the correct dependency order.

// 1. Import the core library
import { highlight, languages } from 'prismjs/components/prism-core';

// 2. Import the base language component that others depend on
import 'prismjs/components/prism-clike';

// 3. Import all other languages you need. They can now safely extend 'clike'.
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-cpp';

// 4. Export the necessary functions for use in your components
export { highlight, languages };