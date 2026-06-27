import * as Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { GameScene } from './scenes/GameScene';

// Strict mobile portrait aspect ratio (9:16). The internal resolution is
// fixed and scaled with Phaser.Scale.FIT so the blueprint grid never clips or
// scrolls inside a reddit.com inline / expanded mobile frame.
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
  scene: [Boot, GameScene],
};

export function StartGame(parent: string): Phaser.Game {
  return new Phaser.Game({ ...config, parent });
}

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});
