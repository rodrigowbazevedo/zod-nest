# [1.9.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.8.1...v1.9.0) (2026-05-20)


### Features

* **document:** expose every registered schema in components.schemas ([#83](https://github.com/rodrigowbazevedo/zod-nest/issues/83)) ([eb38839](https://github.com/rodrigowbazevedo/zod-nest/commit/eb3883923412e6457ad93fca442ff951db95db5a)), closes [#80](https://github.com/rodrigowbazevedo/zod-nest/issues/80) [#82](https://github.com/rodrigowbazevedo/zod-nest/issues/82)

## [1.8.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.8.0...v1.8.1) (2026-05-19)


### Bug Fixes

* **document:** seed inputExposedIds from nested $refs in inline body schemas ([#82](https://github.com/rodrigowbazevedo/zod-nest/issues/82)) ([55a50d4](https://github.com/rodrigowbazevedo/zod-nest/commit/55a50d4f38ff40789ad1c2d3fa540245626ee902))

# [1.8.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.7.1...v1.8.0) (2026-05-19)


### Features

* **decorators:** @ZodBody({ flatten: true }) for Swagger UI multipart compatibility ([#80](https://github.com/rodrigowbazevedo/zod-nest/issues/80)) ([4373f37](https://github.com/rodrigowbazevedo/zod-nest/commit/4373f3794ddb94d7cd5289e33cb626080ee35394)), closes [#71](https://github.com/rodrigowbazevedo/zod-nest/issues/71)

## [1.7.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.7.0...v1.7.1) (2026-05-19)


### Bug Fixes

* **peer-deps:** align rxjs floor with required types layout (>=7.6.0) ([#81](https://github.com/rodrigowbazevedo/zod-nest/issues/81)) ([c120c17](https://github.com/rodrigowbazevedo/zod-nest/commit/c120c17373692b4fc3ef505ff80b67dc62f345f5)), closes [#79](https://github.com/rodrigowbazevedo/zod-nest/issues/79)

# [1.7.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.6.1...v1.7.0) (2026-05-19)


### Features

* **decorators:** @ZodBody/@ZodQuery/@ZodHeaders/@ZodCookies for union-typed schemas ([#69](https://github.com/rodrigowbazevedo/zod-nest/issues/69)) ([2acb4a5](https://github.com/rodrigowbazevedo/zod-nest/commit/2acb4a5777ba4a914ae6f0c4375edd38a32ec6f0)), closes [#67](https://github.com/rodrigowbazevedo/zod-nest/issues/67) [#68](https://github.com/rodrigowbazevedo/zod-nest/issues/68)

## [1.6.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.6.0...v1.6.1) (2026-05-19)


### Bug Fixes

* **schema:** guard discoverDependents against undefined child slots ([#65](https://github.com/rodrigowbazevedo/zod-nest/issues/65)) ([25a578d](https://github.com/rodrigowbazevedo/zod-nest/commit/25a578d34ce4f21d46ecfb46f80d6cd994eee5e3))

# [1.6.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.5.1...v1.6.0) (2026-05-19)


### Features

* **schema:** auto-register named extend() parents via shared registerSchema helper ([#64](https://github.com/rodrigowbazevedo/zod-nest/issues/64)) ([2dba914](https://github.com/rodrigowbazevedo/zod-nest/commit/2dba914fa4baafb28e9f053fe535b347e718f11d)), closes [#63](https://github.com/rodrigowbazevedo/zod-nest/issues/63)

## [1.5.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.5.0...v1.5.1) (2026-05-19)


### Bug Fixes

* **schema:** inherit Zod-side description in overrideJSONSchema when fragment omits one ([#62](https://github.com/rodrigowbazevedo/zod-nest/issues/62)) ([c7f9565](https://github.com/rodrigowbazevedo/zod-nest/commit/c7f9565c6b4a7be46ba4f790446fa58637ff975c)), closes [#61](https://github.com/rodrigowbazevedo/zod-nest/issues/61)

# [1.5.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.4.0...v1.5.0) (2026-05-18)


### Features

* **helpers:** introduce zod-nest/helpers subpath with fragment catalog, sugar, enrich, presets ([#60](https://github.com/rodrigowbazevedo/zod-nest/issues/60)) ([38c9680](https://github.com/rodrigowbazevedo/zod-nest/commit/38c96801144b5f6d9c269dca50ead81d9862e829)), closes [#59](https://github.com/rodrigowbazevedo/zod-nest/issues/59)

# [1.4.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.3.1...v1.4.0) (2026-05-18)


### Features

* **decorators:** @ZodResponse auto-applies @ApiResponse for OpenAPI emission ([#58](https://github.com/rodrigowbazevedo/zod-nest/issues/58)) ([4cfd8ec](https://github.com/rodrigowbazevedo/zod-nest/commit/4cfd8ec96c5fb626d65a9c5d51a2961cfd459387)), closes [#56](https://github.com/rodrigowbazevedo/zod-nest/issues/56)

## [1.3.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.3.0...v1.3.1) (2026-05-18)


### Bug Fixes

* **document:** strip $schema/$id from emitted component schemas ([#57](https://github.com/rodrigowbazevedo/zod-nest/issues/57)) ([1f98026](https://github.com/rodrigowbazevedo/zod-nest/commit/1f980261f3f0d90cf634a281b46641555366de9c)), closes [#54](https://github.com/rodrigowbazevedo/zod-nest/issues/54) [#55](https://github.com/rodrigowbazevedo/zod-nest/issues/55)

# [1.3.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.2.0...v1.3.0) (2026-05-18)


### Features

* **document:** expand @Query/@Param/@Headers DTOs in applyZodNest ([#54](https://github.com/rodrigowbazevedo/zod-nest/issues/54)) ([360cb1a](https://github.com/rodrigowbazevedo/zod-nest/commit/360cb1a3bb506a50dc882a6f7cab8f1b78441c04)), closes [#53](https://github.com/rodrigowbazevedo/zod-nest/issues/53)

# [1.2.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.1.1...v1.2.0) (2026-05-18)


### Features

* **schema:** transitively register nested .meta({ id }) schemas ([#52](https://github.com/rodrigowbazevedo/zod-nest/issues/52)) ([7485be4](https://github.com/rodrigowbazevedo/zod-nest/commit/7485be4c4155593f5160062824f9ca20c1083731)), closes [#46](https://github.com/rodrigowbazevedo/zod-nest/issues/46)

## [1.1.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.1.0...v1.1.1) (2026-05-18)


### Bug Fixes

* **schema:** suppress strict-mode hit on pipe-wrapped transforms ([#51](https://github.com/rodrigowbazevedo/zod-nest/issues/51)) ([b6d4c65](https://github.com/rodrigowbazevedo/zod-nest/commit/b6d4c65edb42aff943be610f009c3cf00e200bcf)), closes [#49](https://github.com/rodrigowbazevedo/zod-nest/issues/49) [#50](https://github.com/rodrigowbazevedo/zod-nest/issues/50)

# [1.1.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v1.0.0...v1.1.0) (2026-05-18)


### Features

* **schema:** I/O divergence support in overrideJSONSchema ([#49](https://github.com/rodrigowbazevedo/zod-nest/issues/49)) ([aa77b64](https://github.com/rodrigowbazevedo/zod-nest/commit/aa77b64d78040b0c832810b686ee44fc191410d1))

# [1.0.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.13.0...v1.0.0) (2026-05-18)


* fix!: tighten peer-dep ranges + add reflect-metadata + rxjs to compat matrix ([#48](https://github.com/rodrigowbazevedo/zod-nest/issues/48)) ([a06de61](https://github.com/rodrigowbazevedo/zod-nest/commit/a06de612a890d86f1e9e346e7991a13d5d1bb338)), closes [#41](https://github.com/rodrigowbazevedo/zod-nest/issues/41) [#42](https://github.com/rodrigowbazevedo/zod-nest/issues/42)


---

### Migrating

This release contains breaking changes. See [MIGRATION.md](https://github.com/rodrigowbazevedo/zod-nest/blob/main/MIGRATION.md) for the upgrade path.

# [0.13.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.12.0...v0.13.0) (2026-05-18)


### Features

* **schema:** overrideJSONSchema(schema, fragment) for unrepresentable types ([#45](https://github.com/rodrigowbazevedo/zod-nest/issues/45)) ([d4c48c2](https://github.com/rodrigowbazevedo/zod-nest/commit/d4c48c26f9fbda936c6846d07aae4e79a119b7f0)), closes [#31](https://github.com/rodrigowbazevedo/zod-nest/issues/31)

# [0.12.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.11.0...v0.12.0) (2026-05-18)


### Features

* **response:** accept '1XX'..'5XX' wildcards and 'default' in @ZodResponse ([#44](https://github.com/rodrigowbazevedo/zod-nest/issues/44)) ([06e5a71](https://github.com/rodrigowbazevedo/zod-nest/commit/06e5a718dd847e5ae6a719c1908817ad436ae1cc)), closes [#29](https://github.com/rodrigowbazevedo/zod-nest/issues/29)

# [0.11.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.10.1...v0.11.0) (2026-05-18)


### Features

* **ci:** compatibility matrix for zod + [@nestjs](https://github.com/nestjs) peer-dep ranges ([#40](https://github.com/rodrigowbazevedo/zod-nest/issues/40)) ([88bfafb](https://github.com/rodrigowbazevedo/zod-nest/commit/88bfafb6aed7233f1318c1419d77d66f4997752f)), closes [#34](https://github.com/rodrigowbazevedo/zod-nest/issues/34)

## [0.10.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.10.0...v0.10.1) (2026-05-18)


### Bug Fixes

* **build:** emit design:paramtypes metadata via SWC plugin ([#39](https://github.com/rodrigowbazevedo/zod-nest/issues/39)) ([7b450ba](https://github.com/rodrigowbazevedo/zod-nest/commit/7b450ba6deeb414379943d2fc005fc19aae696aa)), closes [#35](https://github.com/rodrigowbazevedo/zod-nest/issues/35) [#35](https://github.com/rodrigowbazevedo/zod-nest/issues/35)

# [0.10.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.9.0...v0.10.0) (2026-05-18)


### Features

* **release:** provenance + dry-run + MIGRATION.md link in notes ([#38](https://github.com/rodrigowbazevedo/zod-nest/issues/38)) ([5ddbaf2](https://github.com/rodrigowbazevedo/zod-nest/commit/5ddbaf27dda494752ac07244e5f0684f0fba23f5)), closes [#34](https://github.com/rodrigowbazevedo/zod-nest/issues/34) [#if](https://github.com/rodrigowbazevedo/zod-nest/issues/if)

# [0.9.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.8.2...v0.9.0) (2026-05-18)


### Features

* **ci:** PR validation hardening — coverage, types, OpenAPI gates ([#36](https://github.com/rodrigowbazevedo/zod-nest/issues/36)) ([9adcb68](https://github.com/rodrigowbazevedo/zod-nest/commit/9adcb6877b115df02cecb9c491c00d20a53317c7)), closes [#34](https://github.com/rodrigowbazevedo/zod-nest/issues/34) [package.json#files](https://github.com/package.json/issues/files) [#25](https://github.com/rodrigowbazevedo/zod-nest/issues/25) [#27](https://github.com/rodrigowbazevedo/zod-nest/issues/27) [#28](https://github.com/rodrigowbazevedo/zod-nest/issues/28)

## [0.8.2](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.8.1...v0.8.2) (2026-05-17)


### Bug Fixes

* **skills:** public consumer-facing skills (migrate + best-practices) ([#33](https://github.com/rodrigowbazevedo/zod-nest/issues/33)) ([dc39b20](https://github.com/rodrigowbazevedo/zod-nest/commit/dc39b20fc4a16abfbde3f10b5bff04989417b788)), closes [#32](https://github.com/rodrigowbazevedo/zod-nest/issues/32)

## [0.8.1](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.8.0...v0.8.1) (2026-05-17)


### Bug Fixes

* **release:** explicit pipeline steps; CI runs on PRs only ([#28](https://github.com/rodrigowbazevedo/zod-nest/issues/28)) ([6c8317c](https://github.com/rodrigowbazevedo/zod-nest/commit/6c8317cad8cf5e18fb7692d9e8cac6744f06a19b))

# [0.8.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.7.0...v0.8.0) (2026-05-17)


### Features

* **claude:** Phase 4 — CLAUDE.md, skills, hooks; ship 0.8.0 ([#27](https://github.com/rodrigowbazevedo/zod-nest/issues/27)) ([b2d97e7](https://github.com/rodrigowbazevedo/zod-nest/commit/b2d97e7da5064223ab4d9098d426eef8cff01761))

# [0.7.0](https://github.com/rodrigowbazevedo/zod-nest/compare/v0.6.0...v0.7.0) (2026-05-17)


### Features

* **schema:** composition layer v0.2 — extend, allOf emission, experimental ([#20](https://github.com/rodrigowbazevedo/zod-nest/issues/20)) ([b7f4ea4](https://github.com/rodrigowbazevedo/zod-nest/commit/b7f4ea44066df67057718379cafa4a4a24a01962)), closes [#19](https://github.com/rodrigowbazevedo/zod-nest/issues/19) [#19](https://github.com/rodrigowbazevedo/zod-nest/issues/19)

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
