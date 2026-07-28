# Executable scenarios

Each marked TypeScript program is compiled and executed in isolation against the same
single exact packed artifact.

| Scenario                                                          | Public values exercised                                       | Node kinds exercised                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------- |
| Task/branch/terminal quick start in the repository README         | `definePipeline`, `compilePipeline`, `decidePipeline`         | `task`, `branch`, `terminal`            |
| [Fork/join/consensus/terminal](./fork-join-consensus-terminal.md) | `compilePipeline`, `decodeCompiledPipeline`, `reducePipeline` | `fork`, `join`, `consensus`, `terminal` |
| [Human-gate/terminal/replay](./human-gate-terminal-replay.md)     | `compilePipeline`, `reducePipeline`                           | `humanGate`, `terminal`                 |

Together they execute all five public values and all seven node kinds. The mapping is
traceability, not a substitute for the named runtime assertions.
