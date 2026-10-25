# @northwind/eslint-config

Shared ESLint flat config (type-aware typescript-eslint + Prettier compatibility).

```js
// eslint.config.js
import { nodeConfig } from '@northwind/eslint-config';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```
