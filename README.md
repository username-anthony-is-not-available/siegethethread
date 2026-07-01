## SiegeTheThread

A collaborative subreddit dungeon-building and raiding game built on Reddit's developer platform.

### Architecture
See `docs/FINAL_ARCHITECTURE.md` for full technical documentation on the system architecture.

- **Grid**: 16×16 matrix (256 cells) of 32×32 pixel tiles
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
- `npm run test`: Runs unit tests
