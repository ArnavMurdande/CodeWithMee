import { validateRuntime } from './lib/runtime.mjs';

const result = validateRuntime({
  nodeVersion: process.version,
  npmUserAgent: process.env.npm_config_user_agent,
});

for (const warning of result.warnings) {
  console.warn(`Runtime warning: ${warning}`);
}

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error(`Runtime error: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Runtime verified: Node ${process.version}; npm 11.x contract.`);
}
