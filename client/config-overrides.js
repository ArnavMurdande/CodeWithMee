const { override, addBabelPlugin } = require('customize-cra');

module.exports = override(
  addBabelPlugin([
    'prismjs',
    {
      // List all the languages you need here
      languages: ['python', 'javascript', 'clike', 'cpp', 'java'],
      // Choose a theme for the syntax highlighting
      theme: 'tomorrow',
      css: true,
    },
  ])
);