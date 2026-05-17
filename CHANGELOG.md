# [0.6.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.5.0...v0.6.0) (2026-05-17)


### Features

* **document:** share HTTP_METHODS, reuse COMPONENTS_SCHEMAS_PREFIX, harden defensive guards ([#18](https://github.com/rodrigowbazevedo/zod-nest/issues/18)) ([13c3a6a](https://github.com/rodrigowbazevedo/zod-nest/commit/13c3a6aa5a561caeb525571d68719b3999e4c0fa))

# [0.5.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.4.0...v0.5.0) (2026-05-17)


### Features

* **document:** applyZodNest post-processor (Phase 2e) ([#17](https://github.com/rodrigowbazevedo/zod-nest/issues/17)) ([1d1e428](https://github.com/rodrigowbazevedo/zod-nest/commit/1d1e42897271bc6e9a2c882c1ee70fe3dcc1dca0)), closes [#16](https://github.com/rodrigowbazevedo/zod-nest/issues/16) [#16](https://github.com/rodrigowbazevedo/zod-nest/issues/16)

# [0.4.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.3.0...v0.4.0) (2026-05-17)


### Features

* **response:** @ZodResponse + ZodSerializerInterceptor + ZodNestModule (Phase 2d) ([#15](https://github.com/rodrigowbazevedo/zod-nest/issues/15)) ([4a0d04f](https://github.com/rodrigowbazevedo/zod-nest/commit/4a0d04f032685290204dd723cbe78aee231c8325)), closes [#14](https://github.com/rodrigowbazevedo/zod-nest/issues/14) [#14](https://github.com/rodrigowbazevedo/zod-nest/issues/14)

# [0.3.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.2.0...v0.3.0) (2026-05-17)


### Features

* **pipe:** ZodValidationPipe + ZodValidationException (Phase 2c) ([#13](https://github.com/rodrigowbazevedo/zod-nest/issues/13)) ([add7cd0](https://github.com/rodrigowbazevedo/zod-nest/commit/add7cd074562eeeeab9936c562a3f5dc3f6b9f05)), closes [#12](https://github.com/rodrigowbazevedo/zod-nest/issues/12)

# [0.2.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.1.5...v0.2.0) (2026-05-17)


### Features

* **dto:** createZodDto with placeholder bridge for @nestjs/swagger (Phase 2b) ([#11](https://github.com/rodrigowbazevedo/zod-nest/issues/11)) ([291a87b](https://github.com/rodrigowbazevedo/zod-nest/commit/291a87be709ceebbc490ac292b1465792f0a6219)), closes [#10](https://github.com/rodrigowbazevedo/zod-nest/issues/10)

## [0.1.5](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.1.4...v0.1.5) (2026-05-17)


### Bug Fixes

* **release:** drive npm publish through npx --package=npm@11 ([#8](https://github.com/rodrigowbazevedo/zod-nest/issues/8)) ([9e3df47](https://github.com/rodrigowbazevedo/zod-nest/commit/9e3df4780fc80873eb6f473b57f488b2d4a133ed))

## [0.1.4](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.1.3...v0.1.4) (2026-05-17)


### Bug Fixes

* **release:** upgrade to npm@11 — Node 24.15.0 still ships npm 10.9.8 ([655fed6](https://github.com/rodrigowbazevedo/zod-nest/commit/655fed634d04dabca6159ba4e167d019e435eead))

## [0.1.3](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.1.2...v0.1.3) (2026-05-17)


### Bug Fixes

* **release:** drop redundant build step + enable verbose npm logging ([b35eb75](https://github.com/rodrigowbazevedo/zod-nest/commit/b35eb75ac9dc14066c678f4dc9448d4ca73236c8)), closes [#5](https://github.com/rodrigowbazevedo/zod-nest/issues/5)

## [0.1.2](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.1.1...v0.1.2) (2026-05-17)


### Bug Fixes

* **release:** set registry-url on setup-node so npm initiates OIDC ([4098776](https://github.com/rodrigowbazevedo/zod-nest/commit/4098776f6d57b77b67a81f1ccf0cb907984f327b)), closes [#4](https://github.com/rodrigowbazevedo/zod-nest/issues/4)

## [0.1.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.1.0...v0.1.1) (2026-05-17)


### Bug Fixes

* **release:** claim packages environment for npm OIDC handshake ([2a93c44](https://github.com/rodrigowbazevedo/zod-nest/commit/2a93c44a2b4d8c16cdaeb8c1cc7637ad51940f37))

# [0.1.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.0.1...v0.1.0) (2026-05-17)


### Features

* **schema:** add Zod v4 → OpenAPI 3.1 schema engine ([088ecd1](https://github.com/rodrigowbazevedo/zod-nest/commit/088ecd1ee911f28bf81c8d53709fccfb5837c5dc))

## [0.0.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.0.0...v0.0.1) (2026-05-16)


### Bug Fixes

* bump minimum Node engine from 20 to 22 ([5d304a5](https://github.com/rodrigowbazevedo/zod-nest/commit/5d304a5d45168add88a14461b8d91a2970b450aa))
* drop redundant npm upgrade step in release workflow ([7bf31d0](https://github.com/rodrigowbazevedo/zod-nest/commit/7bf31d030497e19eb1a7b43277337479348d401a))
* pin npm@11 in release workflow ([e30347f](https://github.com/rodrigowbazevedo/zod-nest/commit/e30347fd6b12f3a6065875cbc1b788840c22ae2e))
