// Adapts the @nestjs/swagger CLI plugin to ts-jest's AST transformer interface, so e2e tests
// see the same OpenAPI metadata (JSDoc descriptions, class-validator constraints) as `nest build`.
const plugin = require('@nestjs/swagger/plugin');

module.exports.name = 'nestjs-swagger-transformer';
module.exports.version = 1;
module.exports.factory = (compiler) =>
  plugin.before(
    { introspectComments: true, classValidatorShim: true },
    compiler.program,
  );
