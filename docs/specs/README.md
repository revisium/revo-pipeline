# Specifications

| Specification                                                    | Status   |
| ---------------------------------------------------------------- | -------- |
| [Pipeline definition v1](./pipeline-definition-v1.spec.md)       | Accepted |
| [Pipeline transition v1](./pipeline-transition-v1.spec.md)       | Accepted |
| [Internal module structure](./internal-module-structure.spec.md) | Accepted |

Acceptance fixes the contract for later implementation. It does not ship an API: until a
subsequent implementation slice changes `src/index.ts`, the package root remains exactly
`export {};` and the accepted API sketches are planned declarations only.
