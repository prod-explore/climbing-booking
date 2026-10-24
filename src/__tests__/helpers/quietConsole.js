'use strict';

// Startup, migration and "request rejected" lines help in a terminal and drown a test report, so console.log and
// console.warn are muted while the suite runs (TEST_VERBOSE=1 shows them). console.error is still printed.
if (!process.env.TEST_VERBOSE) {
  console.log = () => {};
  console.warn = () => {};
}
