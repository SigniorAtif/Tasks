import fc from 'fast-check';

// Every property test runs 1,000 random cases (v0.1 "done when").
fc.configureGlobal({ numRuns: 1000 });
