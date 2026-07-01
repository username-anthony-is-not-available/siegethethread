import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { OnboardingScene } from './scenes/OnboardingScene';
import { GameScene } from './scenes/GameScene';
import { CinematicScene } from './scenes/CinematicScene';

const GAME_WIDTH = 576;
const GAME_HEIGHT = 1024;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0b0d12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, OnboardingScene, GameScene, CinematicScene],
};

export function StartGame(parent: string): Phaser.Game {
  return new Phaser.Game({ ...config, parent });
}

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});
