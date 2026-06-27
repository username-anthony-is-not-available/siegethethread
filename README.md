## SiegeTheThread

A collaborative subreddit dungeon-building and raiding game built on Reddit's developer platform.

### Milestone 1: The Local Grid Blueprint Phase

The defender phase - a fully local, client-side grid blueprint editor where subreddit members tap tiles to dig pathways out of a mountain, building the daily maze layout.

- **Grid**: 16×16 matrix (256 cells) of 32×32 pixel tiles
- **Interaction**: Tap rock tiles (`0x222222`) to excavate into pathways (`0x555555`)
- **Mobile**: 9:16 aspect ratio locked with `Phaser.Scale.FIT` scaling
- **No external assets**: All tiles rendered as primitive Phaser rectangles

### Commands

- `npm run dev`: Starts a development server for live playtesting via `devvit playtest`
- `npm run build`: Builds client and server projects
- `npm run deploy`: Uploads a new version of your app
- `npm run launch`: Publishes your app for review
- `npm run login`: Logs your CLI into Reddit
- `npm run type-check`: Type checks TypeScript
- `npm run lint`: Lints source files
- `npm run test`: Runs unit tests (10 tests, all pass)

### Architecture

- `src/shared/grid.ts`: Pure grid state model (unit-testable)
- `src/client/game.ts`: Phaser game configuration
- `src/client/scenes/GameScene.ts`: Grid rendering and interaction
- `tests/milestone1.test.ts`: Unit tests for grid logic
- `docs/MILESTONE_1.md`: Full technical documentation
