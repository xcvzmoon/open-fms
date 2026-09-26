# Changelog

## v0.0.4

[compare changes](https://github.com/xcvzmoon/open-fms/compare/v0.0.3...v0.0.4)

### 🚀 Enhancements

- **database:** Add registration tokens setup codes and upload passes ([0487fb4](https://github.com/xcvzmoon/open-fms/commit/0487fb4))
- **api:** Add registration flows for signup keys and passes ([0bce4bc](https://github.com/xcvzmoon/open-fms/commit/0bce4bc))
- **storage:** Add single s3 adapter with put presigning ([3922921](https://github.com/xcvzmoon/open-fms/commit/3922921))
- **database:** Load storage backend rows for adapter config ([249e086](https://github.com/xcvzmoon/open-fms/commit/249e086))
- **lifecycle:** Add guarded file state machine and quota ops ([4234c1d](https://github.com/xcvzmoon/open-fms/commit/4234c1d))
- **api:** Add upload routes with streaming hash and complete ([8ceee1e](https://github.com/xcvzmoon/open-fms/commit/8ceee1e))
- **database:** Load file records for upload ownership checks ([8b4cb8c](https://github.com/xcvzmoon/open-fms/commit/8b4cb8c))

### 🩹 Fixes

- **api:** Resolve tilde alias in nitro config ([91e1b46](https://github.com/xcvzmoon/open-fms/commit/91e1b46))
- **ci:** Build all open-fms packages and export source types ([d653278](https://github.com/xcvzmoon/open-fms/commit/d653278))

### 🏡 Chore

- **todo:** Mark t7 as completed ([af2f64b](https://github.com/xcvzmoon/open-fms/commit/af2f64b))
- **todo:** Mark t8 as completed ([f68fc9f](https://github.com/xcvzmoon/open-fms/commit/f68fc9f))
- **todo:** Mark t9 as completed ([33ed666](https://github.com/xcvzmoon/open-fms/commit/33ed666))
- **todo:** Mark t10 as completed ([1143a0f](https://github.com/xcvzmoon/open-fms/commit/1143a0f))

### ✅ Tests

- Cover token security signup domain and env ([8135ed2](https://github.com/xcvzmoon/open-fms/commit/8135ed2))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))

## v0.0.3

[compare changes](https://github.com/xcvzmoon/open-fms/compare/v0.0.2...v0.0.3)

### 🚀 Enhancements

- **database:** Add better auth schema and migration ([cbb9be0](https://github.com/xcvzmoon/open-fms/commit/cbb9be0))
- **mailer:** Add typed auth mail dispatch with mock and smtp ([88bf99e](https://github.com/xcvzmoon/open-fms/commit/88bf99e))
- **api:** Wire better auth middleware and auth email hooks ([d4d8b88](https://github.com/xcvzmoon/open-fms/commit/d4d8b88))
- **api:** Validate auth env and attach caller policy ([f302bf7](https://github.com/xcvzmoon/open-fms/commit/f302bf7))
- **database:** Add caller policy query for auth context ([aee5feb](https://github.com/xcvzmoon/open-fms/commit/aee5feb))

### 🩹 Fixes

- **plan:** Format file ([747d587](https://github.com/xcvzmoon/open-fms/commit/747d587))
- **api:** Validate auth context user with valibot ([abd8a20](https://github.com/xcvzmoon/open-fms/commit/abd8a20))
- **api:** Type h3 event context with direct h3 dependency ([035a8e6](https://github.com/xcvzmoon/open-fms/commit/035a8e6))
- **ci:** Build open-fms packages and export source entries ([14bc386](https://github.com/xcvzmoon/open-fms/commit/14bc386))
- **mailer:** Reuse transport and remove unused queue types ([0dce4df](https://github.com/xcvzmoon/open-fms/commit/0dce4df))
- **packages:** Export source entrypoints for workspace packages ([7610966](https://github.com/xcvzmoon/open-fms/commit/7610966))

### 📖 Documentation

- **plan:** Add registration rules build order invariants and get policy ([1310b4a](https://github.com/xcvzmoon/open-fms/commit/1310b4a))
- Record better auth mail env and plan notes ([cb5026c](https://github.com/xcvzmoon/open-fms/commit/cb5026c))

### 🏡 Chore

- **todo:** Mark t5 as completed ([c60d0ec](https://github.com/xcvzmoon/open-fms/commit/c60d0ec))

### ✅ Tests

- **api:** Cover auth env and public paths ([b3c39bb](https://github.com/xcvzmoon/open-fms/commit/b3c39bb))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))

## v0.0.2

[compare changes](https://github.com/xcvzmoon/open-fms/compare/v0.0.1...v0.0.2)

### 🚀 Enhancements

- **database:** Add postgres client, fms schema, and column helpers ([b8f5335](https://github.com/xcvzmoon/open-fms/commit/b8f5335))
- **database:** Define fms tables with indexes and audit helpers ([1c48962](https://github.com/xcvzmoon/open-fms/commit/1c48962))
- **database:** Add drizzle migration pipeline for fms schema ([b9b8e73](https://github.com/xcvzmoon/open-fms/commit/b9b8e73))

### 🏡 Chore

- **database:** Add uuid to catalog and package deps ([e084f09](https://github.com/xcvzmoon/open-fms/commit/e084f09))
- **todo:** Mark t2 as completed ([26d0c4f](https://github.com/xcvzmoon/open-fms/commit/26d0c4f))
- **todo:** Mark t3 as completed ([efb5b61](https://github.com/xcvzmoon/open-fms/commit/efb5b61))
- **todo:** Mark t4 as completed ([e43c347](https://github.com/xcvzmoon/open-fms/commit/e43c347))

### ✅ Tests

- **database:** Cover column helpers and fms schema ([a2f2057](https://github.com/xcvzmoon/open-fms/commit/a2f2057))
- **database:** Cover table placement columns and indexes ([b8112a1](https://github.com/xcvzmoon/open-fms/commit/b8112a1))
- **database:** Cover migration artifacts and handwritten sql ([c613b3e](https://github.com/xcvzmoon/open-fms/commit/c613b3e))

### 🤖 CI

- Validate database migrations on pull requests ([4be7d14](https://github.com/xcvzmoon/open-fms/commit/4be7d14))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))

## v0.0.1


### 🩹 Fixes

- **ci:** Add drizzle config for db test ([1afb4e4](https://github.com/xcvzmoon/open-fms/commit/1afb4e4))

### 📖 Documentation

- Update readme ([8f3d985](https://github.com/xcvzmoon/open-fms/commit/8f3d985))

### 🏡 Chore

- Initialize repository ([6cfbced](https://github.com/xcvzmoon/open-fms/commit/6cfbced))
- Use Open FMS name ([9ac1499](https://github.com/xcvzmoon/open-fms/commit/9ac1499))
- Change package names ([0edf362](https://github.com/xcvzmoon/open-fms/commit/0edf362))
- Resolve workspace package ([a112741](https://github.com/xcvzmoon/open-fms/commit/a112741))
- Remove placeholder workspace ([77a7988](https://github.com/xcvzmoon/open-fms/commit/77a7988))
- Add MIT license ([a10eb4b](https://github.com/xcvzmoon/open-fms/commit/a10eb4b))
- **agent:** Add rules for commiting and creating a PR ([6974da7](https://github.com/xcvzmoon/open-fms/commit/6974da7))
- Add PLAN and TODO ([da3bad6](https://github.com/xcvzmoon/open-fms/commit/da3bad6))
- **apps:** Initialize api ([aeece25](https://github.com/xcvzmoon/open-fms/commit/aeece25))
- **packages:** Initialize database ([d8569e3](https://github.com/xcvzmoon/open-fms/commit/d8569e3))
- **vite-config:** Disable test isolation ([1c5f1ce](https://github.com/xcvzmoon/open-fms/commit/1c5f1ce))
- **database:** Add drizzle kit and orm ([2f6ebd5](https://github.com/xcvzmoon/open-fms/commit/2f6ebd5))
- **todo:** Mark t1 as completed ([b10fe2f](https://github.com/xcvzmoon/open-fms/commit/b10fe2f))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))
