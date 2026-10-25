# @northwind/tsconfig

Shared TypeScript configs. Extend one from a workspace package:

```jsonc
{ "extends": "@northwind/tsconfig/nestjs.json" }
```

- `base.json` — Node 24, strict, `nodenext` modules
- `nestjs.json` — adds decorator metadata for NestJS apps
- `library.json` — for packages consumed by other workspaces
