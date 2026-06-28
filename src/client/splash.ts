import { context, navigateTo, requestExpandedMode } from '@devvit/web/client';
import { trpc } from './trpc';

const docsLink = document.getElementById('docs-link') as HTMLDivElement;
const playtestLink = document.getElementById('playtest-link') as HTMLDivElement;
const discordLink = document.getElementById('discord-link') as HTMLDivElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const titleElement = document.getElementById('title') as HTMLHeadingElement;

startButton.addEventListener('click', (event) => {
  requestExpandedMode(event, 'game');
});

docsLink.addEventListener('click', () => {
  navigateTo('https://developers.reddit.com/docs');
});

playtestLink.addEventListener('click', () => {
  navigateTo('https://www.reddit.com/r/Devvit');
});

discordLink.addEventListener('click', () => {
  navigateTo('https://discord.com/invite/R7yu2wh9Qz');
});

function updateProgress(): void {
  trpc.getMap.query()
    .then((result) => {
      const mapString = result.map;
      const dug = mapString.split('').filter((c) => c === '1').length;
      const progressItem = document.getElementById('progress-item') as HTMLLIElement | null;
      if (progressItem) {
        progressItem.textContent = `Track your progress: ${dug} / 256 paths dug.`;
      }
    })
    .catch((err) => {
      console.error('[Splash] Failed to fetch progress:', err);
    });
}

function init(): void {
  const username = context.username ?? 'defender';
  titleElement.textContent = `SiegeTheThread`;
  if (username) {
    titleElement.textContent = `SiegeTheThread · ${username}`;
  }
  updateProgress();
}

init();

// Update progress whenever the iframe becomes active or focused again (e.g. returning from expanded mode)
window.addEventListener('focus', updateProgress);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    updateProgress();
  }
});

