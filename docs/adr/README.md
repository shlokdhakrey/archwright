# Architecture Decision Records

Short records of significant decisions: the context, the choice, and its
consequences. New ADRs are appended, never rewritten; superseded ones are marked.

| #                                           | Decision                                                    | Status   |
| ------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-native-decompression-stream.md) | Use native `DecompressionStream('deflate-raw')` for inflate | Accepted |
| [0002](0002-rangereader-abstraction.md)     | Model byte access as a `RangeReader` interface              | Accepted |
| [0003](0003-addressing-modes.md)            | Single-archive vs. multi-archive addressing                 | Accepted |
| [0004](0004-central-directory-caching.md)   | Three-tier central-directory cache                          | Accepted |
| [0005](0005-zero-runtime-dependencies.md)   | Zero runtime dependencies                                   | Accepted |
| [0006](0006-node-based-testing.md)          | Test in Node via dependency injection                       | Accepted |
